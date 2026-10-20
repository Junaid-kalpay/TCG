# TCG Website — build and deployment

## How the site is put together

- `TCG Website.dc.html` is the source page (Claude Design format). It holds the
  template, all page data (services, articles, team, offices, page titles and
  descriptions) and the page logic.
- `support.js` is the Claude Design runtime that renders that page with React.
- `api/contact.js` is the contact form's serverless function.
- `npm run build` turns the source into a deployable `dist/` folder:
  - one HTML file per public page (`/`, `/our-team`, `/services/property-tax`, …)
    with its own title, description, canonical URL, social tags and JSON-LD;
  - `404.html` (renders the home page with a 404 status and `noindex`);
  - `robots.txt` and `sitemap.xml`;
  - React served locally (`vendor/`, checked against the hashes in `support.js`);
  - fonts from Google Fonts, exactly as the approved design loads them;
  - only the assets the page references, with content-hashed URLs (`?v=…`).

Opening `TCG Website.dc.html` directly (e.g. in Claude Design) still uses the
original `#/route` links; production uses clean URLs. Old `/#/route` links are
converted to the clean URL in the browser.

## Commands

```bash
npm ci              # install exact dependency versions
npm run build       # build dist/
npm run preview     # build, then serve dist/ at http://localhost:3001
npm run dev         # serve the source page at http://localhost:3001
```

`npm run dev` and `npm run preview` use the real `/api/contact` handler, so a
submitted form sends real email when `.env` contains credentials.

## Vercel

`vercel.json` already sets the build command, output directory (`dist`), clean
URLs, redirects, security headers and caching. No dashboard overrides are
needed; if the project has a Build Command or Output Directory set in
*Settings → Build and Deployment*, clear them so `vercel.json` applies.

Production environment variables (*Settings → Environment Variables*):

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | Resend API key (secret) |
| `EMAIL_FROM` | `TCG <noreply@taxconsulting.co.uk>` — must be a verified Resend sender domain |
| `EMAIL_TO` | `admin@taxconsulting.co.uk` (also the default when unset) |
| `ALLOWED_ORIGINS` | optional, extra origins allowed to post to `/api/contact` |

Preview deployments (`VERCEL_ENV=preview`) are built with `noindex` on every
page and a `Disallow: /` robots.txt. Keep Vercel Deployment Protection enabled
for previews as well.

Recommended: add a Vercel Firewall rate-limit rule for `/api/contact`; the
function's own limits are per instance.

## After each production deployment

1. Open `/`, `/our-team`, `/locations` and a service page; refresh each.
2. Open an old link such as `/#/our-team` and confirm it lands on `/our-team`.
3. Check `/robots.txt` and `/sitemap.xml`.
4. Send one test enquiry and confirm it arrives at the configured `EMAIL_TO`.
5. First time only: submit `https://www.taxconsulting.co.uk/sitemap.xml` in
   Google Search Console and Bing Webmaster Tools.

## Editing content

- Edit `TCG Website.dc.html` as before; the build picks up text and data changes.
- New pages need an entry in `PAGE_META` (or the `SERVICES` / `ARTICLES` data)
  and in the `PAGES` list in `scripts/build.mjs`.
- Add new images to `assets/` as optimised WebP where possible. The build
  fails if the page references an asset that does not exist.
