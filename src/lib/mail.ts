/**
 * Sending email.
 *
 * One transport, built once and reused, because creating an SMTP connection per message is slow
 * and most providers rate-limit on connections rather than on messages.
 *
 * # Configuration
 *
 * `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, and optionally `APP_URL` for
 * the links in the messages.
 *
 * If SMTP is not configured, registration **fails** rather than quietly creating accounts
 * nobody can ever verify. Silently accepting a sign-up that can never complete is the worse
 * outcome: the user waits for an email that was never sent, and the operator finds out from a
 * complaint rather than from a startup error.
 */

import nodemailer, { type Transporter } from "nodemailer";

export type MailConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

/** The configuration, or `null` when SMTP has not been set up. */
export function mailConfig(): MailConfig | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return {
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    user: SMTP_USER,
    pass: SMTP_PASS,
    from: MAIL_FROM ?? SMTP_USER,
  };
}

export function isMailConfigured(): boolean {
  return mailConfig() !== null;
}

let cached: Transporter | null = null;

function transport(config: MailConfig): Transporter {
  cached ??= nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this backwards is the usual
    // reason a working password still fails to send.
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });
  return cached;
}

/**
 * Where this deployment lives, for links in emails.
 *
 * Prefers an explicit `APP_URL`; falls back to the host the request arrived on, which is right
 * on Vercel and wrong behind a proxy that does not set the header — hence the preference.
 */
export function appUrl(request?: Request): string {
  const explicit = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (request) {
    const url = new URL(request.url);
    const host = request.headers.get("x-forwarded-host") ?? url.host;
    const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

export type Mail = { to: string; subject: string; text: string; html: string };

/**
 * Send a message.
 *
 * @throws if SMTP is not configured, or the send fails. Callers decide what that means — for
 * registration it is fatal, for a resend it is a message the user can retry.
 */
export async function send(mail: Mail): Promise<void> {
  const config = mailConfig();
  if (!config) {
    throw new Error(
      "email is not configured on the server: set SMTP_HOST, SMTP_USER and SMTP_PASS",
    );
  }
  await transport(config).sendMail({
    from: config.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

/**
 * The verification message.
 *
 * Plain text as well as HTML, always. A text part is what makes it render in clients that do
 * not do HTML, and its absence is one of the things spam filters weigh.
 */
export function verificationMail(to: string, link: string, hours: number): Mail {
  const text = [
    "Confirm your email address",
    "",
    "Open this link to finish setting up your Aegis VPN account:",
    link,
    "",
    `The link is valid for ${hours} hours.`,
    "",
    "If you did not create an account, you can ignore this message — nothing will happen.",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e8ec;border-radius:12px;padding:28px">
    <h1 style="margin:0 0 8px;font-size:18px">Confirm your email address</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#444">
      Open the link below to finish setting up your Aegis VPN account. You will not be able to
      connect until you do.
    </p>
    <p style="margin:0 0 20px">
      <a href="${escapeHtml(link)}"
         style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">
        Confirm email
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:12px;color:#666">
      Or paste this into your browser:<br>
      <span style="word-break:break-all">${escapeHtml(link)}</span>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#666">
      The link is valid for ${hours} hours. If you did not create an account, ignore this
      message — nothing will happen.
    </p>
  </div>
</body></html>`;

  return { to, subject: "Confirm your email address", text, html };
}

/** Escape text going into the HTML body. The link is ours, but it costs nothing to be sure. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
