import { jsonResponse } from './api/_lib/security';
import { CloudflareEnv, PagesFunction } from './api/_lib/types';

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

export const onRequest: PagesFunction<CloudflareEnv> = async (context) => {
  const { request } = context;
  const pathname = new URL(request.url).pathname;

  try {
    const response = await context.next();
    const nextResponse = new Response(response.body, response);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      if (!nextResponse.headers.has(key)) {
        nextResponse.headers.set(key, value);
      }
    }
    return nextResponse;
  } catch (err) {
    console.error('[CF_PAGES_ERROR]', pathname, err instanceof Error ? err.message : String(err));
    if (pathname.startsWith('/api/')) {
      return jsonResponse(
        { error: 'Error interno al procesar la solicitud.' },
        500,
        SECURITY_HEADERS,
      );
    }
    return new Response('Error interno del servidor.', {
      status: 500,
      headers: SECURITY_HEADERS,
    });
  }
};
