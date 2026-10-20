// Local dev server — loads .env, serves the site, and wires up /api/contact.
//   node server.js          serve the source (TCG Website.dc.html) with clean URLs
//   node server.js --dist   serve the production build in dist/ (run `npm run build` first)
// Listens on localhost only. Note: /api/contact sends real email when .env has credentials.
const http = require("http");
const fs = require("fs");
const path = require("path");

// Load .env
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split("\n")
    .forEach(line => {
      const m = line.match(/^([^#=\s]+)\s*=\s*(['"]?)(.*)\2\s*$/);
      if (m) process.env[m[1]] = m[3];
    });
}

const handler = require("./api/contact");

const DIST = process.argv.includes("--dist");
const ROOT = DIST ? path.join(__dirname, "dist") : __dirname;
const SOURCE_PAGE = path.join(__dirname, "TCG Website.dc.html");
const MIME = {
  html: "text/html; charset=utf-8", js: "application/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8", xml: "application/xml; charset=utf-8", txt: "text/plain; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml",
  ico: "image/x-icon", woff2: "font/woff2", woff: "font/woff"
};

// Resolve a URL path to a file inside ROOT, refusing traversal and dotfiles.
function resolveFile(urlPath) {
  const parts = urlPath.split("/").filter(Boolean);
  if (parts.some(p => p === ".." || p.startsWith("."))) return null;
  const abs = path.join(ROOT, ...parts);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  if (DIST) {
    if (fs.existsSync(abs + ".html")) return abs + ".html";
    if (parts.length === 0) return path.join(ROOT, "index.html");
  }
  return null;
}

function send(res, status, file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  res.writeHead(status, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch (_) { res.writeHead(400); return res.end("Bad request"); }

  if (urlPath === "/api/contact") {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(obj));
      return res;
    };
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      req.body = body;
      handler(req, res);
    });
    return;
  }

  const file = resolveFile(urlPath);
  if (file) return send(res, 200, file);

  // Page routes (no file extension)
  if (!path.extname(urlPath)) {
    if (DIST) {
      const notFound = path.join(ROOT, "404.html");
      if (fs.existsSync(notFound)) return send(res, 404, notFound);
    } else {
      // Source mode: one page for every route; <base> keeps relative asset paths working on nested routes.
      const html = fs.readFileSync(SOURCE_PAGE, "utf8").replace("<head>", '<head>\n<base href="/">');
      res.writeHead(200, { "Content-Type": MIME.html });
      return res.end(html);
    }
  }
  res.writeHead(404, { "Content-Type": MIME.txt });
  res.end("Not found");
});

server.listen(3001, "127.0.0.1", () => {
  console.log(`Running at http://localhost:3001 (${DIST ? "dist build" : "source"})`);
});
