// =============================================================================
// Tax Consulting Group — Contact form serverless function (Vercel-style)
// -----------------------------------------------------------------------------
// Deployment notes
//   • This is a serverless API route. On Vercel it is served at  /api/contact
//     automatically (file-based routing). On Netlify, move it to
//     netlify/functions/contact.js and adjust the export to the Netlify
//     handler signature, then set the front-end endpoint to
//     /.netlify/functions/contact.
//   • Install the mailer dependency before deploying:   npm i nodemailer
//   • Add the environment variables listed in .env.example to your hosting
//     platform's project settings. NEVER commit real credentials.
//
// Required environment variables (set in the hosting dashboard, not in code):
//   EMAIL_HOST   — SMTP host        (e.g. smtp.eu.mailgun.org / smtp.office365.com)
//   EMAIL_PORT   — SMTP port        (587 for STARTTLS, 465 for SSL)
//   EMAIL_USER   — SMTP username
//   EMAIL_PASS   — SMTP password / API key
//   EMAIL_FROM   — verified sender  (e.g. "TCG Website <noreply@taxconsulting.co.uk>")
//   EMAIL_TO     — destination      (admin@taxconsulting.co.uk)
//
// Alternatively, to use Resend instead of SMTP, set RESEND_API_KEY and swap the
// `sendViaSmtp` call for the Resend branch below (commented).
// =============================================================================

const MAX = { name: 120, email: 200, phone: 60, company: 160, message: 5000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Strip control chars / header-injection vectors and clamp length.
function clean(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\r\n]+/g, " ")          // no header injection via newlines
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Body may arrive parsed (Vercel) or as a raw string — handle both.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  // ---- Spam protection: honeypot. Real users never fill this hidden field. --
  if (body.website || body.company_url) {
    // Pretend success so bots don't learn anything.
    return res.status(200).json({ ok: true });
  }

  // ---- Sanitise -------------------------------------------------------------
  const data = {
    name: clean(body.name, MAX.name),
    email: clean(body.email, MAX.email),
    phone: clean(body.phone, MAX.phone),
    company: clean(body.company, MAX.company),
    message: clean(body.message, MAX.message),
  };

  // ---- Server-side validation ----------------------------------------------
  const errors = {};
  if (!data.name) errors.name = "Full name is required.";
  if (!data.email) errors.email = "Email is required.";
  else if (!EMAIL_RE.test(data.email)) errors.email = "A valid email is required.";
  if (!data.message) errors.message = "A message is required.";
  if (Object.keys(errors).length) {
    return res.status(400).json({ ok: false, error: "Validation failed", errors });
  }

  const TO = process.env.EMAIL_TO || "admin@taxconsulting.co.uk";
  const FROM = process.env.EMAIL_FROM;

  const subject = "New enquiry from Tax Consulting Group website";
  const text =
`New website enquiry received from Tax Consulting Group website.

Full Name:
${data.name}

Email:
${data.email}

Phone:
${data.phone || "-"}

Company:
${data.company || "-"}

Message:
${data.message}
`;

  try {
    if (process.env.RESEND_API_KEY) {
      const { Resend } = require("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      const result = await resend.emails.send({ from: FROM, to: TO, reply_to: data.email, subject, text });
      console.log("Resend result:", JSON.stringify(result));
    } else {
      await sendViaSmtp({ to: TO, from: FROM, replyTo: data.email, subject, text });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Contact form send failed:", err);
    return res.status(502).json({ ok: false, error: "Email could not be sent." });
  }
};

async function sendViaSmtp({ to, from, replyTo, subject, text }) {
  const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS } = process.env;
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS || !from) {
    throw new Error("SMTP environment variables are not configured.");
  }
  // eslint-disable-next-line global-require
  const nodemailer = require("nodemailer");
  const port = Number(EMAIL_PORT) || 587;
  const transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port,
    secure: port === 465, // SSL on 465, STARTTLS otherwise
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
  await transporter.sendMail({ from, to, replyTo, subject, text });
}
