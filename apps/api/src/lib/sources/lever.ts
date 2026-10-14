import { htmlToText } from "./html";
import { getJson } from "./http";
import type { FetchedJob } from "./types";

const base = () => process.env.LEVER_API_BASE ?? "https://api.lever.co";

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  descriptionPlain?: string;
  description?: string;
  additionalPlain?: string;
  lists?: Array<{ text?: string; content?: string }>;
  workplaceType?: string;
  categories?: { location?: string; allLocations?: string[] };
}

export async function fetchLever(token: string): Promise<FetchedJob[]> {
  const data = await getJson<LeverJob[]>(`${base()}/v0/postings/${encodeURIComponent(token)}?mode=json`);
  if (!Array.isArray(data)) return [];
  return data.map((j) => {
    const listText = (j.lists ?? []).map((l) => `${l.text ?? ""}\n${htmlToText(l.content ?? "")}`).join("\n\n");
    const description = [j.descriptionPlain ?? htmlToText(j.description ?? ""), listText, j.additionalPlain ?? ""]
      .filter(Boolean)
      .join("\n\n")
      .trim();
    const loc = j.categories?.location || j.categories?.allLocations?.join(", ") || "";
    const withType = j.workplaceType === "remote" && !/remote/i.test(loc) ? `${loc ? loc + " · " : ""}Remote` : loc;
    return {
      externalId: j.id,
      title: j.text,
      location: withType || "Not specified",
      applyUrl: j.hostedUrl || j.applyUrl || "",
      description,
      postedAt: typeof j.createdAt === "number" ? new Date(j.createdAt) : null,
    };
  });
}
