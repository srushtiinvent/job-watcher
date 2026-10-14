import { and, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  AddWatchlistCompanyBody,
  AddWatchlistCompanyResponse,
  ListWatchlistResponse,
  RemoveWatchlistCompanyParams,
  SyncWatchlistResponse,
} from "@workspace/api-zod";
import { db, jobsTable, watchlistCompaniesTable } from "@workspace/db";
import { initialsFromName } from "../lib/job-data";
import { getUserId, requireAuth } from "../lib/requireAuth";
import { detectBoard, fetchBoard, parseCareersUrl, parseWebUrl, SourceError, type SourceName } from "../lib/sources";
import { addStarterCompanies } from "../lib/starter";
import { syncCompanies, syncUser } from "../lib/sync";

const router: IRouter = Router();
router.use(requireAuth);

type Row = typeof watchlistCompaniesTable.$inferSelect;

function serialize(company: Row) {
  return {
    id: company.id,
    name: company.name,
    initials: initialsFromName(company.name),
    website: company.website,
    source: company.source as SourceName | null,
    boardToken: company.boardToken,
    rolesOpen: company.openRoles,
    lastCheckedAt: company.lastCheckedAt ? company.lastCheckedAt.toISOString() : null,
    lastStatus: company.lastStatus as "ok" | "error" | null,
    lastError: company.lastError,
    createdAt: company.createdAt.toISOString(),
    followed: company.followed,
  };
}

router.get("/watchlist", async (req, res): Promise<void> => {
  const companies = await db
    .select()
    .from(watchlistCompaniesTable)
    .where(eq(watchlistCompaniesTable.userId, getUserId(req)))
    .orderBy(watchlistCompaniesTable.name);
  res.json(ListWatchlistResponse.parse(companies.map(serialize)));
});

router.post("/watchlist/sync", async (req, res): Promise<void> => {
  res.json(SyncWatchlistResponse.parse(await syncUser(getUserId(req))));
});

router.post("/watchlist/starter", async (req, res): Promise<void> => {
  const added = await addStarterCompanies(getUserId(req));
  res.status(202).json({ added });
});

router.post("/watchlist", async (req, res): Promise<void> => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const parsed = AddWatchlistCompanyBody.safeParse({
    ...body,
    website: "website" in body && body.website !== "" ? body.website : null,
    careersUrl: "careersUrl" in body && body.careersUrl !== "" ? body.careersUrl : null,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = getUserId(req);
  const input = parsed.data;

  let board: { source: SourceName; boardToken: string } | null = null;
  if (input.source && input.boardToken) {
    board = { source: input.source, boardToken: input.boardToken };
  } else if (input.careersUrl) {
    board = parseCareersUrl(input.careersUrl);
    if (!board) {
      // Not Greenhouse/Lever/Ashby: try reading the page itself (schema.org job data).
      const webUrl = parseWebUrl(input.careersUrl);
      if (!webUrl) {
        res.status(400).json({ error: "That does not look like a web address. Paste the company's careers page link." });
        return;
      }
      board = { source: "web", boardToken: webUrl };
    }
  }

  let name = input.name?.trim() ?? "";
  if (!name && board) {
    const raw = board.source === "web" ? new URL(board.boardToken).hostname.replace(/^(www|careers|jobs)\./, "").split(".")[0] : board.boardToken;
    name = raw.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (!name) {
    res.status(400).json({ error: "Enter a company name or paste its careers link" });
    return;
  }

  if (!board) board = await detectBoard(name);
  if (board) {
    // Make sure the board really exists before saving, so typos are caught immediately.
    try {
      const found = await fetchBoard(board.source, board.boardToken);
      if (board.source === "web" && found.length === 0) {
        res.status(400).json({
          error:
            "I could not find job listings on that page. It may load jobs with JavaScript, or not publish structured job data. Try the link of a single job, or a company that uses Greenhouse, Lever or Ashby.",
        });
        return;
      }
    } catch (err) {
      if (board.source === "web" && err instanceof SourceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof SourceError && err.status === 404) {
        res.status(400).json({ error: `No ${board.source} job board named "${board.boardToken}" was found.` });
        return;
      }
      // Network trouble: still save it, the next check will retry.
    }
  }

  const [company] = await db
    .insert(watchlistCompaniesTable)
    .values({
      userId,
      name,
      website: input.website ?? null,
      source: board?.source ?? null,
      boardToken: board?.boardToken ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!company) {
    // Already in the list: if it was only browsable, following it is what the user wants.
    const [existing] = await db
      .update(watchlistCompaniesTable)
      .set({ followed: true })
      .where(and(eq(watchlistCompaniesTable.userId, userId), eq(watchlistCompaniesTable.name, name), eq(watchlistCompaniesTable.followed, false)))
      .returning();
    if (existing) {
      res.status(201).json(AddWatchlistCompanyResponse.parse(serialize(existing)));
      return;
    }
    res.status(409).json({ error: "You are already following this company" });
    return;
  }
  if (board) {
    await syncCompanies([company]);
    // Demo roles are only there to look around; once you follow a real company they go away
    // (unless you already saved or applied to one).
    await db
      .delete(jobsTable)
      .where(and(eq(jobsTable.userId, userId), eq(jobsTable.source, "demo"), sql`${jobsTable.status} in ('new','hidden')`));
  }
  const [fresh] = await db.select().from(watchlistCompaniesTable).where(eq(watchlistCompaniesTable.id, company.id));
  res.status(201).json(AddWatchlistCompanyResponse.parse(serialize(fresh)));
});

router.patch("/watchlist/:id/follow", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const followed = req.body?.followed;
  if (!Number.isInteger(id) || typeof followed !== "boolean") {
    res.status(400).json({ error: "Send { followed: true | false }" });
    return;
  }
  const [company] = await db
    .update(watchlistCompaniesTable)
    .set({ followed })
    .where(and(eq(watchlistCompaniesTable.id, id), eq(watchlistCompaniesTable.userId, getUserId(req))))
    .returning();
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  res.json(AddWatchlistCompanyResponse.parse(serialize(company)));
});

router.delete("/watchlist/:id", async (req, res): Promise<void> => {
  const parsed = RemoveWatchlistCompanyParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = getUserId(req);
  const [company] = await db
    .delete(watchlistCompaniesTable)
    .where(and(eq(watchlistCompaniesTable.id, parsed.data.id), eq(watchlistCompaniesTable.userId, userId)))
    .returning({ id: watchlistCompaniesTable.id });
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  // Jobs you already acted on stay in the tracker; untouched ones go with the company.
  await db
    .delete(jobsTable)
    .where(
      and(eq(jobsTable.userId, userId), eq(jobsTable.companyId, parsed.data.id), sql`${jobsTable.status} in ('new','hidden')`),
    );
  res.status(204).end();
});

export default router;
