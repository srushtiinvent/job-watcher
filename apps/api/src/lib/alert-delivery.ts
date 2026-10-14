import { and, desc, eq, gt, isNull, ne, sql, type SQL } from "drizzle-orm";
import { syncDb as db, alertRulesTable, jobsTable } from "@workspace/db";
import { logger } from "./logger";

type Rule = { role: string; locations: string[]; experienceLevel: string };

const smtpConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
export const emailConfigured = (): boolean => smtpConfigured() || Boolean(process.env.RESEND_API_KEY);

const esc = (v: string) => v.replace(/[%_\\]/g, "\\$&");

/** SQL conditions for "does this job match this saved search". Shared by the counts and the emails. */
export function ruleConditions(rule: Rule): SQL[] {
  const parts: SQL[] = [];
  const role = rule.role.trim();
  if (role) {
    const term = `%${esc(role)}%`;
    parts.push(
      sql`(${jobsTable.title} ilike ${term} or ${jobsTable.summary} ilike ${term} or array_to_string(${jobsTable.skills}, ' ') ilike ${term})`,
    );
  }
  if (rule.locations.length) {
    const locs = rule.locations.map((l) => sql`${jobsTable.location} ilike ${`%${esc(l)}%`}`);
    parts.push(sql`(${sql.join(locs, sql` or `)})`);
  }
  if (rule.experienceLevel !== "any") parts.push(sql`${jobsTable.experienceLevel} = ${rule.experienceLevel}`);
  return parts;
}

const html = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function recipient(userId: string): Promise<string | null> {
  if (process.env.ALERT_TO_EMAIL) return process.env.ALERT_TO_EMAIL;
  const { clerkClient } = await import("@clerk/express");
  const user = await clerkClient.users.getUser(userId);
  return (user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ?? user.emailAddresses[0])?.emailAddress ?? null;
}

async function sendEmail(to: string, subject: string, bodyHtml: string, text: string): Promise<void> {
  // Gmail (or any SMTP) can email anyone, so it is used when configured.
  if (smtpConfigured()) {
    const { default: nodemailer } = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: (process.env.SMTP_SECURE ?? "true") === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 20_000,
    });
    await transport.sendMail({
      from: process.env.ALERT_FROM ?? `Job Watcher <${process.env.SMTP_USER}>`,
      to,
      subject,
      html: bodyHtml,
      text,
    });
    return;
  }
  const base = process.env.RESEND_API_BASE ?? "https://api.resend.com";
  const res = await fetch(`${base}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.ALERT_FROM ?? "Job Watcher <onboarding@resend.dev>",
      to: [to],
      subject,
      html: bodyHtml,
      text,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Email service said ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

let running = false;

/** Emails each enabled saved search about roles that appeared since its last email. */
export async function runAlerts(): Promise<number> {
  if (!emailConfigured() || running) return 0;
  running = true;
  let sent = 0;
  try {
    const rules = await db.select().from(alertRulesTable).where(eq(alertRulesTable.enabled, true));
    for (const rule of rules) {
      if (!rule.channels.includes("email")) continue;
      try {
        const startedAt = new Date();
        const jobs = await db
          .select({
            title: jobsTable.title,
            company: jobsTable.company,
            location: jobsTable.location,
            url: jobsTable.applicationUrl,
            level: jobsTable.experienceLevel,
          })
          .from(jobsTable)
          .where(
            and(
              eq(jobsTable.userId, rule.userId),
              eq(jobsTable.isSample, false),
              ne(jobsTable.status, "hidden"),
              isNull(jobsTable.closedAt),
              gt(jobsTable.firstSeenAt, rule.lastNotifiedAt),
              ...ruleConditions(rule),
            ),
          )
          .orderBy(desc(jobsTable.firstSeenAt))
          .limit(16);
        if (jobs.length === 0) continue;

        const to = await recipient(rule.userId);
        if (!to) continue;
        const shown = jobs.slice(0, 15);
        const more = jobs.length > 15;
        const subject = `${more ? "15+" : jobs.length} new ${rule.role} role${jobs.length === 1 ? "" : "s"} on Job Watcher`;
        const rows = shown
          .map(
            (j) =>
              `<li style="margin:0 0 12px"><a href="${html(j.url)}" style="font-size:15px;font-weight:600;color:#2f6465">${html(j.title)}</a><br><span style="color:#555">${html(j.company)} · ${html(j.location)}</span></li>`,
          )
          .join("");
        const body = `<div style="font-family:Arial,sans-serif;max-width:560px"><p>New roles matching your saved search <strong>${html(rule.role)}</strong>:</p><ul style="padding-left:18px">${rows}</ul>${more ? "<p>…and more. Open Job Watcher to see them all.</p>" : ""}<p style="color:#888;font-size:12px">You get this because the alert is on in Job Watcher. Turn it off on the Alerts page.</p></div>`;
        const text = shown.map((j) => `${j.title} - ${j.company} (${j.location})\n${j.url}`).join("\n\n");
        await sendEmail(to, subject, body, text);
        await db.update(alertRulesTable).set({ lastNotifiedAt: startedAt }).where(eq(alertRulesTable.id, rule.id));
        sent += 1;
      } catch (err) {
        logger.error({ err, ruleId: rule.id }, "alert email failed");
      }
    }
  } finally {
    running = false;
  }
  return sent;
}
