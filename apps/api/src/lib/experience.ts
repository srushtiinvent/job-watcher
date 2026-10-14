/**
 * Works out which experience level a job is meant for, from its title and text.
 * Pure functions, no network or database, so it is easy to test.
 */

export const LEVELS = ["internship", "fresher", "junior", "mid", "senior", "unspecified"] as const;
export type Level = (typeof LEVELS)[number];

export interface Classification {
  level: Level;
  minYears: number | null;
  maxYears: number | null;
  /** Human-readable, e.g. "0–1 years", "3+ years", "Not stated". */
  label: string;
  /** 0 when not a fresher role, otherwise how confident we are. */
  fresherMatch: number;
  batchYear: number | null;
}

const SENIOR_TITLE =
  /\b(senior|sr\.?|staff|principal|lead|head of|director|manager|architect|vp|vice president|distinguished|engineer\s+(iii|iv|v)|sde[\s-]*(3|iii)|level\s*(3|4|5))\b/i;
const INTERN_TITLE = /\b(intern|interns|internship|apprentice|co-?op|working student)\b/i;
const FRESHER_TITLE =
  /\b(new\s*grad(uate)?s?|graduate|fresher|entry[\s-]*level|campus|early\s*career|trainee|(engineer|developer|analyst|sde)[\s-]*(i|1)\b|associate\s+(software|engineer|developer))/i;
const JUNIOR_TITLE = /\b(junior|jr\.?|(engineer|developer|sde)[\s-]*(ii|2)\b)/i;

const FRESHER_PHRASES =
  /\b(freshers?|recent\s+graduates?|new\s+graduates?|fresh\s+graduates?|no\s+(prior\s+)?(work\s+)?experience\s+(is\s+)?(required|needed)|0\s*(?:-|–|to)\s*1\s*years?|class\s+of\s+20\d\d|20\d\d\s+(batch|graduates?|passouts?))\b/i;

const YEARS_NUM = "(\\d{1,2})";
const RANGE = `${YEARS_NUM}\\s*(?:\\+|plus)?\\s*(?:(?:-|–|—|to)\\s*${YEARS_NUM})?\\s*\\+?`;
const YEARS_BEFORE = new RegExp(
  `${RANGE}\\s*(?:years?|yrs?)(?:'|’)?\\s*(?:of\\s+)?(?:[a-z,/&\\-\\s]{0,40}?)experience`,
  "gi",
);
const YEARS_AFTER = new RegExp(
  `experience[^.\\n]{0,40}?(?:minimum\\s+of\\s+|at\\s+least\\s+)?${RANGE}\\s*(?:years?|yrs?)`,
  "gi",
);
const MIN_OF = new RegExp(`(?:minimum|at\\s+least|min\\.?)\\s+(?:of\\s+)?${YEARS_NUM}\\s*\\+?\\s*(?:years?|yrs?)`, "gi");

function pushMatches(re: RegExp, text: string, out: Array<[number, number | null]>) {
  for (const m of text.matchAll(re)) {
    const min = Number(m[1]);
    const max = m[2] === undefined ? null : Number(m[2]);
    // Ignore things like "20 years of experience building the company" noise > 25 and "2026"
    if (min > 25 || (max !== null && (max > 30 || max < min))) continue;
    out.push([min, max]);
  }
}

export function extractYears(text: string): { min: number; max: number | null } | null {
  const found: Array<[number, number | null]> = [];
  pushMatches(YEARS_BEFORE, text, found);
  pushMatches(YEARS_AFTER, text, found);
  pushMatches(MIN_OF, text, found);
  if (found.length === 0) return null;
  // Postings often list a lower number for the "required" and a higher one for "preferred";
  // the smallest requirement is what decides if you can apply.
  found.sort((a, b) => a[0] - b[0]);
  const [min, max] = found[0];
  return { min, max };
}

export function extractBatchYear(text: string): number | null {
  const m =
    text.match(/\b(?:class|batch)\s+of\s+(20\d\d)\b/i) ??
    text.match(/\b(20\d\d)\s+(?:batch|graduates?|passouts?|grads?)\b/i) ??
    text.match(/\bgraduat\w*\s+(?:in|by|before)?\s*(20\d\d)\b/i);
  if (!m) return null;
  const year = Number(m[1]);
  return year >= 2020 && year <= 2035 ? year : null;
}

function levelFromYears(min: number): Level {
  if (min < 1) return "fresher";
  if (min <= 2) return "junior";
  if (min <= 4) return "mid";
  return "senior";
}

export function yearsLabel(min: number | null, max: number | null): string {
  if (min === null) return "Not stated";
  if (max !== null && max !== min) return `${min}–${max} years`;
  if (max === min) return min === 1 ? "1 year" : `${min} years`;
  return `${min}+ years`;
}

export function classify(title: string, body = ""): Classification {
  const text = `${title}\n${body}`;
  const years = extractYears(body);
  const batchYear = extractBatchYear(text);

  let level: Level = "unspecified";
  let minYears: number | null = years?.min ?? null;
  let maxYears: number | null = years?.max ?? null;

  if (INTERN_TITLE.test(title)) {
    level = "internship";
  } else if (SENIOR_TITLE.test(title)) {
    level = "senior";
  } else if (years) {
    level = levelFromYears(years.min);
  } else if (FRESHER_TITLE.test(title)) {
    level = "fresher";
  } else if (JUNIOR_TITLE.test(title)) {
    level = "junior";
  } else if (FRESHER_PHRASES.test(body)) {
    level = "fresher";
  }

  let entryLevelWording = false;
  if (level === "fresher" && minYears === null) {
    minYears = 0;
    entryLevelWording = true;
  }
  if (level === "internship") {
    minYears = 0;
    maxYears = null;
  }

  let fresherMatch = 0;
  if (level === "fresher") {
    fresherMatch = 78;
    if (FRESHER_TITLE.test(title)) fresherMatch += 10;
    if (FRESHER_PHRASES.test(body)) fresherMatch += 6;
    if (batchYear) fresherMatch += 4;
    fresherMatch = Math.min(98, fresherMatch);
  } else if (level === "internship") {
    fresherMatch = 55;
  } else if (level === "junior") {
    fresherMatch = 35;
  }

  return {
    level,
    minYears,
    maxYears,
    label: level === "internship" ? "Internship" : entryLevelWording ? "Entry level" : yearsLabel(minYears, maxYears),
    fresherMatch,
    batchYear,
  };
}

const SKILLS = [
  "TypeScript", "JavaScript", "React", "Next.js", "Node.js", "Python", "Java", "Kotlin", "Go", "Rust",
  "C++", "C#", "Swift", "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Kafka", "GraphQL", "REST",
  "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "Linux", "Git", "CI/CD", "Machine Learning",
  "PyTorch", "TensorFlow", "Spark", "Airflow", "Flutter", "Android", "iOS", "Tailwind", "Playwright", "Selenium",
];

export function extractSkills(text: string, limit = 6): string[] {
  const out: string[] = [];
  for (const skill of SKILLS) {
    const escaped = skill.replace(/[.+/]/g, "\\$&");
    const re = new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9+#])`, "i");
    if (re.test(text)) out.push(skill);
    if (out.length >= limit) break;
  }
  return out;
}
