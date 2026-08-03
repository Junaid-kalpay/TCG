// Local dev server — loads .env, serves the site, and wires up /api/contact
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

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/contact") {
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

  // Serve static files
  let filePath = req.url === "/" ? "/TCG Website.dc.html" : req.url;
  const abs = path.join(__dirname, filePath);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    const ext = path.extname(abs).slice(1);
    const mime = { html: "text/html", js: "application/javascript", css: "text/css",
                   png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", ico: "image/x-icon",
                   woff2: "font/woff2", woff: "font/woff" }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    fs.createReadStream(abs).pipe(res);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(3001, () => {
  console.log("Running at http://localhost:3001");
});
