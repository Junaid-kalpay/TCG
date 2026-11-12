// Production build: TCG Website.dc.html (the Claude Design source) -> dist/
//
// The page body (template + logic) is copied unchanged apart from asset URLs.
// For every public route a static HTML file is written with its own <head>:
// title, description, canonical, social tags and JSON-LD. React is served
// locally (byte-identical to the unpkg build support.js expects) and referenced
// assets get content-hashed URLs so they can be cached long-term without serving
// stale files. Fonts load from Google Fonts exactly as in the approved design.
//
// VERCEL_ENV=preview|development builds are marked noindex (robots + meta).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "TCG Website.dc.html");
const OUT = path.join(ROOT, "dist");
const INDEXABLE = !["preview", "development"].includes(process.env.VERCEL_ENV || "");

const src = fs.readFileSync(SRC, "utf8");
const fail = (msg) => { console.error("build failed: " + msg); process.exit(1); };

// ---- page data, read from the page's own logic script (single source of truth) ----
const script = (src.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/) || [])[1];
if (!script) fail("logic script not found");
const D = new Function("DCLogic", "React", script +
  "\n;return { SERVICES, ARTICLES, TEAM, PUBLICATIONS, LOCATIONS, SITE_NAME, SITE_URL, pageMeta };")(class {}, {});
const { SERVICES, ARTICLES, TEAM, PUBLICATIONS, LOCATIONS, SITE_NAME, SITE_URL, pageMeta } = D;

// ---- output + asset fingerprinting ----
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const urls = new Map(); // repo-relative path -> public versioned URL
function emit(rel, from = path.join(ROOT, rel), outRel = rel) {
  if (!fs.existsSync(from)) fail("missing file " + rel);
  const buf = fs.readFileSync(from);
  fs.mkdirSync(path.dirname(path.join(OUT, outRel)), { recursive: true });
  fs.writeFileSync(path.join(OUT, outRel), buf);
  const url = "/" + outRel.split(path.sep).join("/") + "?v=" + crypto.createHash("sha256").update(buf).digest("hex").slice(0, 10);
  urls.set(rel, url);
  return url;
}

// React UMD builds: must match the SRI hashes support.js would otherwise load from unpkg.
const runtime = fs.readFileSync(path.join(ROOT, "support.js"), "utf8");
const vendor = [
  ["react", "node_modules/react/umd/react.production.min.js", /REACT_SRI = "([^"]+)"/],
  ["react-dom", "node_modules/react-dom/umd/react-dom.production.min.js", /REACT_DOM_SRI = "([^"]+)"/],
].map(([name, file, re]) => {
  const expected = (runtime.match(re) || [])[1];
  const actual = "sha384-" + crypto.createHash("sha384").update(fs.readFileSync(path.join(ROOT, file))).digest("base64");
  if (expected !== actual) fail(`${name} build does not match the SRI hash in support.js (run npm ci)`);
  return emit(file, path.join(ROOT, file), path.join("vendor", path.basename(file)));
});
// Leaflet (Our Locations map): the page loads it from unpkg with SRI; production serves the identical files from /vendor.
const leaflet = [["LEAFLET_JS", "node_modules/leaflet/dist/leaflet.js"], ["LEAFLET_CSS", "node_modules/leaflet/dist/leaflet.css"]].map(([name, file]) => {
  const url = (script.match(new RegExp(`const ${name} = "([^"]+)"`)) || [])[1] || fail(name + " not found in the page logic");
  const sri = (script.match(new RegExp(`const ${name}_SRI = "([^"]+)"`)) || [])[1];
  const actual = "sha384-" + crypto.createHash("sha384").update(fs.readFileSync(path.join(ROOT, file))).digest("base64");
  if (sri !== actual) fail(`${file} does not match ${name}_SRI (run npm ci)`);
  return [url, emit(file, path.join(ROOT, file), path.join("vendor", path.basename(file)))];
});
const supportUrl = emit("support.js");

