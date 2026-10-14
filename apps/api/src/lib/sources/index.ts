import { fetchAshby } from "./ashby";
import { fetchGreenhouse } from "./greenhouse";
import { fetchLever } from "./lever";
import { fetchWeb } from "./web";
import { SourceError, type FetchedJob, type SourceName } from "./types";

export * from "./types";

export const SOURCES: SourceName[] = ["greenhouse", "lever", "ashby"]; // tried when only a company name is given
export { parseWebUrl } from "./web";

export async function fetchBoard(source: SourceName, token: string, light = false): Promise<FetchedJob[]> {
  const jobs =
    source === "greenhouse" ? await fetchGreenhouse(token, light)
    : source === "lever" ? await fetchLever(token)
    : source === "ashby" ? await fetchAshby(token)
    : await fetchWeb(token);
  return jobs.filter((j) => j.title && j.applyUrl);
}

/** Pulls the ATS and board name out of a careers-page link. */
export function parseCareersUrl(input: string): { source: SourceName; boardToken: string } | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const first = url.pathname.split("/").filter(Boolean)[0];
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io" || host.endsWith(".greenhouse.io")) {
    const token = url.searchParams.get("for") || (first && first !== "embed" ? first : null);
    return token ? { source: "greenhouse", boardToken: token } : null;
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    return first ? { source: "lever", boardToken: first } : null;
  }
  if (host === "jobs.ashbyhq.com") {
    return first ? { source: "ashby", boardToken: first } : null;
  }
  return null;
}

/** Tries a company name as a board name on each ATS. Returns the first that exists. */
export async function detectBoard(name: string): Promise<{ source: SourceName; boardToken: string } | null> {
  const base = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
  const dashed = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const candidates = [...new Set([base, dashed])].filter(Boolean);
  for (const token of candidates) {
    for (const source of SOURCES) {
      try {
        const jobs = await fetchBoard(source, token);
        if (jobs.length >= 0) return { source, boardToken: token };
      } catch (err) {
        if (err instanceof SourceError && err.status === 404) continue;
        if (err instanceof SourceError) continue;
        throw err;
      }
    }
  }
  return null;
}
