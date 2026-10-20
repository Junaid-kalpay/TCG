// =============================================================================
// Tax Consulting Group — Contact form serverless function (Vercel)
// -----------------------------------------------------------------------------
// Served at /api/contact (Vercel file-based routing). Sends enquiries by email.
//
// Environment variables (set in the Vercel project settings, never in code):
//   RESEND_API_KEY — Resend API key (preferred transport)
//   EMAIL_FROM     — verified sender, e.g. "TCG <noreply@taxconsulting.co.uk>"
//   EMAIL_TO       — recipient; defaults to admin@taxconsulting.co.uk
//   ALLOWED_ORIGINS (optional) — extra comma-separated origins allowed to post,
//                    e.g. a preview URL. Same-host requests are always allowed.
// SMTP fallback (only used when RESEND_API_KEY is unset; requires `npm i nodemailer`):
//   EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS
//
// Responses keep the shapes the page expects: { ok:true } on success and
// { ok:false, error? } otherwise. When `error` is omitted the page shows its
// standard "could not be sent" message.
// =============================================================================

const MAX = { name: 120, email: 200, phone: 60, company: 160, message: 5000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Best-effort abuse limits. Serverless instances are short-lived, so these are
// per-instance safeguards; platform rate limiting (Vercel Firewall) is the
// stronger control.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map();   // ip -> [timestamps]
const recent = new Map(); // fingerprint -> timestamp (duplicate submissions)

// Single-line fields: strip control chars (incl. CR/LF, so nothing can reach a
// header) and clamp length.
function clean(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\r\n]+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}
// Message body: same, but keep the sender's line breaks.
function cleanMultiline(value, max) {
  return String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, max);
}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.headers["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "unknown";
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients; other checks still apply
  let host;
  try { host = new URL(origin).host; } catch (_) { return false; }
  if (host === req.headers.host || host === req.headers["x-forwarded-host"]) return true;
  const extra = String(process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return extra.includes(origin);
}

function rateLimited(ip, now) {
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > MAX_PER_WINDOW;
}

function isDuplicate(fingerprint, now) {
  for (const [k, t] of recent) if (now - t > WINDOW_MS) recent.delete(k);
  if (recent.has(fingerprint)) return true;
  recent.set(fingerprint, now);
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!originAllowed(req)) {
    return res.status(403).json({ ok: false });
  }
  const type = String(req.headers["content-type"] || "");
  if (type && !/^application\/json\b/i.test(type)) {
    return res.status(415).json({ ok: false });
  }

  // Body may arrive parsed (Vercel) or as a raw string — handle both.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};

  // ---- Spam protection: honeypot. Real users never fill this hidden field. --
  if (body.website || body.company_url) {
    // Pretend success so bots don't learn anything.
    return res.status(200).json({ ok: true });
  }

  const now = Date.now();
  if (rateLimited(clientIp(req), now)) {
    res.setHeader("Retry-After", String(WINDOW_MS / 1000));
    return res.status(429).json({ ok: false });
  }

  // ---- Sanitise -------------------------------------------------------------
  const data = {
    name: clean(body.name, MAX.name),
    email: clean(body.email, MAX.email),
    phone: clean(body.phone, MAX.phone),
    company: clean(body.company, MAX.company),
    message: cleanMultiline(body.message, MAX.message),
  };

  // ---- Server-side validation (mirrors the form's required fields) ----------
  const errors = {};
  if (!data.name) errors.name = "Full name is required.";
  if (!data.email) errors.email = "Email is required.";
  else if (!EMAIL_RE.test(data.email)) errors.email = "A valid email is required.";
  if (!data.company) errors.company = "Company is required.";
  if (!data.message) errors.message = "A message is required.";
  if (Object.keys(errors).length) {
    return res.status(400).json({ ok: false, error: "Validation failed", errors });
  }

  // The same enquiry submitted again within the window is acknowledged, not re-sent.
  const fingerprint = [data.email.toLowerCase(), data.message].join("\u0000");
  if (isDuplicate(fingerprint, now)) {
    return res.status(200).json({ ok: true });
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
      await sendViaResend({ to: TO, from: FROM, replyTo: data.email, subject, text });
    } else {
      await sendViaSmtp({ to: TO, from: FROM, replyTo: data.email, subject, text });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    recent.delete(fingerprint); // allow a retry after a failed send
    console.error("Contact form send failed:", err && err.message ? err.message : err);
    return res.status(502).json({ ok: false, error: "Email could not be sent." });
  }
};

async function sendViaResend({ to, from, replyTo, subject, text }) {
  if (!from) throw new Error("EMAIL_FROM is not configured.");
  const { Resend } = require("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({ from, to, replyTo, subject, text });
  if (error) throw new Error(error.message);
}

async function sendViaSmtp({ to, from, replyTo, subject, text }) {
  const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS } = process.env;
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS || !from) {
    throw new Error("Email delivery is not configured (set RESEND_API_KEY or SMTP variables).");
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
