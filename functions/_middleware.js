// _headers covers the static paths excluded in _routes.json. Everything else
// (the HTML pages and /api/*) is served through this function, so the same
// headers are applied here too.
const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
};

const secure = (response) => {
  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    result.headers.set(name, value);
  }
  return result;
};

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/screenshots/")) {
    return secure(new Response("Not found", { status: 404 }));
  }

  if (url.hostname === "f3remnant.com" || url.hostname === "www.f3remnant.com") {
    url.hostname = "f3theremnant.com";
    return Response.redirect(url.toString(), 301);
  }

  return secure(await next());
}
