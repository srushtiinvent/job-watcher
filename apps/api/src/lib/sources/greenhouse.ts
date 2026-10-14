import { htmlToText } from "./html";
import { getJson } from "./http";
import type { FetchedJob } from "./types";

const base = () => process.env.GREENHOUSE_API_BASE ?? "https://boards-api.greenhouse.io";

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  first_published?: string;
  updated_at?: string;
}

export async function fetchGreenhouse(token: string, light = false): Promise<FetchedJob[]> {
  const data = await getJson<{ jobs?: GhJob[] }>(
    `${base()}/v1/boards/${encodeURIComponent(token)}/jobs${light ? "" : "?content=true"}`,
  );
  return (data.jobs ?? []).map((j) => {
    const when = j.first_published ?? j.updated_at;
    return {
      externalId: String(j.id),
      title: j.title,
      location: j.location?.name?.trim() || "Not specified",
      applyUrl: j.absolute_url,
      description: htmlToText(j.content ?? "", true),
      postedAt: when ? new Date(when) : null,
    };
  });
}
