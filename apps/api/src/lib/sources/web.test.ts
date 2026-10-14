import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

process.env.ALLOW_PRIVATE_URLS = "true"; // the fake site runs on localhost
process.env.WEB_DELAY_MS = "0";

let server: http.Server;
let base = "";

const posting = (title: string, extra: Record<string, unknown> = {}) => ({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title,
  description: "&lt;p&gt;We need help. 0-1 years of experience. Python.&lt;/p&gt;",
  datePosted: "2026-10-05",
  identifier: { "@type": "PropertyValue", value: title.toLowerCase().replace(/\W+/g, "-") },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Pune", addressCountry: "IN" } },
  ...extra,
});
const page = (...blocks: unknown[]) =>
  `<html><body>${blocks.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join("")}</body></html>`;

before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    const html = (body: string) => { res.writeHead(200, { "content-type": "text/html" }); res.end(body); };
    if (url === "/robots.txt") { res.writeHead(200); return res.end("User-agent: *\nDisallow: /private\n"); }
    if (url === "/careers/direct") return html(page({ "@graph": [posting("Graduate Engineer"), posting("Remote Designer", { jobLocationType: "TELECOMMUTE", jobLocation: undefined })] }));
    if (url === "/careers/list") return html(`<a href="/jobs/1">One</a><a href="/jobs/2">Two</a><a href="/about">About</a><a href="/jobs/1">dup</a>`);
    if (url === "/jobs/1") return html(page(posting("Backend Engineer")));
    if (url === "/jobs/2") return html(page(posting("Data Analyst Intern")));
    if (url === "/private/jobs") return html(page(posting("Secret")));
    if (url === "/careers/empty") return html("<html><body>Loading…</body></html>");
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

test("reads JobPosting data straight from the page, including @graph and remote jobs", async () => {
  const { fetchWeb } = await import("./web");
  const jobs = await fetchWeb(`${base}/careers/direct`);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, "Graduate Engineer");
  assert.equal(jobs[0].location, "Pune, IN");
  assert.match(jobs[0].description, /0-1 years of experience/);
  assert.ok(!jobs[0].description.includes("<p>"));
  assert.equal(jobs[1].location, "Remote");
  assert.equal(jobs[0].postedAt?.toISOString().slice(0, 10), "2026-10-05");
});

test("follows job links on a listing page and ignores other links", async () => {
  const { fetchWeb } = await import("./web");
  const jobs = await fetchWeb(`${base}/careers/list`);
  assert.deepEqual(jobs.map((j) => j.title).sort(), ["Backend Engineer", "Data Analyst Intern"]);
});

test("respects robots.txt and handles pages without job data", async () => {
  const { fetchWeb } = await import("./web");
  await assert.rejects(() => fetchWeb(`${base}/private/jobs`), /robots\.txt/);
  assert.deepEqual(await fetchWeb(`${base}/careers/empty`), []);
});

test("refuses private addresses unless explicitly allowed", async () => {
  const { fetchWeb } = await import("./web");
  process.env.ALLOW_PRIVATE_URLS = "false";
  try {
    await assert.rejects(() => fetchWeb("http://127.0.0.1:9/careers"), /not a public website/);
  } finally {
    process.env.ALLOW_PRIVATE_URLS = "true";
  }
});
