export type SourceName = "greenhouse" | "lever" | "ashby" | "web";

export interface FetchedJob {
  externalId: string;
  title: string;
  location: string;
  applyUrl: string;
  /** Plain text, no HTML. */
  description: string;
  postedAt: Date | null;
}

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
