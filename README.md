# Job Watcher

Follow companies, and Job Watcher pulls their open roles straight from their career pages
(Greenhouse, Lever and Ashby), works out the experience level of each role, and lets you filter by it.

- **Experience level filter:** Internship, Fresher (0–1), Junior (1–3), Mid-level (3–5), Senior (5+), or
  **Not specified** for postings that don't state a requirement. Anyone can pick their own level; the default is saved per account.
- **All companies at once:** about 40 well-known companies are loaded for you automatically on first visit, so you can browse without following anything. Click **Follow** on companies you care about and use the **Following** tab to see only those.
- **Location filter**, company filter, search, "posted in last 24h".
- **Applied / Saved** buttons on every job, plus an Applications page (Saved → Applied → Assessment → Interview → Offer → Rejected)
  with follow-up dates and notes.
- Jobs that disappear from a company's board are marked **Closed** (kept if you applied).
- Light theme (default, "Coastal Study") and dark theme ("Rainy Library").
- Sign in with Google (through Clerk).

## What you need

- Node 22 or newer, and [pnpm](https://pnpm.io) (`npm i -g pnpm`)
- A Postgres database (local, or a free one from [Neon](https://neon.tech) / [Supabase](https://supabase.com))
- A free [Clerk](https://clerk.com) application with **Google** turned on

## Setup

```bash
pnpm install
cp .env.example .env      # then fill in DATABASE_URL and the three Clerk keys
pnpm db:push              # creates the tables
pnpm dev                  # API on :8080, website on http://localhost:5173
```

Open http://localhost:5173, sign in with Google, click **Follow a company**, and paste a careers link such as
`https://boards.greenhouse.io/<company>`, `https://jobs.lever.co/<company>` or `https://jobs.ashbyhq.com/<company>`.
You can also type just the company name and it will try to find the board.

Greenhouse, Lever and Ashby boards work best. For any other careers page, Job Watcher reads the page's built-in job data
(schema.org `JobPosting`, which many sites publish for Google Jobs). If the page is only a list, it follows up to 25 job links on the same site.
It obeys `robots.txt`, waits between requests and refuses private/local addresses (set `ALLOW_PRIVATE_URLS=true` only for testing).
Pages that build their job list with JavaScript, Workday sites, and LinkedIn/Indeed/Naukri/Glassdoor are not supported.

## Running it for real (one process)

```bash
pnpm build
pnpm start                # serves the API and the website on :8080
```

Put it on any Node host with a Postgres database (Render, Railway, Fly.io…). Set the same variables from `.env`
as environment variables, and add your site's address in the Clerk dashboard.
The server re-checks every followed company every 30 minutes while it is running. Free hosts that sleep
will only check while awake.

## Other commands

| Command | What it does |
| --- | --- |
| `pnpm test` | unit tests (experience detection) and a fetch/dedupe/close test against a fake job board (needs `DATABASE_URL`) |
| `pnpm typecheck` | TypeScript check for everything |
| `pnpm codegen` | regenerate the API client after editing `lib/api-spec/openapi.yaml` |

## How it works

- `apps/api/src/lib/sources/` – one small fetcher per career-site API, all returning the same job shape.
- `apps/api/src/lib/experience.ts` – reads the title and description: "Senior/Staff/Lead" → senior, "Intern" → internship,
  "X years of experience" → by years (the smallest stated requirement is used), "graduate / entry level / freshers" → fresher.
  If nothing is stated, the role is **Not specified** instead of guessed.
- `apps/api/src/lib/sync.ts` – fetches each board once, de-duplicates by job id, keeps your status/notes when a job is refreshed,
  marks vanished jobs as closed, and runs on a timer.
- `apps/web` – React + Tailwind. `lib/` – database schema, OpenAPI spec and generated clients.

## Known limits

- Experience level is **detected from text**, so it can be wrong. Always read the posting.
- Alerts are saved and counted, but **email / Telegram delivery is not built yet**.
- Company names in the "Try one" chips are suggestions; if a company moved its job board, you will see "No … job board found".
- Dates are the dates the company published the posting (or when it was first seen, if the site doesn't give one).
- The fetchers were tested against a fake job board that mimics the Greenhouse, Lever and Ashby responses.
  If a real board ever fails to load, the company row shows the error ("last status") — please report it so the fetcher can be adjusted.
