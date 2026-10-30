import fallback from "../../data/backblasts.json";
import archive from "../../data/backblasts-archive.json";

// Backblasts are written once, in Slack, by the Q. The F3 Nation Slack bot
// stores them in the Nation database, so the site can read the same rows the bot
// wrote: no webhook, no Slack workflow, no second copy to keep in sync, and no
// re-keying for the Q.
//
// Two calls, because neither one alone is enough:
//   event-instance            -> dated rows in a window, carrying paxCount
//   event-instance/id/{id}     -> the backblast text for one row
// A non-null paxCount is the signal that a backblast exists. The list endpoint
// does not return the text, so each row on the page costs one detail fetch.
const API = "https://api.f3nation.com/v1";
const DEFAULT_REGION = "52724"; // The Remnant
const WINDOW_DAYS = 60; // how much history one list call covers
const MAX_WINDOWS = 4; // per request, so a quiet stretch still fills a page
const HISTORY_DAYS = 1460; // four years; past this the library stops offering more
const PAGE_SIZE = 100; // API cap; anything larger is a 400
const MAX_PAGES = 3;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;
const DAY_MS = 86400000;

const call = async (path, key, client) => {
  const response = await fetch(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${key}`,
      // Mandatory for API-key auth; without it every call 401s.
      client,
      accept: "application/json",
    },
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return response.json();
};

const dayString = (offsetDays) =>
  new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

const shiftDay = (date, days) => {
  const stamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(stamp)) return date;
  return new Date(stamp + days * DAY_MS).toISOString().slice(0, 10);
};

const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");

// Rows are ordered newest-first by (startDate, startTime, id). A date-only cursor
// would silently drop the other backblasts from a day the page cut in half, so the
// cursor carries all three and comparisons use the same tuple.
const compareIds = (a, b) => {
  const left = String(a ?? "");
  const right = String(b ?? "");
  // Live ids are numbers and archive ids are strings ("wp-…"); compare the shared
  // prefix numerically, then the whole string, so both order sanely.
  return left.localeCompare(right, undefined, { numeric: true });
};

const compareRows = (a, b) =>
  String(a.startDate).localeCompare(String(b.startDate)) ||
  String(a.startTime ?? "").localeCompare(String(b.startTime ?? "")) ||
  compareIds(a.id, b.id);

// Cursor format: startDate|startTime|id. Ids never contain a pipe, and the id
// segment is taken whole so a string id survives the round trip.
const parseCursor = (value) => {
  const raw = String(value ?? "");
  if (!raw) return null;
  const [startDate, startTime = "", ...rest] = raw.split("|");
  if (!isDay(startDate)) return null;
  return { startDate, startTime, id: rest.join("|") };
};

const formatCursor = (row) => `${row.startDate}|${row.startTime ?? ""}|${row.id ?? ""}`;

// True when `row` sorts strictly older than the cursor. A null cursor means the
// reader is on the first page, so nothing is filtered out.
const olderThan = (row, cursor) => !cursor || compareRows(row, cursor) < 0;

// Slack mentions arrive as <@U123> and links as <url|label>; the bot resolves
// most of them, but not all, and the rest would render as raw markup.
const clean = (value) =>
  String(value ?? "")
    .replace(/<@[^>]+>/g, "")
    .replace(/<([^|>]+)\|[^>]+>/g, "$1")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    // The bot formats "Q: {q} {coqs}", so an empty Co-Q list leaves a trailing
    // comma behind on the Q line.
    .replace(/^[\s,;·-]+|[\s,;·-]+$/g, "")
    .trim();

const HEADER_KEYS = new Set(["date", "ao", "q", "coq", "pax", "fngs", "count"]);

// The bot writes a fixed header block, then the moleskin. Parse only that block
// so a body line that happens to read "PAX: ..." is not eaten as metadata.
const parseBackblast = (text) => {
  const lines = String(text ?? "").split(/\r?\n/);
  const header = {};
  let cursor = 0;

  const titleLine = (lines[0] ?? "").match(/^\s*backblast!?\s*(.*)$/i);
  const title = titleLine ? clean(titleLine[1]) : "";
  if (titleLine) cursor = 1;

  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (!line.trim()) {
      if (Object.keys(header).length) {
        cursor += 1;
        break;
      }
      continue;
    }
    const match = line.match(/^\*?([A-Za-z][A-Za-z0-9 _-]{0,12})\*?\s*:\s*(.*)$/);
    if (!match) break;
    const key = match[1].toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!HEADER_KEYS.has(key)) break;
    header[key] = clean(match[2]);
  }

  return { title, ...header, body: lines.slice(cursor).join("\n").trim() };
};

// `sorting` is deliberately omitted: with it the API returns future recurring
// projections (all paxCount null) instead of the dated rows we need, so ordering
// happens here instead.
const listPosted = async ({ key, client, region, from, to, ao }) => {
  const rows = [];

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    const query = new URLSearchParams({
      regionOrgId: region,
      startDate: from,
      startDateTo: to,
      pageSize: String(PAGE_SIZE),
      pageIndex: String(pageIndex),
    });
    if (ao) query.set("aoOrgId", ao);

    const data = await call(`/event-instance?${query}`, key, client);
    const page = data.eventInstances ?? [];
    rows.push(...page);

    const total = Number(data.totalCount);
    if (page.length < PAGE_SIZE || (Number.isFinite(total) && rows.length >= total)) break;
  }

  return rows
    .filter((row) => row && isDay(row.startDate) && row.paxCount != null)
    .sort((a, b) => compareRows(b, a));
};

// The bot stores uploaded images in meta.files. Only these two hosts appear in
// real data, so the CSP in _headers/_middleware.js allows exactly these and the
// API drops anything else rather than letting a stray URL widen the page.
const PHOTO_HOSTS = new Set([
  "storage.googleapis.com",
  "slackblast-images.s3.amazonaws.com",
]);

const photosOf = (detail) => {
  const files = detail?.meta?.files;
  if (!Array.isArray(files)) return [];
  return files
    .map((value) => {
      try {
        const url = new URL(String(value));
        if (url.protocol !== "https:") return null;
        if (!PHOTO_HOSTS.has(url.host)) return null;
        return url.toString();
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

// The archive is a committed snapshot, newest-first, already limited to the AOs
// the region still runs. It is returned in the same shape as a live row so the
// page needs no second renderer.
//
// The order must match compareRows exactly: within one date the cursor resumes on
// (startTime, id), so a title-ordered file would let rows slip between pages.
const archiveRows = (archive.backblasts || [])
  .map((row) => ({ ...row, startTime: row.startTime || "" }))
  .sort((a, b) => compareRows(b, a));

const archiveRowsFor = ({ before, ao, limit }) => {
  if (limit <= 0) return [];
  const cursor = parseCursor(before);
  const aoId = /^\d+$/.test(ao) ? Number(ao) : null;
  return archiveRows
    .filter((row) => {
      if (aoId !== null && row.orgId !== aoId) return false;
      if (!cursor) return true;
      return olderThan(row, cursor);
    })
    .slice(0, limit);
};

const shape = (row, detail) => {  const parsed = parseBackblast(detail?.backblast ?? "");
  const ao = detail?.org?.name || row.aoName || parsed.ao || "";
  // The bot writes Co-Qs into the Q line rather than a field of their own, so
  // "Seagall , Saget" is really a Q and a Co-Q. Split on the separator the bot
  // itself uses.
  const qs = (parsed.q || "")
    .split(/\s*,\s*/)
    .map((name) => name.trim())
    .filter(Boolean);
  return {
    id: row.id,
    startDate: row.startDate,
    startTime: row.startTime || "",
    orgId: row.orgId ?? null,
    ao,
    q: qs[0] || "",
    coq: [parsed.coq, ...qs.slice(1)].filter(Boolean).join(", "),
    pax: parsed.pax || "",
    fngs: parsed.fngs || "",
    paxCount: Number(row.paxCount) || 0,
    fngCount: Number(row.fngCount) || 0,
    title: parsed.title || row.name || ao || "Backblast",
    body: parsed.body || "",
    photos: photosOf(detail),
    eventType: detail?.eventTypes?.[0]?.eventTypeName || "",
  };
};

export async function onRequestGet({ request, env }) {
  const key = env.F3_API_KEY;
  const region = env.F3_REGION_ORG_ID || DEFAULT_REGION;
  const client = env.F3_API_CLIENT || "f3theremnant-site";
  if (!key) return Response.json(fallback);

  const url = new URL(request.url);
  const before = url.searchParams.get("before") ?? "";
  const aoParam = url.searchParams.get("ao") ?? "";
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit")) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  const floor = dayString(-HISTORY_DAYS);
  const cursor = parseCursor(before);
  const aoId = /^\d+$/.test(aoParam) ? aoParam : "";

  try {
    const rows = [];
    // The archive is a finite static snapshot, so it is simply the older tail of the
    // same newest-first stream. Once the cursor reaches its oldest row there is no
    // reason to keep asking the live API, which is what made deep pages expensive.
    const archiveStart = archiveRows.length ? archiveRows[archiveRows.length - 1].startDate : "";
    const liveFloor = archiveStart && archiveStart > floor ? archiveStart : floor;
    let to = cursor ? cursor.startDate : dayString(0);
    let firstWindow = true;

    // Walk backwards until the page is full or the live source is exhausted.
    for (let window = 0; window < MAX_WINDOWS && rows.length < limit && to >= liveFloor; window += 1) {
      const from = shiftDay(to, -(WINDOW_DAYS - 1));
      const posted = await listPosted({
        key,
        client,
        region,
        from: from < liveFloor ? liveFloor : from,
        to,
        ao: aoId,
      });
      // The first window includes the cursor's own day, so drop rows already read.
      rows.push(...(firstWindow ? posted.filter((row) => olderThan(row, cursor)) : posted));
      firstWindow = false;
      to = shiftDay(from, -1);
    }

    const liveDone = to < liveFloor;

    const page = rows.slice(0, limit);

    // One detail fetch per row on the page. allSettled so a single bad row drops
    // out instead of failing the whole library.
    const details = await Promise.allSettled(
      page.map((row) => call(`/event-instance/id/${row.id}`, key, client))
    );

    const live = page
      .map((row, index) => {
        const result = details[index];
        if (result.status !== "fulfilled" || !result.value) return null;
        return shape(row, result.value);
      })
      .filter(Boolean);

    // Top the page up from the archive, using the same cursor the live rows use.
    // Where the two sources overlap (both cover the weeks around when the Nation
    // database took over), prefer the live row: it carries the photos and the
    // formatting the bot wrote, and the archive copy is the same workout.
    const liveKeys = new Set(live.map((row) => `${row.startDate}|${row.orgId}`));
    const archived = archiveRowsFor({ before, ao: aoId, limit: limit - live.length + liveKeys.size })
      .filter((row) => !liveKeys.has(`${row.startDate}|${row.orgId}`))
      .slice(0, limit - live.length);
    const backblasts = [...live, ...archived];
    const last = backblasts[backblasts.length - 1];
    const nextBefore = last ? formatCursor(last) : formatCursor({ startDate: to, startTime: "", id: "" });

    // "Load older" stays only while one of the two sources still has rows.
    const archiveLeft = archiveRowsFor({ before: nextBefore, ao: aoId, limit: 1 }).length > 0;

    return Response.json(
      { backblasts, nextBefore, hasMore: !liveDone || archiveLeft },
      { headers: { "cache-control": "public, max-age=600" } }
    );
  } catch {
    // A broken library is worse than a stale one. Serve the committed snapshot.
    return Response.json(fallback, { headers: { "cache-control": "public, max-age=60" } });
  }
}
