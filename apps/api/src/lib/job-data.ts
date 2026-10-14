import { and, eq } from "drizzle-orm";
import { db, jobsTable, trackerProfilesTable } from "@workspace/db";
import { classify } from "./experience";
import { addStarterCompanies } from "./starter";

const sampleJobs = [
  {
    title: "Graduate Software Engineer",
    company: "Northstar Labs",
    companyInitials: "NL",
    location: "Bengaluru · Hybrid",
    experience: "0–1 years",
    batchYear: 2026,
    summary: "Build reliable product features with a small engineering team.",
    description:
      "This illustrative role is for an early-career engineer who enjoys learning by building. You would work with product and design to ship user-facing features, improve API reliability, and take part in thoughtful code reviews.\n\nWhat you would do:\n• Build and maintain TypeScript services and React interfaces.\n• Write tests and take part in code reviews.\n• Work with teammates to break product problems into small releases.\n\nWhat helps:\n• A 2025 or 2026 graduation year.\n• Familiarity with JavaScript or TypeScript, HTTP APIs, and relational data.\n• Curiosity, clear communication, and a willingness to learn.",
    skills: ["TypeScript", "React", "APIs", "SQL"],
    applicationUrl: "https://example.com/northstar/graduate-engineer",
    fresherMatch: 94,
  },
  {
    title: "Associate Product Analyst",
    company: "Cedarbyte",
    companyInitials: "CB",
    location: "Bengaluru · Hybrid",
    experience: "0–1 years",
    batchYear: 2026,
    summary: "Help turn customer questions into clear product decisions.",
    description:
      "This sample opportunity introduces a new graduate to product analytics. The analyst partners with product and customer teams to define questions, validate data, and share practical recommendations.\n\nWhat you would do:\n• Explore usage data with SQL and spreadsheets.\n• Help define experiment and feature-success measures.\n• Present findings in short, clear written updates.\n\nWhat helps:\n• A 2025 or 2026 graduation year.\n• Comfort with SQL, careful reasoning, and written communication.",
    skills: ["SQL", "Analytics", "Product", "Excel"],
    applicationUrl: "https://example.com/cedarbyte/product-analyst",
    fresherMatch: 91,
  },
  {
    title: "Frontend Engineer I",
    company: "Morrow Systems",
    companyInitials: "MS",
    location: "Hyderabad · On-site",
    experience: "0–1 years",
    batchYear: 2026,
    summary: "Shape accessible, responsive interfaces for everyday workflows.",
    description:
      "This illustrative entry-level frontend role focuses on accessible UI and dependable interaction patterns. New team members get paired reviews and a clear onboarding plan.\n\nWhat you would do:\n• Build responsive React components.\n• Check keyboard access and browser behavior.\n• Collaborate with design and backend engineering.\n\nWhat helps:\n• A 2025 or 2026 graduation year.\n• Familiarity with React, CSS, and browser fundamentals.",
    skills: ["React", "CSS", "Accessibility", "JavaScript"],
    applicationUrl: "https://example.com/morrow/frontend-engineer",
    fresherMatch: 88,
  },
  {
    title: "QA Automation Associate",
    company: "Bluefin Technologies",
    companyInitials: "BT",
    location: "Pune · Hybrid",
    experience: "0–1 years",
    batchYear: 2026,
    summary: "Help a quality engineering team catch regressions early.",
    description:
      "This sample role is intended for graduates interested in product quality and test automation. The team pairs with engineers to make reliable tests part of the delivery process.\n\nWhat you would do:\n• Write and maintain browser-based smoke tests.\n• Investigate issues and document clear reproduction steps.\n• Help improve test coverage for core customer journeys.\n\nWhat helps:\n• A 2025 or 2026 graduation year.\n• Basic JavaScript or Python and careful attention to detail.",
    skills: ["Testing", "Playwright", "JavaScript", "QA"],
    applicationUrl: "https://example.com/bluefin/qa-associate",
    fresherMatch: 86,
  },
  {
    title: "Backend Developer, New Grad",
    company: "Saltwater Digital",
    companyInitials: "SD",
    location: "Remote · India",
    experience: "0–1 years",
    batchYear: 2026,
    summary: "Learn service ownership while building small, dependable APIs.",
    description:
      "This example role offers structured onboarding for a new graduate joining a distributed backend team.\n\nWhat you would do:\n• Build API endpoints and data migrations with guidance.\n• Add monitoring and write tests for service behavior.\n• Share progress asynchronously with a remote team.\n\nWhat helps:\n• A 2025 or 2026 graduation year.\n• Familiarity with one backend language, SQL, and HTTP.",
    skills: ["Node.js", "PostgreSQL", "REST", "Testing"],
    applicationUrl: "https://example.com/saltwater/backend-new-grad",
    fresherMatch: 92,
  },
] satisfies Array<
  Omit<
    typeof jobsTable.$inferInsert,
    | "id"
    | "userId"
    | "postedAt"
    | "firstSeenAt"
    | "status"
    | "isSample"
    | "followUpDate"
    | "notes"
    | "createdAt"
    | "updatedAt"
  >
>;

const initialized = new Set<string>();

/** Creates the profile row once, and on the very first visit follows the popular companies. */
export async function ensureUserInitialized(userId: string): Promise<void> {
  if (initialized.has(userId)) return;
  await db.insert(trackerProfilesTable).values({ userId }).onConflictDoNothing();
  const claimed = await db
    .update(trackerProfilesTable)
    .set({ starterAdded: true })
    .where(and(eq(trackerProfilesTable.userId, userId), eq(trackerProfilesTable.starterAdded, false)))
    .returning({ userId: trackerProfilesTable.userId });
  initialized.add(userId);
  if (claimed.length) await addStarterCompanies(userId);
}

/** Adds clearly marked demo roles (never automatic). Returns how many were added. */
export async function loadDemoJobs(userId: string): Promise<number> {
  const now = Date.now();
  const offsetsInMinutes = [12, 48, 185, 440, 30 * 60];
  const inserted = await db
    .insert(jobsTable)
    .values(
      sampleJobs.map((job, index) => {
        const postedAt = new Date(now - offsetsInMinutes[index] * 60_000);
        const c = classify(job.title, job.description);
        return {
          ...job,
          userId,
          source: "demo",
          externalId: `demo-${index + 1}`,
          experienceLevel: c.level === "unspecified" ? "fresher" : c.level,
          minYears: 0,
          maxYears: 1,
          postedAt,
          firstSeenAt: postedAt,
          status: "new",
          isSample: true,
        };
      }),
    )
    .onConflictDoNothing()
    .returning({ id: jobsTable.id });
  return inserted.length;
}

export type ApiJob = Omit<
  typeof jobsTable.$inferSelect,
  "postedAt" | "firstSeenAt" | "lastSeenAt" | "closedAt" | "createdAt" | "updatedAt" | "followUpDate"
> & {
  lastSeenAt: string;
  closedAt: string | null;
  postedAt: string;
  firstSeenAt: string;
  createdAt: string;
  updatedAt: string;
  followUpDate: string | null;
};

export function serializeJob(job: typeof jobsTable.$inferSelect): ApiJob {
  return {
    ...job,
    postedAt: job.postedAt.toISOString(),
    firstSeenAt: job.firstSeenAt.toISOString(),
    lastSeenAt: job.lastSeenAt.toISOString(),
    closedAt: job.closedAt ? job.closedAt.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    followUpDate: job.followUpDate ?? null,
  };
}

export function initialsFromName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}
