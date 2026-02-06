import nodemailer from 'nodemailer';

const smtpHost = process.env.SMTP_HOST;
const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM;

if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
  console.warn('[email] Missing SMTP configuration.');
}

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
});

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}) {
  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    throw new Error('SMTP configuration missing.');
  }

  return transporter.sendMail({
    from: smtpFrom,
    to,
    subject,
    text,
    html,
  });
}
