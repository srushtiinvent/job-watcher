import { and, eq } from "drizzle-orm";
import { db, syncDb, watchlistCompaniesTable } from "@workspace/db";
import { logger } from "./logger";
import { syncCompanies } from "./sync";
import type { SourceName } from "./sources";

/**
 * Well-known companies that publish their jobs on Greenhouse, Lever or Ashby.
 * Companies change job boards now and then, so any board that no longer exists is
 * dropped automatically after the first check instead of cluttering the list.
 */
export const STARTER_COMPANIES: Array<{ name: string; source: SourceName; token: string }> = [
  { name: "Stripe", source: "greenhouse", token: "stripe" },
  { name: "Cloudflare", source: "greenhouse", token: "cloudflare" },
  { name: "Databricks", source: "greenhouse", token: "databricks" },
  { name: "Postman", source: "greenhouse", token: "postman" },
  { name: "Airbnb", source: "greenhouse", token: "airbnb" },
  { name: "Coinbase", source: "greenhouse", token: "coinbase" },
  { name: "Figma", source: "greenhouse", token: "figma" },
  { name: "Discord", source: "greenhouse", token: "discord" },
  { name: "Dropbox", source: "greenhouse", token: "dropbox" },
  { name: "Pinterest", source: "greenhouse", token: "pinterest" },
  { name: "Robinhood", source: "greenhouse", token: "robinhood" },
  { name: "Twilio", source: "greenhouse", token: "twilio" },
  { name: "MongoDB", source: "greenhouse", token: "mongodb" },
  { name: "Datadog", source: "greenhouse", token: "datadog" },
  { name: "Elastic", source: "greenhouse", token: "elastic" },
  { name: "GitLab", source: "greenhouse", token: "gitlab" },
  { name: "Instacart", source: "greenhouse", token: "instacart" },
  { name: "Lyft", source: "greenhouse", token: "lyft" },
  { name: "Reddit", source: "greenhouse", token: "reddit" },
  { name: "Vercel", source: "greenhouse", token: "vercel" },
  { name: "Asana", source: "greenhouse", token: "asana" },
  { name: "Brex", source: "greenhouse", token: "brex" },
  { name: "Okta", source: "greenhouse", token: "okta" },
  { name: "Samsara", source: "greenhouse", token: "samsara" },
  { name: "Anthropic", source: "greenhouse", token: "anthropic" },
  { name: "Scale AI", source: "greenhouse", token: "scaleai" },
  { name: "Groww", source: "greenhouse", token: "groww" },
  { name: "Palantir", source: "lever", token: "palantir" },
  { name: "Spotify", source: "lever", token: "spotify" },
  { name: "Plaid", source: "lever", token: "plaid" },
  { name: "Meesho", source: "lever", token: "meesho" },
  { name: "Notion", source: "ashby", token: "notion" },
  { name: "Ramp", source: "ashby", token: "ramp" },
  { name: "Linear", source: "ashby", token: "linear" },
  { name: "OpenAI", source: "ashby", token: "openai" },
  { name: "Retool", source: "ashby", token: "retool" },
  { name: "Vanta", source: "ashby", token: "vanta" },
  { name: "Deel", source: "ashby", token: "deel" },
  { name: "Supabase", source: "ashby", token: "supabase" },
  { name: "Replit", source: "ashby", token: "replit" },
];

/** Follows the starter companies. Returns at once; jobs are fetched in the background. */
export async function addStarterCompanies(userId: string): Promise<number> {
  const inserted = await db
    .insert(watchlistCompaniesTable)
    .values(STARTER_COMPANIES.map((c) => ({ userId, name: c.name, source: c.source, boardToken: c.token, followed: false })))
    .onConflictDoNothing()
    .returning();
  if (inserted.length) void fetchStarterInBackground(inserted);
  return inserted.length;
}

async function fetchStarterInBackground(companies: Array<typeof watchlistCompaniesTable.$inferSelect>): Promise<void> {
  const queue = [...companies];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        await syncCompanies([c]);
        const [row] = await syncDb.select().from(watchlistCompaniesTable).where(eq(watchlistCompaniesTable.id, c.id));
        // The company moved or renamed its board: remove it quietly.
        if (row?.lastStatus === "error" && row.lastError === "Board not found") {
          await syncDb
            .delete(watchlistCompaniesTable)
            .where(and(eq(watchlistCompaniesTable.id, c.id), eq(watchlistCompaniesTable.userId, c.userId)));
        }
      } catch (err) {
        logger.error({ err, company: c.name }, "starter company fetch failed");
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}
