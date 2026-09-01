/**
 * Sending email.
 *
 * One transport, built once and reused, because creating an SMTP connection per message is slow
 * and most providers rate-limit on connections rather than on messages.
 *
 * # Configuration
 *
 * `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`.
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
 *
 * The code appears in the subject line as well as the body, so it can be read from a
 * notification without opening anything.
 */
export function verificationMail(to: string, code: string, minutes: number): Mail {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;

  const text = [
    `Your Aegis confirmation code is ${code}`,
    "",
    `Enter it in the Aegis app. It expires in ${minutes} minutes.`,
    "",
    "If you did not create an account, you can ignore this message — nothing will happen.",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e8ec;border-radius:12px;padding:28px;text-align:center">
    <h1 style="margin:0 0 8px;font-size:18px">Confirm your email address</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#444">
      Enter this code in the Aegis app.
    </p>
    <div style="margin:0 0 20px;font-size:32px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">
      ${escapeHtml(spaced)}
    </div>
    <p style="margin:0;font-size:12px;color:#666">
      It expires in ${minutes} minutes. If you did not create an account, ignore this message —
      nothing will happen.
    </p>
  </div>
</body></html>`;

  return { to, subject: `${code} is your Aegis confirmation code`, text, html };
}

/** Escape text going into the HTML body. The code is six digits, but it costs nothing. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
