interface ServiceBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface Env {
  ORBIT_CLOUD_API: ServiceBinding;
}

interface PagesContext {
  request: Request;
  env: Env;
}

export async function onRequest({ request, env }: PagesContext): Promise<Response> {
  const incoming = new URL(request.url);
  if (incoming.pathname !== '/api/cloud/v1/workspaces') {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
  }

  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!assertion || assertion.length > 16_384) {
    return Response.json(
      { error: 'UNAUTHENTICATED', message: 'A Cloudflare Access session is required.' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }

  const headers = new Headers({
    accept: 'application/json',
    'Cf-Access-Jwt-Assertion': assertion,
  });
  let body: string | undefined;
  if (request.method === 'POST') {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return Response.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
    }
    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > 4096) {
      return Response.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }
    body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 4096) {
      return Response.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }
    headers.set('content-type', 'application/json');
  }

  const upstreamUrl = new URL('https://orbit-cloud-api.internal/v1/workspaces');
  upstreamUrl.search = incoming.search;
  const upstream = await env.ORBIT_CLOUD_API.fetch(
    new Request(upstreamUrl, { method: request.method, headers, body }),
  );
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set('cache-control', 'no-store');
  responseHeaders.set('x-content-type-options', 'nosniff');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