// Every asset the page references, plus head-only assets.
const ASSET_RE = /(?<![\w/.])assets\/[A-Za-z0-9._\/-]+\.(?:png|jpe?g|webp|svg|ico|css|woff2)/g;
const body = src.slice(src.indexOf("<body>"));
// Same Google Fonts stylesheet the page template loads; linked in <head> as well so it starts earlier.
const FONTS_HREF = (src.match(/<link href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)" rel="stylesheet">/) || [])[1] || fail("Google Fonts link not found in template");
const referenced = new Set(body.match(ASSET_RE));
for (const rel of referenced) emit(rel);
for (const rel of ["assets/favicon.ico", "assets/favicon.svg", "assets/favicon-96x96.png", "assets/apple-touch-icon.png", "assets/og-image.png", "assets/tcg-logo.png"]) emit(rel);
emit("assets/favicon.ico", path.join(ROOT, "assets/favicon.ico"), "favicon.ico");
const pageBody = leaflet.reduce((b, [from, to]) => b.split(from).join(to),
  body.replace(ASSET_RE, (m) => urls.get(m) || fail("unresolved asset " + m)));

// ---- structured data ----
const abs = (p) => SITE_URL + p;
const isoDate = (s) => { const d = new Date(s + " 12:00 UTC"); if (isNaN(d)) fail("bad date " + s); return d.toISOString().slice(0, 10); };
const ORG_ID = abs("/#organization"), SITE_ID = abs("/#website");
const organization = {
  "@type": "Organization", "@id": ORG_ID, name: SITE_NAME, legalName: "Tax Consulting Group Limited", url: abs("/"),
  logo: { "@type": "ImageObject", url: abs("/assets/tcg-logo.png"), width: 1597, height: 544 },
  email: "enquiries@taxconsulting.co.uk", telephone: "+442036338934",
  address: { "@type": "PostalAddress", streetAddress: "13 Hanover Square, Mayfair", addressLocality: "London", postalCode: "W1S 1HN", addressCountry: "GB" },
  sameAs: ["https://www.linkedin.com/company/tax-consulting-group/"],
};
const website = { "@type": "WebSite", "@id": SITE_ID, url: abs("/"), name: SITE_NAME, inLanguage: "en-GB", publisher: { "@id": ORG_ID } };
const crumbs = (url, items) => ({ "@type": "BreadcrumbList", "@id": url + "#breadcrumb",
  itemListElement: items.map(([name, p], i) => ({ "@type": "ListItem", position: i + 1, name, ...(p ? { item: abs(p) } : {}) })) });
const splitCredentials = (full) => {
  const parts = full.split(" "); let i = parts.length;
  while (i > 2 && /^(\(?[A-Z]{2,}\)?|\(Fellow\))$/.test(parts[i - 1])) i--;
  return { name: parts.slice(0, i).join(" "), suffix: parts.slice(i).join(" ") };
};

function graph(page) {
  const url = abs(page.path);
  const webpage = { "@type": page.pageType || "WebPage", "@id": url + "#webpage", url, name: page.title, description: page.description,
    isPartOf: { "@id": SITE_ID }, inLanguage: "en-GB" };
  const nodes = [organization, website, webpage];
  if (page.breadcrumb) { nodes.push(crumbs(url, page.breadcrumb)); webpage.breadcrumb = { "@id": url + "#breadcrumb" }; }
  if (page.article) {
    const a = page.article;
    nodes.push({ "@type": "Article", "@id": url + "#article", headline: a.title, description: a.excerpt, articleSection: a.tag,
      datePublished: isoDate(a.date), image: [abs(urls.get(a.img).split("?")[0])], inLanguage: "en-GB",
      author: { "@id": ORG_ID }, publisher: { "@id": ORG_ID }, mainEntityOfPage: { "@id": url + "#webpage" } });
  }
  if (page.route === "locations") {
    webpage.mainEntity = { "@id": ORG_ID };
    const country = { "United Kingdom": "GB", "United Arab Emirates": "AE" };
    // UK addresses end in a postcode; UAE ones end in the city, optionally followed by the country
    const address = (l) => {
      const a = l.lines[l.lines.length - 1] === l.country ? l.lines.slice(0, -1) : l.lines;
      if (!a.length) return { addressLocality: l.name };  // office still awaiting an address
      return { streetAddress: a.slice(0, -1).join(", "), [l.country === "United Kingdom" ? "postalCode" : "addressLocality"]: a[a.length - 1] };
    };
    nodes[0] = { ...organization, location: LOCATIONS.map((l) => ({ "@type": "Place", name: l.headOffice ? `${l.name} ${l.label}` : l.name,
      ...(l.img ? { image: abs(urls.get(l.img).split("?")[0]) } : {}),
      ...(l.ll ? { geo: { "@type": "GeoCoordinates", latitude: l.ll[0], longitude: l.ll[1] } } : {}),
      address: { "@type": "PostalAddress", ...address(l), addressCountry: country[l.country] } })) };
  }
  if (page.route === "our-team") {
    nodes.push(...TEAM.map((p) => { const n = splitCredentials(p.name); return { "@type": "Person", name: n.name,
      ...(n.suffix ? { honorificSuffix: n.suffix } : {}), image: abs(urls.get(p.img).split("?")[0]), worksFor: { "@id": ORG_ID } }; }));
  }
  if (page.route === "publications") {
    nodes.push(...PUBLICATIONS.map((b) => ({ "@type": "Book", name: b.title, isbn: b.isbn, bookEdition: b.edition,
      bookFormat: "https://schema.org/Paperback", datePublished: isoDate(b.published), url: b.url, image: abs(urls.get(b.img).split("?")[0]),
      author: b.author.split(" and ").map((n) => ({ "@type": "Person", name: n })), publisher: { "@type": "Organization", name: b.publisher } })));
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": nodes }).replace(/</g, "\\u003c");
}

// ---- routes ----
const PAGES = [
  { route: "home" }, { route: "our-team", pageType: "AboutPage" }, { route: "about-us" },
  { route: "articles", pageType: "CollectionPage" }, { route: "publications", pageType: "CollectionPage" },
  { route: "locations" }, { route: "contact", pageType: "ContactPage" }, { route: "privacy-policy" }, { route: "terms-and-conditions" },
  ...SERVICES.map((s) => ({ route: "service-detail", slug: s.slug, breadcrumb: [["Home", "/"], [s.title]] })),
  ...ARTICLES.map((a) => ({ route: "article-detail", articleSlug: a.slug, article: a, ogType: "article",
    breadcrumb: [["Home", "/"], ["News, articles and technical updates", "/articles"], [a.title]] })),
].map((p) => ({ ...p, ...pageMeta(p.route, p.slug, p.articleSlug), route: p.route }));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function head(page, { notFound = false } = {}) {
  const url = abs(page.path), og = abs(urls.get("assets/og-image.png"));
  const meta = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}">`,
    ...(notFound || !INDEXABLE ? [`<meta name="robots" content="noindex">`] : [`<link rel="canonical" href="${esc(url)}">`]),
    `<meta property="og:type" content="${page.ogType || "website"}">`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}">`,
    `<meta property="og:locale" content="en_GB">`,
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(og)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(SITE_NAME)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(page.title)}">`,
    `<meta name="twitter:description" content="${esc(page.description)}">`,
    `<meta name="twitter:image" content="${esc(og)}">`,
    `<link rel="icon" href="${urls.get("assets/favicon.ico")}" sizes="16x16 32x32 48x48">`,
    `<link rel="icon" type="image/svg+xml" href="${urls.get("assets/favicon.svg")}">`,
    `<link rel="icon" type="image/png" sizes="96x96" href="${urls.get("assets/favicon-96x96.png")}">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${urls.get("assets/apple-touch-icon.png")}">`,
    `<link rel="preconnect" href="https://fonts.googleapis.com">`,
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">`,
    `<link href="${FONTS_HREF}" rel="stylesheet">`,
    // x-dc holds the raw template until the runtime mounts. lang enables hyphens:auto on
    // .tcg-just, which never applied before; keep it off so line breaks are unchanged.
    `<style>x-dc{display:none!important}.tcg-just{-webkit-hyphens:manual!important;hyphens:manual!important}</style>`,
    ...vendor.map((u) => `<script src="${u}" defer></script>`),
    `<script src="${supportUrl}" defer></script>`,
    ...(notFound ? [] : [`<script type="application/ld+json">${graph(page)}</script>`]),
  ];
  return `<head>\n${meta.join("\n")}\n</head>`;
}
const doc = (page, opts) => `<!DOCTYPE html>\n<html lang="en-GB">\n${head(page, opts)}\n${pageBody}`;
for (const page of PAGES) {
  const file = page.path === "/" ? "index.html" : page.path.slice(1) + ".html";
  fs.mkdirSync(path.dirname(path.join(OUT, file)), { recursive: true });
  fs.writeFileSync(path.join(OUT, file), doc(page));
}
// Unknown paths: Vercel serves this with a 404 status; the page renders Home, as unknown links did before.
fs.writeFileSync(path.join(OUT, "404.html"), doc(PAGES[0], { notFound: true }));

// ---- crawler files ----
fs.writeFileSync(path.join(OUT, "robots.txt"), INDEXABLE
  ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${abs("/sitemap.xml")}\n`
  : `User-agent: *\nDisallow: /\n`);
fs.writeFileSync(path.join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  PAGES.map((p) => `  <url><loc>${esc(abs(p.path))}</loc></url>`).join("\n") + `\n</urlset>\n`);

console.log(`built ${PAGES.length} pages + 404 into dist/ (${INDEXABLE ? "indexable" : "noindex"}), ${urls.size} files`);
