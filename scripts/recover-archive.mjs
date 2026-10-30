// Recover the old F3 Cherokee backblasts from the Wayback Machine.
//
// The old WordPress site is gone: every URL on f3cherokee.com now redirects to the
// new homepage. The Wayback Machine captured ~10,600 backblast pages, so this script
// crawls those, keeps only the AOs The Remnant still runs, and writes a committed
// snapshot the site merges into its live library.
//
// Usage (one-time, or when re-running the recovery):
//   node scripts/recover-archive.mjs            # crawl + build
//   node scripts/recover-archive.mjs --build    # rebuild from the cached crawl
//
// The crawl is polite (4 in flight) and resumable: it checkpoints to a cache file
// every 25 pages, so an interrupted run picks up where it left off.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CACHE = join(ROOT, ".cache", "archive-crawl.json");
const OUT = join(ROOT, "data", "backblasts-archive.json");
const LISTING = join(ROOT, ".cache", "archive-urls.txt");

const WP = "https://f3cherokee.com";
const WAYBACK = "https://web.archive.org/web/2024id_";

// The three AOs The Remnant still runs, keyed by the AO label the old WordPress
// site wrote into each backblast's header block.
const TARGETS = new Map([
  ["catbox", { ao: "The Catbox", orgId: 33321 }],
  ["lions den", { ao: "The Lion's Den", orgId: 33345 }],
  ["oz", { ao: "The Oz", orgId: 33324 }],
]);

const decodeEntities = (s) =>
  s.replace(/&#8211;/g, "–").replace(/&#8212;/g, "—")
    .replace(/&#8216;|&#8217;/g, "'").replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8230;|&hellip;/g, "…").replace(/&#x2d;/gi, "-")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

const stripTags = (html) =>
  html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "");

const toIso = (value) => {
  const m = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
};

const cleanText = (s) =>
  String(s || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

const slugOf = (url) => {
  const parts = String(url).replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || "";
};

// --- crawl -----------------------------------------------------------------

async function listBackblastUrls() {
  const res = await fetch(
    "https://web.archive.org/cdx/search/cdx?url=f3cherokee.com/backblasts/*&output=json&fl=original&collapse=urlkey"
  );
  if (!res.ok) throw new Error(`CDX responded ${res.status}`);
  const rows = await res.json();
  return rows
    .slice(1)
    .map((r) => r[0])
    .filter((u) => u !== `${WP}/backblasts/` && !/\/page\/|\/feed\//.test(u));
}

// Parse one archived backblast page. The header block is a styled div of
// label/value <p> pairs; everything after it is the moleskin.
async function extractPage(url) {
  const res = await fetch(`${WAYBACK}/${url}`, { redirect: "follow" });
  const html = await res.text();

  const start = html.indexOf('class="entry-content"');
  if (start < 0) return { url, status: res.status, error: "no entry-content" };

  const endMark = html.indexOf("comments-area", start);
  const block = html.slice(start, endMark > 0 ? endMark : start + 40000);

  // Labels are sometimes bolded and sometimes plain, so match either.
  const field = (label) => {
    const re = new RegExp(`(?:<b>)?${label}:\\s*(?:<\\/b>)?([\\s\\S]{0,400}?)<\\/p>`, "i");
    const m = block.match(re);
    return m ? decodeEntities(stripTags(m[1])).replace(/\s+/g, " ").trim() : "";
  };

  const paxNames = (() => {
    const m = block.match(/Pax Names:([\s\S]*?)<\/p>/i);
    if (!m) return [];
    return decodeEntities(stripTags(m[1])).split(",").map((s) => s.trim()).filter(Boolean);
  })();

  // The article ends at its closing tag, which can sit inside the slice.
  const boxEnd = block.indexOf("</div>", block.indexOf("QIC:"));
  const rawBody = boxEnd > 0 ? block.slice(boxEnd) : "";
  const articleEnd = rawBody.indexOf("</article>");
  const body = decodeEntities(stripTags(articleEnd > 0 ? rawBody.slice(0, articleEnd) : rawBody))
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const dateMatch = block.match(/(?:<b>)?When:\s*(?:<\/b>)?([0-9\/]{6,10})/i);

  return {
    url,
    status: res.status,
    title: titleMatch
      ? decodeEntities(titleMatch[1]).replace(/\s*\|\s*F3 Cherokee\s*$/, "").trim()
      : "",
    ao: field("AO"),
    when: dateMatch ? dateMatch[1].trim() : "",
    qic: field("QIC"),
    paxCount: Number(field("Number of Pax")) || 0,
    fngCount: Number(field("Number of FNGS")) || 0,
    paxNames,
    body,
  };
}

async function crawl() {
  mkdirSync(dirname(CACHE), { recursive: true });
  const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

  let urls;
  if (existsSync(LISTING)) {
    urls = readFileSync(LISTING, "utf8").split("\n").filter(Boolean);
  } else {
    urls = await listBackblastUrls();
    writeFileSync(LISTING, urls.join("\n"));
  }
  console.log(`pages to crawl: ${urls.length}`);

  let i = 0;
  let done = 0;
  const CONCURRENCY = 4;

  async function worker() {
    while (i < urls.length) {
      const url = urls[i];
      i += 1;
      if (cache[url]) { done += 1; continue; }
      try {
        cache[url] = await extractPage(url);
      } catch (e) {
        cache[url] = { url, error: e.message };
      }
      done += 1;
      if (done % 25 === 0) {
        writeFileSync(CACHE, JSON.stringify(cache));
        process.stdout.write(`  ${done}/${urls.length}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`crawled: ${Object.keys(cache).length}`);
}

// --- build -----------------------------------------------------------------

function build() {
  const cache = JSON.parse(readFileSync(CACHE, "utf8"));
  const rows = [];
  const skipped = { notOurs: 0, noDate: 0 };

  for (const [url, page] of Object.entries(cache)) {
    if (!page || page.error) continue;
    const target = TARGETS.get(String(page.ao || "").trim().toLowerCase());
    if (!target) { skipped.notOurs += 1; continue; }

    const date = toIso(page.when);
    if (!date) { skipped.noDate += 1; continue; }

    const title = String(page.title || "").trim();
    rows.push({
      id: `wp-${slugOf(url)}`,
      source: "archive",
      startDate: date,
      startTime: "",
      orgId: target.orgId,
      ao: target.ao,
      q: String(page.qic || "").trim(),
      coq: "",
      pax: (page.paxNames || []).join(", "),
      fngs: "",
      paxCount: Number(page.paxCount) || 0,
      fngCount: Number(page.fngCount) || 0,
      title: title || target.ao,
      body: cleanText(page.body),
      photos: [],
      eventType: "",
      archiveUrl: url,
    });
  }

  // Newest first, deduped by (date, AO, title). The old site re-published a few
  // under a new slug, and the API merges on that same key.
  const seen = new Set();
  const unique = rows
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.title.localeCompare(b.title))
    .filter((row) => {
      const key = `${row.startDate}|${row.orgId}|${row.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const payload = {
    generated: new Date().toISOString().slice(0, 10),
    source: "web.archive.org capture of f3cherokee.com",
    backblasts: unique,
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 1) + "\n");

  const byAo = {};
  for (const r of unique) byAo[r.ao] = (byAo[r.ao] || 0) + 1;
  console.log("kept:", unique.length, "by AO:", byAo);
  console.log("date range:", unique.at(-1)?.startDate, "->", unique[0]?.startDate);
  console.log("with body:", unique.filter((r) => r.body.length > 40).length);
  console.log("skipped:", skipped);
}

if (process.argv.includes("--build")) build();
else {
  await crawl();
  build();
}
