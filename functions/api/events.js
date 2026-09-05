import fallback from "../../data/events.json";

// The calendar is shared publicly, so its iCal feed needs no credentials. That
// keeps the handoff surface at zero: nothing here expires, rotates, or leaks.
const feedUrl = (id) =>
  `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;

const DEFAULT_TZ = "America/New_York";
const HORIZON_DAYS = 400;
const MAX_EVENTS = 25;
const DAY_MS = 86400000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// RFC 5545 folds long lines by inserting CRLF + a single space or tab. Unfold
// before anything else or descriptions and locations arrive chopped in half.
const unfold = (text) => text.replace(/\r?\n[ \t]/g, "");

const unescapeText = (value) =>
  String(value).replace(/\\([\\;,nN])/g, (_, char) =>
    char === "n" || char === "N" ? "\n" : char
  );

// Split "NAME;TZID=America/New_York:VALUE" at the first colon that is not
// inside a quoted parameter value.
const splitProperty = (line) => {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) return [line.slice(0, i), line.slice(i + 1)];
  }
  return null;
};

const parseProperty = (line) => {
  const split = splitProperty(line);
  if (!split) return null;
  const [head, value] = split;
  const segments = head.split(";");
  const params = {};
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf("=");
    if (eq > 0) params[segment.slice(0, eq).toUpperCase()] = segment.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: segments[0].toUpperCase(), params, value };
};

// Milliseconds to add to a UTC instant to get the named zone's wall clock.
const zoneOffset = (ts, tz) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ts));
  const got = {};
  for (const part of parts) if (part.type !== "literal") got[part.type] = Number(part.value);
  return Date.UTC(got.year, got.month - 1, got.day, got.hour % 24, got.minute, got.second) - ts;
};

// Wall clock in a named zone -> UTC instant. Two passes because the offset we
// need depends on the answer; the second pass settles DST boundaries.
const wallToUtc = (y, mo, d, h, mi, s, tz) => {
  const target = Date.UTC(y, mo - 1, d, h, mi, s);
  let ts = target - zoneOffset(target, tz);
  return target - zoneOffset(ts, tz);
};

const zonedFields = (ts, tz) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(ts));
  const got = {};
  for (const part of parts) if (part.type !== "literal") got[part.type] = part.value;
  return {
    date: `${got.year}-${got.month}-${got.day}`,
    time: `${String(Number(got.hour) % 24).padStart(2, "0")}:${got.minute}`,
  };
};

const utcDateString = (ts) => new Date(ts).toISOString().slice(0, 10);

// Google emits three shapes: floating UTC (…Z), zoned (TZID=…), and all-day
// (VALUE=DATE). All three appear in real feeds, so handle all three.
const parseDateValue = (property, calendarTz) => {
  const value = String(property.value || "").trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly || property.params.VALUE === "DATE") {
    if (!dateOnly) return null;
    return { allDay: true, ts: Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]) };
  }
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!stamp) return null;
  const [, y, mo, d, h, mi, s, zulu] = stamp;
  if (zulu) return { allDay: false, ts: Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) };
  return { allDay: false, ts: wallToUtc(+y, +mo, +d, +h, +mi, +s, property.params.TZID || calendarTz) };
};

const parseRule = (value) => {
  const rule = {};
  for (const pair of String(value).split(";")) {
    const eq = pair.indexOf("=");
    if (eq > 0) rule[pair.slice(0, eq).toUpperCase()] = pair.slice(eq + 1);
  }
  return rule;
};

// Deliberately partial: FREQ with INTERVAL/COUNT/UNTIL, plus BYDAY for weekly.
// The agreed convention is that every event is entered as a discrete instance,
// so this exists to keep an accidental recurrence from pinning a stale date to
// the page. Anything it cannot model falls back to the single base instance.
const expandRecurrence = (base, rule, tz, horizon) => {
  const freq = String(rule.FREQ || "").toUpperCase();
  if (!freq) return [base.ts];

  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const count = Number(rule.COUNT) || 0;
  const until = rule.UNTIL
    ? (parseDateValue({ value: rule.UNTIL, params: {} }, tz) || {}).ts ?? Infinity
    : Infinity;
  const byDay = rule.BYDAY
    ? rule.BYDAY.split(",").map((code) => code.trim().slice(-2).toUpperCase())
    : null;

  const wall = base.allDay
    ? { date: utcDateString(base.ts), time: "00:00" }
    : zonedFields(base.ts, tz);
  const [wy, wmo, wd] = wall.date.split("-").map(Number);
  const [wh, wmi] = wall.time.split(":").map(Number);

  const instants = [];
  const at = (y, mo, d) =>
    base.allDay ? Date.UTC(y, mo - 1, d) : wallToUtc(y, mo, d, wh, wmi, 0, tz);
  // Returns false once the series is complete.
  const add = (ts) => {
    if (ts > until) return false;
    if (ts >= base.ts) instants.push(ts);
    return !(count && instants.length >= count);
  };

  if (freq === "DAILY" || freq === "WEEKLY") {
    const stepMs = (freq === "DAILY" ? interval : interval * 7) * DAY_MS;
    let cursor = Date.UTC(wy, wmo - 1, wd);
    for (let guard = 0; guard < 500 && cursor <= horizon; guard += 1) {
      const days = freq === "WEEKLY" && byDay
        ? byDay
            .map((code) => WEEKDAYS.indexOf(code))
            .filter((index) => index >= 0)
            .map((index) => cursor - new Date(cursor).getUTCDay() * DAY_MS + index * DAY_MS)
        : [cursor];
      for (const day of days) {
        const date = new Date(day);
        if (!add(at(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()))) {
          return instants;
        }
      }
      cursor += stepMs;
    }
    return instants;
  }

  if (freq === "MONTHLY" || freq === "YEARLY") {
    const stepMonths = freq === "MONTHLY" ? interval : interval * 12;
    for (let i = 0; i < 200; i += 1) {
      const total = wmo - 1 + i * stepMonths;
      const y = wy + Math.floor(total / 12);
      const mo = (total % 12) + 1;
      // Skip months that have no such day rather than rolling into the next.
      if (wd > new Date(Date.UTC(y, mo, 0)).getUTCDate()) continue;
      const ts = at(y, mo, wd);
      if (ts > horizon) break;
      if (!add(ts)) break;
    }
    return instants;
  }

  return [base.ts];
};

const stripHtml = (text) =>
  text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");

const TAG_PATTERN = /(^|\s)#([a-z0-9][a-z0-9_-]*)/gi;

const extractTags = (text) => {
  const tags = [];
  const remaining = text.replace(TAG_PATTERN, (_, lead, tag) => {
    tags.push(tag.toLowerCase());
    return lead;
  });
  return {
    tags: [...new Set(tags)],
    description: remaining.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
};

const parseCalendar = (text) => {
  const lines = unfold(text).split(/\r?\n/);
  let calendarTz = DEFAULT_TZ;
  const raw = [];
  let current = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { current = { props: [], exdates: [] }; continue; }
    if (line === "END:VEVENT") { if (current) raw.push(current); current = null; continue; }

    const property = parseProperty(line);
    if (!property) continue;

    if (!current) {
      if (property.name === "X-WR-TIMEZONE" && property.value.trim()) {
        calendarTz = property.value.trim();
      }
      continue;
    }
    current.props.push(property);
  }

  return { calendarTz, raw };
};

const buildEvents = (raw, calendarTz, now) => {
  const horizon = now + HORIZON_DAYS * DAY_MS;
  const events = [];

  for (const entry of raw) {
    const get = (name) => entry.props.find((property) => property.name === name);
    if ((get("STATUS")?.value || "").toUpperCase() === "CANCELLED") continue;

    const startProperty = get("DTSTART");
    if (!startProperty) continue;
    const start = parseDateValue(startProperty, calendarTz);
    if (!start) continue;

    const endProperty = get("DTEND");
    const end = endProperty ? parseDateValue(endProperty, calendarTz) : null;
    const durationMs = end ? Math.max(0, end.ts - start.ts) : (start.allDay ? DAY_MS : 0);

    const summary = unescapeText(get("SUMMARY")?.value || "").trim();
    if (!summary) continue;

    const rawDescription = stripHtml(unescapeText(get("DESCRIPTION")?.value || ""));
    const { tags, description } = extractTags(rawDescription);
    const location = stripHtml(unescapeText(get("LOCATION")?.value || "")).trim();
    const uid = (get("UID")?.value || summary).trim();

    const excluded = new Set(
      entry.props
        .filter((property) => property.name === "EXDATE")
        .flatMap((property) =>
          property.value.split(",").map((value) => {
            const parsed = parseDateValue({ value, params: property.params }, calendarTz);
            return parsed ? parsed.ts : null;
          })
        )
        .filter((ts) => ts !== null)
    );

    const ruleProperty = get("RRULE");
    let instants = [start.ts];
    if (ruleProperty) {
      try {
        instants = expandRecurrence(start, parseRule(ruleProperty.value), calendarTz, horizon);
      } catch {
        instants = [start.ts];
      }
      if (!instants.length) instants = [start.ts];
    }

    for (const ts of instants) {
      if (excluded.has(ts)) continue;
      const finishes = ts + durationMs;
      // Keep an event listed until it is actually over, not when it starts.
      if (finishes < now || ts > horizon) continue;

      const startFields = start.allDay
        ? { date: utcDateString(ts), time: "" }
        : zonedFields(ts, calendarTz);
      const endFields = start.allDay || !durationMs ? null : zonedFields(finishes, calendarTz);

      events.push({
        uid: instants.length > 1 ? `${uid}-${ts}` : uid,
        name: summary,
        description,
        tags,
        location,
        allDay: start.allDay,
        startDate: startFields.date,
        startTime: startFields.time,
        endTime: endFields ? endFields.time : "",
        start: new Date(ts).toISOString(),
        end: new Date(finishes).toISOString(),
      });
    }
  }

  return events
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name))
    .slice(0, MAX_EVENTS);
};

export async function onRequestGet({ env }) {
  const calendarId = env.GCAL_ID;
  if (!calendarId) return Response.json(fallback);

  try {
    const response = await fetch(feedUrl(calendarId), {
      cf: { cacheTtl: 600, cacheEverything: true },
      headers: { accept: "text/calendar" },
    });
    if (!response.ok) throw new Error(`Feed responded ${response.status}`);

    const { calendarTz, raw } = parseCalendar(await response.text());
    const events = buildEvents(raw, calendarTz, Date.now());

    return Response.json(
      { events, timeZone: calendarTz },
      { headers: { "cache-control": "public, max-age=300" } }
    );
  } catch {
    // Serve the committed snapshot rather than an error page. An empty list is
    // a legitimate answer; a broken page is not.
    return Response.json(fallback, { headers: { "cache-control": "public, max-age=60" } });
  }
}
