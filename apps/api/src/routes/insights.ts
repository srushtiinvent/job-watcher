import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { GetInsightsResponse } from "@workspace/api-zod";
import { db, jobsTable } from "@workspace/db";
import { ensureUserInitialized } from "../lib/job-data";
import { getUserId, requireAuth } from "../lib/requireAuth";

const router: IRouter = Router();
router.use(requireAuth);
const reportingTimeZone = "Asia/Kolkata";

function localDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: reportingTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

router.get("/insights", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  await ensureUserInitialized(userId);
  const open = and(eq(jobsTable.userId, userId), isNull(jobsTable.closedAt));
  const tz = sql.raw(`'${reportingTimeZone}'`);

  // Let the database do the counting instead of downloading every job.
  const [dayRows, companyRows, hourRows, levelRows, statusRows] = await Promise.all([
    db
      .select({ day: sql<string>`to_char(${jobsTable.postedAt} at time zone ${tz}, 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
      .from(jobsTable)
      .where(and(open, gte(jobsTable.postedAt, new Date(Date.now() - 9 * 86_400_000))))
      .groupBy(sql`1`),
    db
      .select({ label: jobsTable.company, n: sql<number>`count(*)::int` })
      .from(jobsTable)
      .where(open)
      .groupBy(jobsTable.company)
      .orderBy(sql`2 desc`)
      .limit(5),
    db
      .select({ h: sql<number>`extract(hour from ${jobsTable.postedAt} at time zone ${tz})::int`, n: sql<number>`count(*)::int` })
      .from(jobsTable)
      .where(open)
      .groupBy(sql`1`),
    db.select({ label: jobsTable.experienceLevel, n: sql<number>`count(*)::int` }).from(jobsTable).where(open).groupBy(jobsTable.experienceLevel),
    db.select({ label: jobsTable.status, n: sql<number>`count(*)::int` }).from(jobsTable).where(open).groupBy(jobsTable.status),
  ]);

  const byDay = new Map(dayRows.map((r) => [r.day, r.n]));
  const today = new Date();
  const postingsByDay = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today);
    day.setDate(day.getDate() - (6 - index));
    return {
      label: new Intl.DateTimeFormat("en-IN", { timeZone: reportingTimeZone, weekday: "short" }).format(day),
      value: byDay.get(localDayKey(day)) ?? 0,
    };
  });

  const hourCounts = Array.from({ length: 6 }, (_, index) => ({
    label: `${String(index * 4).padStart(2, "0")}–${String((index + 1) * 4).padStart(2, "0")}`,
    value: 0,
  }));
  for (const r of hourRows) hourCounts[Math.min(5, Math.floor(r.h / 4))].value += r.n;

  const levels = new Map(levelRows.map((r) => [r.label, r.n]));
  const totalJobs = statusRows.reduce((sum, r) => sum + r.n, 0);
  const tracked = statusRows.filter((r) => !["new", "saved", "hidden"].includes(r.label)).reduce((sum, r) => sum + r.n, 0);

  res.json(
    GetInsightsResponse.parse({
      postingsByDay,
      topCompanies: companyRows.map((r) => ({ label: r.label, value: r.n })),
      postingHours: hourCounts,
      byLevel: ["internship", "fresher", "junior", "mid", "senior", "unspecified"].map((level) => ({
        label: level,
        value: levels.get(level) ?? 0,
      })),
      totalJobs,
      applicationRate: totalJobs === 0 ? 0 : Math.round((tracked / totalJobs) * 100),
    }),
  );
});

export default router;
