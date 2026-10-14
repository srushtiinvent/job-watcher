import { and, desc, eq, gte, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateJobBody,
  CreateJobResponse,
  DeleteJobParams,
  GetDashboardResponse,
  GetJobParams,
  GetJobResponse,
  GetProfileResponse,
  LoadDemoJobsResponse,
  UpdateProfileBody,
  UpdateProfileResponse,
  ListJobsQueryParams,
  ListJobsResponse,
  UpdateJobBody,
  UpdateJobParams,
  UpdateJobResponse,
  UpdateJobStatusBody,
  UpdateJobStatusParams,
  UpdateJobStatusResponse,
} from "@workspace/api-zod";
import { db, jobsTable, trackerProfilesTable, watchlistCompaniesTable } from "@workspace/db";
import { classify } from "../lib/experience";
import { ensureUserInitialized, loadDemoJobs, serializeJob } from "../lib/job-data";
import { getUserId, requireAuth } from "../lib/requireAuth";

const router: IRouter = Router();
const statuses = ["new", "saved", "applied", "oa", "interview", "offer", "rejected", "hidden"];

router.use(requireAuth);

router.get("/jobs", async (req, res): Promise<void> => {
  const parsed = ListJobsQueryParams.safeParse({
    ...req.query,
    ...(req.query.newOnly === undefined
      ? {}
      : { newOnly: req.query.newOnly === "true" }),
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = getUserId(req);
  await ensureUserInitialized(userId);
  const query = parsed.data;
  const filters = [eq(jobsTable.userId, userId)];

  if (query.q) {
    const term = `%${query.q}%`;
    filters.push(
      or(
        ilike(jobsTable.title, term),
        ilike(jobsTable.company, term),
        ilike(jobsTable.summary, term),
        ilike(jobsTable.location, term),
      )!,
    );
  }
  if (query.role) filters.push(ilike(jobsTable.title, `%${query.role}%`));
  if (query.location) filters.push(ilike(jobsTable.location, `%${query.location}%`));
  if (query.company) filters.push(ilike(jobsTable.company, `%${query.company}%`));
  if (query.batchYear !== undefined) filters.push(eq(jobsTable.batchYear, query.batchYear));
  if (query.experienceLevel) {
    filters.push(
      query.includeUnspecified && query.experienceLevel !== "unspecified"
        ? inArray(jobsTable.experienceLevel, [query.experienceLevel, "unspecified"])
        : eq(jobsTable.experienceLevel, query.experienceLevel),
    );
  }
  if (!query.includeClosed) filters.push(isNull(jobsTable.closedAt));
  if (query.followedOnly) {
    filters.push(
      inArray(
        jobsTable.companyId,
        db
          .select({ id: watchlistCompaniesTable.id })
          .from(watchlistCompaniesTable)
          .where(and(eq(watchlistCompaniesTable.userId, userId), eq(watchlistCompaniesTable.followed, true))),
      ),
    );
  }
  if (query.status === "pipeline") {
    filters.push(inArray(jobsTable.status, ["applied", "oa", "interview", "offer"]));
  } else if (query.status === "tracked") {
    filters.push(inArray(jobsTable.status, ["saved", "applied", "oa", "interview", "offer", "rejected"]));
  } else if (query.status) {
    filters.push(eq(jobsTable.status, query.status));
  } else {
    filters.push(ne(jobsTable.status, "hidden"));
  }
  if (query.newOnly) {
    filters.push(
      eq(jobsTable.status, "new"),
      gte(jobsTable.postedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
    );
  }

  const jobs = await db
    .select()
    .from(jobsTable)
    .where(and(...filters))
    .orderBy(desc(jobsTable.postedAt), desc(jobsTable.id))
    .limit(query.limit ?? 80)
    .offset(query.offset ?? 0);
  res.json(ListJobsResponse.parse(jobs.map(serializeJob)));
});

router.get("/jobs/locations", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  await ensureUserInitialized(userId);
  const rows = await db
    .select({ location: jobsTable.location, n: sql<number>`count(*)::int` })
    .from(jobsTable)
    .where(and(eq(jobsTable.userId, userId), isNull(jobsTable.closedAt), ne(jobsTable.status, "hidden")))
    .groupBy(jobsTable.location)
    .orderBy(sql`count(*) desc`)
    .limit(300);
  res.json(rows.map((r) => r.location).filter((l) => l && l !== "Not specified"));
});

router.post("/jobs", async (req, res): Promise<void> => {
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = getUserId(req);
  await ensureUserInitialized(userId);
  const input = parsed.data;
  const c = classify(input.title, `${input.summary}\n${input.description}`);
  const level = input.experienceLevel ?? c.level;
  const [job] = await db
    .insert(jobsTable)
    .values({
      ...input,
      source: "manual",
      externalId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      experienceLevel: level,
      minYears: c.minYears,
      maxYears: c.maxYears,
      userId,
      companyInitials:
        input.companyInitials ??
        input.company
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? "")
          .join(""),
      experience: input.experience || c.label,
      skills: input.skills ?? [],
      applicationUrl: input.applicationUrl,
      postedAt: input.postedAt ? new Date(input.postedAt) : new Date(),
      firstSeenAt: new Date(),
      status: "new",
      fresherMatch: input.fresherMatch ?? (level === "fresher" ? Math.max(c.fresherMatch, 80) : c.fresherMatch),
      isSample: false,
    })
    .returning();

  res.status(201).json(CreateJobResponse.parse(serializeJob(job)));
});

router.post("/jobs/demo", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  await ensureUserInitialized(userId);
  res.json(LoadDemoJobsResponse.parse({ added: await loadDemoJobs(userId) }));
});

