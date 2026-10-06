const ORIGIN = "http://103.236.89.174:6969";

export async function onRequest(context) {
  const incoming = new URL(context.request.url);
  const upstream = `${ORIGIN}${incoming.pathname}${incoming.search}`;
  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  const headers = new Headers();
  const accept = context.request.headers.get("Accept");
  if (accept) headers.set("Accept", accept);
  const res = await fetch(upstream, {
    method: context.request.method,
    headers,
    redirect: "follow",
  });
  const out = new Headers(res.headers);
  out.set("Access-Control-Allow-Origin", "*");
  return new Response(res.body, { status: res.status, headers: out });
}
