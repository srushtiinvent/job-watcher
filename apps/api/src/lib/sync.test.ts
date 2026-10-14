import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { db, jobsTable, watchlistCompaniesTable } from "@workspace/db";

// A fake Greenhouse / Lever / Ashby, so the tests do not need the internet.
let server: http.Server;
let ghJobs: unknown[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.startsWith("/v1/boards/acme/jobs")) return send(200, { jobs: ghJobs });
    if (url.startsWith("/v0/postings/globex")) {
      return send(200, [
        { id: "l1", text: "Software Engineer", hostedUrl: "https://jobs.lever.co/globex/l1", createdAt: 1760000000000,
          descriptionPlain: "Join us. 2-4 years of experience with Python.", categories: { location: "Remote - India" } },
        { id: "l2", text: "Operations Intern", hostedUrl: "https://jobs.lever.co/globex/l2", createdAt: 1760000000000,
          descriptionPlain: "Learn the ropes.", categories: { location: "Mumbai" } },
      ]);
    }
    if (url.startsWith("/posting-api/job-board/initech")) {
      return send(200, { jobs: [
        { id: "a1", title: "Backend Engineer", location: "Hyderabad", isRemote: false, isListed: true,
          descriptionPlain: "Build APIs.", publishedAt: "2026-10-01T10:00:00Z", jobUrl: "https://jobs.ashbyhq.com/initech/a1" },
        { id: "a2", title: "Hidden role", location: "X", isListed: false, jobUrl: "https://x/y", descriptionPlain: "" },
      ] });
    }
    send(404, { error: "nope" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.GREENHOUSE_API_BASE = base;
  process.env.LEVER_API_BASE = base;
  process.env.ASHBY_API_BASE = base;
  await db.delete(jobsTable).where(eq(jobsTable.userId, "test-user"));
  await db.delete(watchlistCompaniesTable).where(eq(watchlistCompaniesTable.userId, "test-user"));
});

after(async () => {
  await db.delete(jobsTable).where(eq(jobsTable.userId, "test-user"));
  await db.delete(watchlistCompaniesTable).where(eq(watchlistCompaniesTable.userId, "test-user"));
  server.close();
});

const ghJob = (id: number, title: string, content: string) => ({
  id, title, absolute_url: `https://boards.greenhouse.io/acme/jobs/${id}`,
  location: { name: "Bengaluru" }, first_published: "2026-10-05T08:00:00Z",
  content: content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
});

test("fetches, classifies, dedupes and closes jobs across all three sources", async () => {
  const { syncCompanies } = await import("./sync");
  const { parseCareersUrl } = await import("./sources");

  assert.deepEqual(parseCareersUrl("https://boards.greenhouse.io/acme"), { source: "greenhouse", boardToken: "acme" });
  assert.deepEqual(parseCareersUrl("jobs.lever.co/globex/abc"), { source: "lever", boardToken: "globex" });
  assert.deepEqual(parseCareersUrl("https://jobs.ashbyhq.com/initech"), { source: "ashby", boardToken: "initech" });
  assert.equal(parseCareersUrl("https://example.com/careers"), null);

  ghJobs = [
    ghJob(1, "Graduate Engineer", "<p>Class of 2026 welcome.</p><ul><li>Write code</li></ul>"),
    ghJob(2, "Platform Engineer", "<p>5+ years of experience required.</p>"),
    ghJob(3, "Product Designer", "<p>Design things.</p>"),
  ];
  const rows = await db
    .insert(watchlistCompaniesTable)
    .values([
      { userId: "test-user", name: "Acme", source: "greenhouse", boardToken: "acme" },
      { userId: "test-user", name: "Globex", source: "lever", boardToken: "globex" },
      { userId: "test-user", name: "Initech", source: "ashby", boardToken: "initech" },
      { userId: "test-user", name: "Broken", source: "greenhouse", boardToken: "does-not-exist" },
    ])
    .returning();

  const r1 = await syncCompanies(rows);
  assert.equal(r1.checked, 4);
  assert.equal(r1.errors, 1);
  assert.equal(r1.newJobs, 3 + 2 + 1);

  const jobs = await db.select().from(jobsTable).where(eq(jobsTable.userId, "test-user"));
  const by = (t: string) => jobs.find((j) => j.title === t)!;
  assert.equal(by("Graduate Engineer").experienceLevel, "fresher");
  assert.equal(by("Graduate Engineer").batchYear, 2026);
  assert.ok(by("Graduate Engineer").description.includes("• Write code"));
  assert.ok(!by("Graduate Engineer").description.includes("<"));
  assert.equal(by("Platform Engineer").experienceLevel, "senior");
  assert.equal(by("Product Designer").experienceLevel, "unspecified");
  assert.equal(by("Product Designer").experience, "Not stated");
  assert.equal(by("Software Engineer").experienceLevel, "junior");
  assert.equal(by("Software Engineer").location, "Remote - India");
  assert.equal(by("Operations Intern").experienceLevel, "internship");
  assert.equal(by("Backend Engineer").source, "ashby");
  assert.ok(!jobs.some((j) => j.title === "Hidden role"));

  const status = await db.select().from(watchlistCompaniesTable).where(eq(watchlistCompaniesTable.userId, "test-user"));
  assert.equal(status.find((c) => c.name === "Broken")!.lastStatus, "error");
  assert.equal(status.find((c) => c.name === "Acme")!.openRoles, 3);

  // user marks one as applied; a re-sync must not undo it or duplicate anything
  await db.update(jobsTable).set({ status: "applied" }).where(eq(jobsTable.id, by("Graduate Engineer").id));
  const r2 = await syncCompanies(status);
  assert.equal(r2.newJobs, 0);
  const again = await db.select().from(jobsTable).where(eq(jobsTable.userId, "test-user"));
  assert.equal(again.length, jobs.length);
  assert.equal(again.find((j) => j.title === "Graduate Engineer")!.status, "applied");

  // a job disappears from the board -> closed; a new one appears -> counted
  ghJobs = [ghJobs[0], ghJob(4, "SDE 1", "<p>0-1 years of experience</p>")];
  const r3 = await syncCompanies(status.filter((c) => c.name === "Acme"));
  assert.equal(r3.newJobs, 1);
  const after3 = await db.select().from(jobsTable).where(eq(jobsTable.userId, "test-user"));
  assert.ok(after3.find((j) => j.title === "Platform Engineer")!.closedAt);
  assert.equal(after3.find((j) => j.title === "Graduate Engineer")!.closedAt, null);
  assert.equal(after3.find((j) => j.title === "SDE 1")!.experienceLevel, "fresher");

  // an empty answer is not trusted as "everything closed"
  ghJobs = [];
  await syncCompanies(status.filter((c) => c.name === "Acme"));
  const after4 = await db.select().from(jobsTable).where(eq(jobsTable.userId, "test-user"));
  assert.equal(after4.find((j) => j.title === "Graduate Engineer")!.closedAt, null);
});
