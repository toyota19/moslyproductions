import { jsonResponse } from '../functions/api/_lib/security';
import { CloudflareEnv, EventContext } from '../functions/api/_lib/types';
import { onRequestGet as adminOrdersGet } from '../functions/api/admin/orders';
import { onRequestPost as approvePost } from '../functions/api/admin/orders/[id]/approve';
import { onRequestGet as receiptGet } from '../functions/api/admin/orders/[id]/receipt';
import { onRequestPost as rejectPost } from '../functions/api/admin/orders/[id]/reject';
import { onRequestPost as loginPost } from '../functions/api/auth/login';
import { onRequestPost as logoutPost } from '../functions/api/auth/logout';
import { onRequestGet as sessionGet } from '../functions/api/auth/session';
import { onRequestGet as healthGet } from '../functions/api/health';
import { onRequestPost as ordersPost } from '../functions/api/orders';
import { onRequestGet as passGet } from '../functions/api/pass';
import { onRequestGet as scannerRecentGet } from '../functions/api/scanner/recent';
import { onRequestPost as scannerValidatePost } from '../functions/api/scanner/validate';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
};

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function makeContext<P extends Record<string, string> = Record<string, string>>(
  request: Request,
  env: CloudflareEnv,
  execCtx: ExecutionContext,
  params: P,
): EventContext<CloudflareEnv, P> {
  return {
    request,
    env,
    params,
    waitUntil: (promise) => execCtx.waitUntil(promise),
    next: () => Promise.resolve(new Response(null, { status: 404 })),
  };
}

function withSecurityHeaders(response: Response): Response {
  const nextResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!nextResponse.headers.has(key)) {
      nextResponse.headers.set(key, value);
    }
  }
  return nextResponse;
}

async function routeApi(
  request: Request,
  env: CloudflareEnv,
  execCtx: ExecutionContext,
  pathname: string,
): Promise<Response> {
  const method = request.method.toUpperCase();

  if (pathname === '/api/health' && method === 'GET') {
    return healthGet(makeContext(request, env, execCtx, {}));
  }
  if (pathname === '/api/auth/session' && method === 'GET') {
    return sessionGet(makeContext(request, env, execCtx, {}));
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    return loginPost(makeContext(request, env, execCtx, {}));
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    return logoutPost(makeContext(request, env, execCtx, {}));
  }
  if (pathname === '/api/orders' && method === 'POST') {
    return ordersPost(makeContext(request, env, execCtx, {}));
  }
  if (pathname === '/api/pass' && method === 'GET') {
    return passGet(makeContext(request, env, execCtx, {}));
  }
  if (pathname === '/api/admin/orders' && method === 'GET') {
    return adminOrdersGet(makeContext(request, env, execCtx, {}));
  }
  if (pathname === '/api/scanner/validate' && method === 'POST') {
    return scannerValidatePost(makeContext(request, env, execCtx, {}));
  }
  if (pathname === '/api/scanner/recent' && method === 'GET') {
    return scannerRecentGet(makeContext(request, env, execCtx, {}));
  }

  const receiptMatch = /^\/api\/admin\/orders\/([^/]+)\/receipt$/.exec(pathname);
  if (receiptMatch && method === 'GET') {
    return receiptGet(
      makeContext(request, env, execCtx, { id: decodeURIComponent(receiptMatch[1]) }),
    );
  }

  const approveMatch = /^\/api\/admin\/orders\/([^/]+)\/approve$/.exec(pathname);
  if (approveMatch && method === 'POST') {
    return approvePost(
      makeContext(request, env, execCtx, { id: decodeURIComponent(approveMatch[1]) }),
    );
  }

  const rejectMatch = /^\/api\/admin\/orders\/([^/]+)\/reject$/.exec(pathname);
  if (rejectMatch && method === 'POST') {
    return rejectPost(
      makeContext(request, env, execCtx, { id: decodeURIComponent(rejectMatch[1]) }),
    );
  }

  return jsonResponse({ error: 'Endpoint de API no encontrado.' }, 404);
}

export default {
  async fetch(
    request: Request,
    env: CloudflareEnv,
    execCtx: ExecutionContext,
  ): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    try {
      if (pathname.startsWith('/api/')) {
        const apiResponse = await routeApi(request, env, execCtx, pathname);
        return withSecurityHeaders(apiResponse);
      }

      if (env.ASSETS) {
        const assetResponse = await env.ASSETS.fetch(request);
        return withSecurityHeaders(assetResponse);
      }

      return new Response('Static assets binding (ASSETS) not configured.', {
        status: 500,
        headers: SECURITY_HEADERS,
      });
    } catch (err) {
      console.error('[CF_WORKER_ERROR]', pathname, err instanceof Error ? err.message : String(err));
      if (pathname.startsWith('/api/')) {
        return withSecurityHeaders(
          jsonResponse({ error: 'Error interno al procesar la solicitud.' }, 500),
        );
      }
      return new Response('Error interno del servidor.', {
        status: 500,
        headers: SECURITY_HEADERS,
      });
    }
  },
};
