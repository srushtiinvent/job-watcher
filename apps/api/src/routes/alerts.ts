import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAlertBody,
  CreateAlertResponse,
  DeleteAlertParams,
  ListAlertsResponse,
  UpdateAlertBody,
  UpdateAlertParams,
  UpdateAlertResponse,
} from "@workspace/api-zod";
import { db, alertRulesTable, jobsTable } from "@workspace/db";
import { emailConfigured, ruleConditions } from "../lib/alert-delivery";
import { ensureUserInitialized } from "../lib/job-data";
import { getUserId, requireAuth } from "../lib/requireAuth";

const router: IRouter = Router();
router.use(requireAuth);

type Rule = { role: string; locations: string[]; experienceLevel: string };

/** Counts last week's matching roles inside the database (no job text is downloaded). */
async function matchCounts(userId: string, rules: Rule[]): Promise<number[]> {
  if (rules.length === 0) return [];
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const columns: Record<string, ReturnType<typeof sql<number>>> = {};
  rules.forEach((rule, i) => {
    columns[`c${i}`] = sql<number>`count(*) filter (where ${sql.join([sql`true`, ...ruleConditions(rule)], sql` and `)})::int`;
  });
  const [row] = await db
    .select(columns)
    .from(jobsTable)
    .where(and(eq(jobsTable.userId, userId), ne(jobsTable.status, "hidden"), isNull(jobsTable.closedAt), gte(jobsTable.postedAt, since)));
  return rules.map((_, i) => Number(row?.[`c${i}`] ?? 0));
}

router.get("/alerts", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  await ensureUserInitialized(userId);
  const rules = await db
    .select()
    .from(alertRulesTable)
    .where(eq(alertRulesTable.userId, userId))
    .orderBy(alertRulesTable.createdAt);
  const counts = await matchCounts(userId, rules);
  res.json(
    ListAlertsResponse.parse(
      rules.map((rule, i) => ({
        id: rule.id,
        role: rule.role,
        locations: rule.locations,
        channels: rule.channels,
        enabled: rule.enabled,
        matchingJobsLastWeek: counts[i],
        deliveryConnected: emailConfigured() && rule.channels.includes("email"),
        createdAt: rule.createdAt.toISOString(),
        experienceLevel: rule.experienceLevel as "any",
      })),
    ),
  );
});

router.post("/alerts", async (req, res): Promise<void> => {
  const parsed = CreateAlertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.channels.length === 0) {
    res.status(400).json({ error: "Select at least one notification preference" });
    return;
  }

  const userId = getUserId(req);
  await ensureUserInitialized(userId);
  // Save the rule and count its matches at the same time.
  const [[rule], [count]] = await Promise.all([
    db.insert(alertRulesTable).values({ ...parsed.data, userId }).returning(),
    matchCounts(userId, [
      { role: parsed.data.role, locations: parsed.data.locations ?? [], experienceLevel: parsed.data.experienceLevel ?? "any" },
    ]),
  ]);
  res.status(201).json(
    CreateAlertResponse.parse({
      id: rule.id,
      role: rule.role,
      locations: rule.locations,
      channels: rule.channels,
      enabled: rule.enabled,
      matchingJobsLastWeek: count,
      deliveryConnected: emailConfigured() && rule.channels.includes("email"),
      createdAt: rule.createdAt.toISOString(),
        experienceLevel: rule.experienceLevel as "any",
    }),
  );
});

router.patch("/alerts/:id", async (req, res): Promise<void> => {
  const params = UpdateAlertParams.safeParse(req.params);
  const parsed = UpdateAlertBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.channels?.length === 0) {
    res.status(400).json({ error: "Select at least one notification preference" });
    return;
  }

  const userId = getUserId(req);
  const [rule] = await db
    .update(alertRulesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(alertRulesTable.id, params.data.id), eq(alertRulesTable.userId, userId)))
    .returning();
  if (!rule) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  const [count] = await matchCounts(userId, [rule]);
  res.json(
    UpdateAlertResponse.parse({
      id: rule.id,
      role: rule.role,
      locations: rule.locations,
      channels: rule.channels,
      enabled: rule.enabled,
      matchingJobsLastWeek: count,
      deliveryConnected: emailConfigured() && rule.channels.includes("email"),
      createdAt: rule.createdAt.toISOString(),
        experienceLevel: rule.experienceLevel as "any",
    }),
  );
});

router.delete("/alerts/:id", async (req, res): Promise<void> => {
  const parsed = DeleteAlertParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [rule] = await db
    .delete(alertRulesTable)
    .where(
      and(
        eq(alertRulesTable.id, parsed.data.id),
        eq(alertRulesTable.userId, getUserId(req)),
      ),
    )
    .returning({ id: alertRulesTable.id });
  if (!rule) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  res.status(204).end();
});

export default router;
