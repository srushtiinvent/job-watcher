import { SourceError } from "./types";

export async function getJson<T>(url: string, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "job-watcher/1.0 (personal job search tool)" },
    });
    if (res.status === 404) throw new SourceError("Board not found", 404);
    if (!res.ok) throw new SourceError(`Career site answered with HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof SourceError) throw err;
    if ((err as Error)?.name === "AbortError") throw new SourceError("Career site took too long to answer");
    throw new SourceError(`Could not reach the career site (${(err as Error)?.message ?? "network error"})`);
  } finally {
    clearTimeout(timer);
  }
}
