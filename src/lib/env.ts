/**
 * Small typed reader for the handful of settings Phase 1 needs.
 * Values are read lazily so tests can change process.env between cases.
 */
function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw.toLowerCase() === "true" || raw === "1";
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

function optional(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? undefined : raw;
}

export const config = {
  /** Seconds a live session may go without re-reading users.status/role. 0 = every request. */
  get sessionRevalidateSeconds() {
    return num("SESSION_REVALIDATE_SECONDS", 30);
  },
  get inviteTtlHours() {
    return num("INVITE_TTL_HOURS", 72);
  },
  /** Plan, section 7: "Create contract — Outside Sales: No / limited (configurable)". */
  get outsideSalesCanCreateContract() {
    return bool("OUTSIDE_SALES_CAN_CREATE_CONTRACT", false);
  },
  /** Plan, section 7: "Create client — Outside Sales: Yes (own, may require approval)". */
  get outsideSalesClientRequiresApproval() {
    return bool("OUTSIDE_SALES_CLIENT_REQUIRES_APPROVAL", false);
  },

  // ---- Phase 5 ----

  /** Absolute base for links inside emails; AUTH_URL already points at this app. */
  get appUrl() {
    return str("AUTH_URL", "http://localhost:3000").replace(/\/+$/, "");
  },

  /** Section 8: "contract expiring in N days". */
  get contractExpiryWarningDays() {
    return num("CONTRACT_EXPIRY_WARNING_DAYS", 30);
  },

  get mailFrom() {
    return str("MAIL_FROM", "Rei CRM <no-reply@radx.app>");
  },

  /**
   * With no SMTP_HOST the mailer falls back to a transport that logs the message
   * instead of sending it — so a dev machine and the test suite need no server,
   * and a missing production setting is loud in the logs rather than silent.
   */
  get smtp() {
    const host = optional("SMTP_HOST");
    if (!host) return null;
    const user = optional("SMTP_USER");
    const pass = optional("SMTP_PASSWORD");
    return {
      host,
      port: num("SMTP_PORT", 587),
      secure: bool("SMTP_SECURE", false),
      auth: user && pass ? { user, pass } : undefined,
    };
  },

  /** The worker sets this; the web process only enqueues. */
  get jobsEnabled() {
    return bool("JOBS_ENABLED", true) && Boolean(optional("DATABASE_URL"));
  },

  /** Cron for the nightly rollup and the daily contract sweep, in the server's UTC. */
  get nightlyCron() {
    return str("NIGHTLY_CRON", "15 2 * * *");
  },

  // ---- Phase 6 ----

  /** The daily digest goes out after the sweep, so a morning email is complete. */
  get digestCron() {
    return str("DIGEST_CRON", "0 6 * * *");
  },

  /** Section 8: the monthly report, on the 1st. */
  get monthlyReportCron() {
    return str("MONTHLY_REPORT_CRON", "30 6 1 * *");
  },
};
