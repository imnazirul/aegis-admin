/**
 * Prove SMTP works before trusting it in production.
 *
 *   node scripts/smtp-check.mjs you@example.com
 *
 * Reads the same variables the app does, so a pass here means registration will send.
 */
import { config } from "dotenv";
import nodemailer from "nodemailer";

config({ path: ".env.local" });

const to = process.argv[2] ?? process.env.SMTP_USER;
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.error("SMTP_HOST, SMTP_USER and SMTP_PASS must be set in .env.local");
  process.exit(2);
}

const port = Number(SMTP_PORT ?? 587);
const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

console.log(`connecting to ${SMTP_HOST}:${port} as ${SMTP_USER}…`);
await transport.verify();
console.log("credentials accepted");

const info = await transport.sendMail({
  from: MAIL_FROM ?? SMTP_USER,
  to,
  subject: "Aegis SMTP check",
  text: "If you are reading this, Aegis can send email. Nothing else to do.",
  html: "<p>If you are reading this, Aegis can send email. Nothing else to do.</p>",
});
console.log(`sent to ${to} (${info.messageId})`);
