import { decodeEntities, htmlToText } from "./html";
import { SourceError, type FetchedJob } from "./types";

/**
 * Reads jobs from any careers page that publishes schema.org "JobPosting" data (JSON-LD).
 * Many company sites do, because Google Jobs needs it. If the page you give is a list of jobs
 * with no data of its own, we follow up to MAX_DETAIL_PAGES job links on the same site.
 *
 * Polite by design: honours robots.txt, identifies itself, waits between requests,
 * and only keeps the title, location, description and link.
 */

const UA = "job-watcher/1.0 (personal job search tool)";
const MAX_DETAIL_PAGES = Number(process.env.WEB_MAX_DETAIL_PAGES ?? 25);
const DELAY_MS = Number(process.env.WEB_DELAY_MS ?? 400);
const MAX_BYTES = 2_000_000;

/** Returns a clean http(s) URL, or null if the text is not a web address. */
export function parseWebUrl(input: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Stops a hosted copy from being used to poke at private networks. */
function assertPublicHost(url: URL): void {
  if (process.env.ALLOW_PRIVATE_URLS === "true") return;
  const h = url.hostname.toLowerCase();
  const privateV4 = /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/;
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "[::1]" || privateV4.test(h)) {
    throw new SourceError("That address is not a public website");
  }
}

async function getText(url: string, accept = "text/html,application/xhtml+xml"): Promise<string> {
  const parsed = new URL(url);
  assertPublicHost(parsed);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept, "user-agent": UA } });
    if (res.status === 404) throw new SourceError("Page not found", 404);
    if (!res.ok) throw new SourceError(`The site answered with HTTP ${res.status}`, res.status);
    const text = await res.text();
    return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
  } catch (err) {
    if (err instanceof SourceError) throw err;
    if ((err as Error)?.name === "AbortError") throw new SourceError("The site took too long to answer");
    throw new SourceError(`Could not reach the site (${(err as Error)?.message ?? "network error"})`);
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal robots.txt check: is this path blocked for everyone ("User-agent: *")? */
export async function allowedByRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  let body: string;
  try {
    body = await getText(`${u.origin}/robots.txt`, "text/plain");
  } catch {
    return true; // no robots.txt (or unreachable): nothing forbids us
  }
  let applies = false;
  let blocked = false;
  let allowedLonger = 0;
  let disallowLen = -1;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") applies = value === "*";
    else if (applies && key === "disallow" && value && u.pathname.startsWith(value)) disallowLen = Math.max(disallowLen, value.length);
    else if (applies && key === "allow" && value && u.pathname.startsWith(value)) allowedLonger = Math.max(allowedLonger, value.length);
  }
  blocked = disallowLen >= 0 && allowedLonger < disallowLen;
  return !blocked;
}

function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      /* ignore broken blocks */
    }
  }
  return out;
}

function collectPostings(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    node.forEach((n) => collectPostings(n, found));
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.includes("JobPosting")) found.push(obj);
    for (const key of ["@graph", "itemListElement", "item", "mainEntity"]) if (key in obj) collectPostings(obj[key], found);
  }
  return found;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function locationOf(p: Record<string, unknown>): string {
  const parts: string[] = [];
  const locs = Array.isArray(p.jobLocation) ? p.jobLocation : p.jobLocation ? [p.jobLocation] : [];
  for (const l of locs as Record<string, unknown>[]) {
    const a = (l?.address ?? l) as Record<string, unknown>;
    const country = typeof a?.addressCountry === "object" ? str((a.addressCountry as Record<string, unknown>)?.name) : str(a?.addressCountry);
    const text = [str(a?.addressLocality), str(a?.addressRegion), country].filter(Boolean).join(", ");
    if (text) parts.push(text);
  }
  const remote = str(p.jobLocationType).toUpperCase() === "TELECOMMUTE";
  const base = [...new Set(parts)].join(" / ");
  if (remote) return base ? `${base} · Remote` : "Remote";
  return base || "Not specified";
}

function toJob(p: Record<string, unknown>, pageUrl: string): FetchedJob | null {
  const title = decodeEntities(str(p.title));
  if (!title) return null;
  const idValue = typeof p.identifier === "object" ? str((p.identifier as Record<string, unknown>)?.value) : str(p.identifier);
  const link = str(p.url) || str((p as Record<string, unknown>)["@id"]) || pageUrl;
  let applyUrl = pageUrl;
  try {
    applyUrl = new URL(link, pageUrl).toString();
  } catch {
    /* keep pageUrl */
  }
  const rawDesc = str(p.description);
  const description = htmlToText(/&lt;|&gt;/.test(rawDesc) ? decodeEntities(rawDesc) : rawDesc);
  const posted = str(p.datePosted);
  const date = posted ? new Date(posted) : null;
  return {
    externalId: idValue ? `${new URL(applyUrl).host}:${idValue}` : applyUrl,
    title,
    location: locationOf(p),
    applyUrl,
    description,
    postedAt: date && !Number.isNaN(date.getTime()) ? date : null,
  };
}

const JOB_LINK = /(\/jobs?\/|\/careers?\/.+|\/positions?\/|\/openings?\/|\/vacanc|\/opportunit|\/job-?details|\/requisition|\/apply\b|jobid=|gh_jid=)/i;

function jobLinks(html: string, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const links = new Set<string>();
  const re = /<a\s[^>]*href\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(decodeEntities(m[1]), pageUrl);
      if (u.host !== base.host || !/^https?:$/.test(u.protocol)) continue;
      u.hash = "";
      const full = u.toString();
      if (full === pageUrl || /\.(png|jpe?g|svg|pdf|css|js|ico|webp)$/i.test(u.pathname)) continue;
      if (JOB_LINK.test(u.pathname + u.search)) links.add(full);
    } catch {
      /* skip bad link */
    }
  }
  return [...links];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWeb(pageUrl: string): Promise<FetchedJob[]> {
  const url = parseWebUrl(pageUrl);
  if (!url) throw new SourceError("That is not a web address");
  if (!(await allowedByRobots(url))) throw new SourceError("This site's robots.txt asks automated tools not to read that page");

  const html = await getText(url);
  const jobs = new Map<string, FetchedJob>();
  const add = (page: string, source: string) => {
    for (const block of jsonLdBlocks(source)) {
      for (const posting of collectPostings(block)) {
        const job = toJob(posting, page);
        if (job) jobs.set(job.externalId, job);
      }
    }
  };
  add(url, html);

  if (jobs.size === 0) {
    const links = jobLinks(html, url).slice(0, MAX_DETAIL_PAGES);
    for (const link of links) {
      if (!(await allowedByRobots(link))) continue;
      await sleep(DELAY_MS);
      try {
        add(link, await getText(link));
      } catch {
        /* one broken job page should not fail the whole company */
      }
    }
  }
  return [...jobs.values()];
}
