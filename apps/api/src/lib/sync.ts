import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { syncDb as db, jobsTable, watchlistCompaniesTable } from "@workspace/db";
import { classify, extractSkills } from "./experience";
import { firstSentences } from "./sources/html";
import { fetchBoard, SourceError, type FetchedJob, type SourceName } from "./sources";
import { logger } from "./logger";
import { runAlerts } from "./alert-delivery";

type Company = typeof watchlistCompaniesTable.$inferSelect;

export interface SyncResult {
  checked: number;
  newJobs: number;
  errors: number;
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "CO"
  );
}

/** Fetch each distinct board once, even if several users follow it. */
export async function syncCompanies(companies: Company[]): Promise<SyncResult> {
  const result: SyncResult = { checked: 0, newJobs: 0, errors: 0 };
  const byBoard = new Map<string, Company[]>();
  for (const c of companies) {
    if (!c.source || !c.boardToken) continue;
    const key = `${c.source}:${c.boardToken}`;
    byBoard.set(key, [...(byBoard.get(key) ?? []), c]);
  }

  for (const [key, followers] of byBoard) {
    const [source, token] = [followers[0].source as SourceName, followers[0].boardToken as string];
    let fetched: FetchedJob[] | null = null;
    let message = "";
    try {
      // Catalog companies nobody follows: skip the heavy job descriptions so they load in seconds.
      fetched = await fetchBoard(source, token, followers.every((c) => !c.followed));
    } catch (err) {
      message = err instanceof SourceError ? err.message : "Unexpected error while checking this company";
      if (!(err instanceof SourceError)) logger.error({ err, key }, "sync failed");
    }

    for (const company of followers) {
      result.checked += 1;
      if (!fetched) {
        result.errors += 1;
        await db
          .update(watchlistCompaniesTable)
          .set({ lastCheckedAt: new Date(), lastStatus: "error", lastError: message })
          .where(eq(watchlistCompaniesTable.id, company.id));
        continue;
      }
      try {
        // A slow or sleeping remote database sometimes drops a query; saving is safe to repeat.
        let added = 0;
        for (let attempt = 1; ; attempt++) {
          try {
            added = await storeJobs(company, source, fetched);
            break;
          } catch (e) {
            if (attempt >= 3) throw e;
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }
        result.newJobs += added;
      } catch (err) {
        logger.error({ err, key }, "storing jobs failed");
        result.errors += 1;
        const root = ((err as { cause?: Error })?.cause ?? (err as Error))?.message;
        const why = root?.split("\n")[0]?.slice(0, 160) ?? "unknown error";
        await db
          .update(watchlistCompaniesTable)
          .set({ lastCheckedAt: new Date(), lastStatus: "error", lastError: `Could not save the jobs (${why})` })
          .where(eq(watchlistCompaniesTable.id, company.id));
      }
    }
  }
  return result;
}

// Postgres refuses the NUL character, which a few job descriptions contain.
const clean = (v: string) => v.replace(/\u0000/g, "");

async function storeJobs(company: Company, source: SourceName, fetchedRaw: FetchedJob[]): Promise<number> {
  const now = new Date();
  const fetchedAll = fetchedRaw.map((j) => ({
    ...j,
    externalId: clean(j.externalId),
    title: clean(j.title),
    location: clean(j.location),
    applyUrl: clean(j.applyUrl),
    description: clean(j.description),
  }));
  // The same id twice in one answer would make the bulk save fail, so keep the first of each.
  const fetched = [...new Map(fetchedAll.map((j) => [j.externalId, j])).values()];
  const ids = fetched.map((j) => j.externalId);

  // Only jobs we have not seen before are sent to the database. Re-sending every description of
  // every company on each check is what made things slow, especially over a remote database.
  const known = new Set<string>();
  const seen = await db
    .select({ externalId: jobsTable.externalId })
    .from(jobsTable)
    .where(and(eq(jobsTable.userId, company.userId), eq(jobsTable.source, source), eq(jobsTable.companyId, company.id)));
  for (const r of seen) if (r.externalId) known.add(r.externalId);

  // Known jobs: just note that they are still on the board (ids only, tiny).
  const stillThere = ids.filter((id) => known.has(id));
  for (let i = 0; i < stillThere.length; i += 500) {
    await db
      .update(jobsTable)
      .set({ lastSeenAt: now, closedAt: null })
      .where(
        and(
          eq(jobsTable.userId, company.userId),
          eq(jobsTable.source, source),
          inArray(jobsTable.externalId, stillThere.slice(i, i + 500)),
        ),
      );
  }

  // New jobs: saved in chunks with one request each.
  const fresh = fetched.filter((j) => !known.has(j.externalId));
  let added = 0;
  const CHUNK = 50;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const rows = fresh.slice(i, i + CHUNK).map((job) => {
      const c = classify(job.title, job.description);
      return {
        userId: company.userId,
        source,
        externalId: job.externalId,
        companyId: company.id,
        title: job.title,
        company: company.name,
        companyInitials: initials(company.name),
        location: job.location,
        experience: c.label,
        experienceLevel: c.level,
        minYears: c.minYears,
        maxYears: c.maxYears,
        batchYear: c.batchYear,
        summary: firstSentences(job.description) || job.title,
        description: (job.description || "No description was published for this role.").slice(0, 8000),
        skills: extractSkills(`${job.title}\n${job.description}`),
        applicationUrl: job.applyUrl,
        fresherMatch: c.fresherMatch,
        postedAt: job.postedAt ?? now,
        firstSeenAt: now,
        lastSeenAt: now,
        closedAt: null,
        status: "new",
        isSample: false,
      };
    });
    const inserted = await db.insert(jobsTable).values(rows).onConflictDoNothing().returning({ id: jobsTable.id });
    added += inserted.length;
    await new Promise((r) => setImmediate(r)); // let waiting page requests through between chunks
  }

  // Jobs that vanished from the board are closed (kept so applications stay in the tracker).
  // An empty answer is not trusted: it is more likely a glitch than every role closing at once.
  if (ids.length > 0) {
    await db
      .update(jobsTable)
      .set({ closedAt: now })
      .where(
        and(
          eq(jobsTable.userId, company.userId),
          eq(jobsTable.companyId, company.id),
          eq(jobsTable.source, source),
          isNull(jobsTable.closedAt),
          notInArray(jobsTable.externalId, ids),
        ),
      );
  }

  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(jobsTable)
    .where(and(eq(jobsTable.companyId, company.id), isNull(jobsTable.closedAt)));
  await db
    .update(watchlistCompaniesTable)
    .set({ lastCheckedAt: now, lastStatus: "ok", lastError: null, openRoles: open })
    .where(eq(watchlistCompaniesTable.id, company.id));
  return added;
}

