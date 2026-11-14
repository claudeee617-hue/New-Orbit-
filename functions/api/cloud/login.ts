interface PagesContext {
  request: Request;
}

export function onRequest({ request }: PagesContext): Response {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { allow: 'GET' } });
  }
  return Response.redirect(new URL('/', request.url), 302);
}
