import { htmlToText } from "./html";
import { getJson } from "./http";
import type { FetchedJob } from "./types";

const base = () => process.env.ASHBY_API_BASE ?? "https://api.ashbyhq.com";

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  isRemote?: boolean;
  isListed?: boolean;
  descriptionPlain?: string;
  descriptionHtml?: string;
  publishedAt?: string;
  jobUrl: string;
  applyUrl?: string;
}

export async function fetchAshby(token: string): Promise<FetchedJob[]> {
  const data = await getJson<{ jobs?: AshbyJob[] }>(
    `${base()}/posting-api/job-board/${encodeURIComponent(token)}`,
  );
  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const loc = j.location?.trim() ?? "";
      const location = j.isRemote && !/remote/i.test(loc) ? `${loc ? loc + " · " : ""}Remote` : loc;
      return {
        externalId: j.id,
        title: j.title,
        location: location || "Not specified",
        applyUrl: j.jobUrl || j.applyUrl || "",
        description: j.descriptionPlain?.trim() || htmlToText(j.descriptionHtml ?? ""),
        postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
      };
    });
}