router.get("/profile", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  await ensureUserInitialized(userId);
  const [profile] = await db.select().from(trackerProfilesTable).where(eq(trackerProfilesTable.userId, userId));
  res.json(GetProfileResponse.parse({ experienceLevel: profile?.experienceLevel ?? "any" }));
});

router.put("/profile", async (req, res): Promise<void> => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = getUserId(req);
  await db
    .insert(trackerProfilesTable)
    .values({ userId, experienceLevel: parsed.data.experienceLevel })
    .onConflictDoUpdate({
      target: trackerProfilesTable.userId,
      set: { experienceLevel: parsed.data.experienceLevel },
    });
  res.json(UpdateProfileResponse.parse({ experienceLevel: parsed.data.experienceLevel }));
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const params = GetJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.userId, getUserId(req))));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(GetJobResponse.parse(serializeJob(job)));
});

router.patch("/jobs/:id", async (req, res): Promise<void> => {
  const params = UpdateJobParams.safeParse(req.params);
  const parsed = UpdateJobBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { followUpDate, ...updates } = parsed.data;
  const [job] = await db
    .update(jobsTable)
    .set({
      ...updates,
      ...(followUpDate === undefined
        ? {}
        : {
            followUpDate:
              followUpDate === null ? null : followUpDate.toISOString().slice(0, 10),
          }),
      updatedAt: new Date(),
    })
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.userId, getUserId(req))))
    .returning();
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(UpdateJobResponse.parse(serializeJob(job)));
});

router.patch("/jobs/:id/status", async (req, res): Promise<void> => {
  const params = UpdateJobStatusParams.safeParse(req.params);
  const parsed = UpdateJobStatusBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!statuses.includes(parsed.data.status)) {
    res.status(400).json({ error: "Invalid job status" });
    return;
  }

  const [job] = await db
    .update(jobsTable)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.userId, getUserId(req))))
    .returning();
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(UpdateJobStatusResponse.parse(serializeJob(job)));
});

router.delete("/jobs/:id", async (req, res): Promise<void> => {
  const params = DeleteJobParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [job] = await db
    .delete(jobsTable)
    .where(and(eq(jobsTable.id, params.data.id), eq(jobsTable.userId, getUserId(req))))
    .returning({ id: jobsTable.id });
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.status(204).end();
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  await ensureUserInitialized(userId);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [[counts], [followed]] = await Promise.all([
    db
      .select({
        newJobs: sql<number>`count(*) filter (where ${jobsTable.status} = 'new' and ${jobsTable.postedAt} >= ${dayAgo})::int`,
        savedJobs: sql<number>`count(*) filter (where ${jobsTable.status} = 'saved')::int`,
        activeApplications: sql<number>`count(*) filter (where ${jobsTable.status} in ('applied','oa','interview'))::int`,
        interviews: sql<number>`count(*) filter (where ${jobsTable.status} = 'interview')::int`,
        offers: sql<number>`count(*) filter (where ${jobsTable.status} = 'offer')::int`,
      })
      .from(jobsTable)
      .where(and(eq(jobsTable.userId, userId), isNull(jobsTable.closedAt))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(watchlistCompaniesTable)
      .where(and(eq(watchlistCompaniesTable.userId, userId), eq(watchlistCompaniesTable.followed, true))),
  ]);
  res.json(GetDashboardResponse.parse({ ...counts, followedCompanies: followed?.n ?? 0 }));
});

export default router;
