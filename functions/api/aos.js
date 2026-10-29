import fallback from "../../data/aos.json";

// `aos-in-region` is one of the few map endpoints that answers without a
// bearer token, so the AO list costs nothing to keep live and cannot go stale
// the way a committed snapshot does. The ids are real AO org ids, which is what
// the FNG form and the backblast filter both key on.
const API = "https://api.f3nation.com/v1";
const DEFAULT_REGION = "52724"; // The Remnant

export async function onRequestGet({ env }) {
  const region = env.F3_REGION_ORG_ID || DEFAULT_REGION;

  try {
    const response = await fetch(
      `${API}/map/location/aos-in-region?regionId=${encodeURIComponent(region)}`,
      {
        headers: { accept: "application/json" },
        cf: { cacheTtl: 300, cacheEverything: true },
      }
    );
    if (!response.ok) throw new Error(`aos-in-region responded ${response.status}`);

    const data = await response.json();
    const aos = (data.aos || [])
      .map((ao) => ({ id: Number(ao.id), name: String(ao.name || "").trim() }))
      .filter((ao) => Number.isFinite(ao.id) && ao.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (!aos.length) throw new Error("No AOs returned");

    return Response.json({ aos }, { headers: { "cache-control": "public, max-age=300" } });
  } catch {
    return Response.json(fallback, { headers: { "cache-control": "public, max-age=60" } });
  }
}
