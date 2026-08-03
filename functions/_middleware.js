export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname === "f3remnant.com" || url.hostname === "www.f3remnant.com") {
    url.hostname = "f3theremnant.com";
    return Response.redirect(url.toString(), 301);
  }

  return next();
}
