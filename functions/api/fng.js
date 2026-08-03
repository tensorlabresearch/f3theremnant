export async function onRequestPost({ request, env }) {
  const payload = await request.json().catch(() => null);
  if (!payload || payload.website) {
    return Response.json({ message: "Invalid submission." }, { status: 400 });
  }

  if (!env.FNG_WEBHOOK_URL) {
    return Response.json(
      { message: "FNG submissions are not configured yet." },
      { status: 503 }
    );
  }

  const response = await fetch(env.FNG_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return Response.json({ message: "Submission failed." }, { status: 502 });
  }

  return Response.json({ ok: true });
}
