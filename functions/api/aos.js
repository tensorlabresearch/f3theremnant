import aos from "../../data/aos.json";

export async function onRequestGet() {
  return Response.json(aos, {
    headers: {
      "cache-control": "public, max-age=300"
    }
  });
}
