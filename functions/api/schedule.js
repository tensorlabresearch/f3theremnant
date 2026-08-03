import schedule from "../../data/schedule.json";

export async function onRequestGet() {
  return Response.json(schedule, {
    headers: {
      "cache-control": "public, max-age=300"
    }
  });
}