export async function syncUser(userId: string, cooldownMs = 60_000): Promise<SyncResult> {
  const all = await db.select().from(watchlistCompaniesTable).where(eq(watchlistCompaniesTable.userId, userId));
  const due = all.filter((c) => !c.lastCheckedAt || Date.now() - c.lastCheckedAt.getTime() >= cooldownMs);
  return syncCompanies(due);
}

export async function syncAll(intervalMs = 30 * 60_000): Promise<SyncResult> {
  const all = await db.select().from(watchlistCompaniesTable);
  const due = all
    .filter((c) => !c.lastCheckedAt || Date.now() - c.lastCheckedAt.getTime() >= intervalMs)
    .sort((a, b) => Number(b.followed) - Number(a.followed));
  const total: SyncResult = { checked: 0, newJobs: 0, errors: 0 };
  const queue = [...due];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const r = await syncCompanies([c]);
      total.checked += r.checked; total.newJobs += r.newJobs; total.errors += r.errors;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return total;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startScheduler(): void {
  if (process.env.SYNC_DISABLED === "true" || timer) return;
  const minutes = Math.max(5, Number(process.env.SYNC_INTERVAL_MIN ?? 30) || 30);
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await syncAll(minutes * 60_000 - 60_000);
      logger.info(r, "scheduled sync finished");
      await runAlerts();
    } catch (err) {
      logger.error({ err }, "scheduled sync failed");
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, minutes * 60_000);
  timer.unref();
  setTimeout(tick, 10_000).unref();
  // Email alerts for newly found roles go out within ~5 minutes of them being saved.
  setInterval(() => void runAlerts().catch((err) => logger.error({ err }, "alerts failed")), 5 * 60_000).unref();
  logger.info({ everyMinutes: minutes }, "job sync scheduler started");
}
