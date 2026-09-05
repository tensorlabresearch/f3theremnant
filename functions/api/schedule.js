import fallback from "../../data/schedule.json";

// Two calls, because neither endpoint alone is enough:
//   map/event/all            -> the recurring series, with street addresses
//   calendar-home-schedule   -> dated instances, with the Q from Slack signups
// They join on AO org: an instance's orgId equals a series' parents[].parentId.
const API = "https://api.f3nation.com/v1";
const DEFAULT_REGION = "52724"; // The Remnant
const DAY_MS = 86400000;
const HORIZON_DAYS = 7;

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// The API returns "0530"; site.js only recognises times containing a colon and
// would otherwise print the raw digits.
const normalizeTime = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 4) return "";
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
};

const addressOf = (series) =>
  series
    ? {
        locationName: series.locationName || series.location || "",
        locationAddress: series.locationAddress || "",
        locationAddress2: series.locationAddress2 || "",
        locationCity: series.locationCity || "",
        locationState: series.locationState || "",
        locationZip: series.locationZip || "",
      }
    : {};

const call = async (path, key, client) => {
  const response = await fetch(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${key}`,
      // Mandatory for API-key auth; without it every call 401s.
      client,
      accept: "application/json",
    },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return response.json();
};

export async function onRequestGet({ env }) {
  const key = env.F3_API_KEY;
  const region = env.F3_REGION_ORG_ID || DEFAULT_REGION;
  const client = env.F3_API_CLIENT || "f3theremnant-site";
  if (!key) return Response.json(fallback);

  try {
    const [seriesData, instanceData] = await Promise.all([
      call(`/map/event/all?regionIds=${region}&pageSize=100`, key, client),
      call(`/event-instance/calendar-home-schedule?regionOrgId=${region}&userId=0`, key, client),
    ]);

    // Index the series by AO so each instance can inherit a street address.
    const seriesByAo = new Map();
    for (const series of seriesData.events || []) {
      for (const parent of series.parents || []) {
        if (!seriesByAo.has(parent.parentId)) seriesByAo.set(parent.parentId, series);
      }
    }

    // openQOnly and startDate are accepted but do not filter, so bound the
    // window here rather than trusting the query string.
    const today = new Date();
    const from = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const until = from + HORIZON_DAYS * DAY_MS;

    const events = (instanceData.events || [])
      .map((instance) => {
        const series = seriesByAo.get(instance.orgId);
        const [y, m, d] = String(instance.startDate || "").split("-").map(Number);
        const stamp = y ? Date.UTC(y, m - 1, d) : NaN;
        return { instance, series, stamp };
      })
      .filter(({ stamp }) => Number.isFinite(stamp) && stamp >= from && stamp < until)
      .map(({ instance, series, stamp }) => ({
        id: instance.id,
        name: instance.name || instance.seriesName || instance.orgName || "Workout",
        description: series?.description || "",
        startDate: instance.startDate,
        startTime: normalizeTime(instance.startTime),
        endTime: normalizeTime(series?.endTime),
        dayOfWeek: DAY_NAMES[new Date(stamp).getUTCDay()],
        ao: instance.orgName || series?.parent || "",
        q: instance.plannedQs || "",
        hasPreblast: Boolean(instance.hasPreblast),
        eventTypes: (instance.eventTypes || []).map((type) => ({
          eventTypeId: type.id,
          eventTypeName: type.name,
        })),
        ...addressOf(series),
      }))
      .sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          a.startTime.localeCompare(b.startTime) ||
          a.name.localeCompare(b.name)
      );

    const openQs = events.filter((event) => !event.q).length;

    return Response.json(
      { events, openQs, region: Number(region) },
      { headers: { "cache-control": "public, max-age=300" } }
    );
  } catch {
    return Response.json(fallback, { headers: { "cache-control": "public, max-age=60" } });
  }
}
