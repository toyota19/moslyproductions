import { checkRateLimit, getDatabase } from '../_lib/db';
import {
  buildSessionCookieHeader,
  createSessionToken,
  getAdminPassword,
  getClientIp,
  getQrSecretKey,
  jsonResponse,
  timingSafeEqualStrings,
  verifySameOriginCsrf,
} from '../_lib/security';
import { CloudflareEnv, PagesFunction } from '../_lib/types';

export const onRequestPost: PagesFunction<CloudflareEnv> = async ({ request, env }) => {
  if (!verifySameOriginCsrf(request)) {
    return jsonResponse({ error: 'Solicitud de origen no autorizado.' }, 403);
  }

  const adminPassword = getAdminPassword(env);
  const qrSecret = getQrSecretKey(env);
  if (!adminPassword || !qrSecret) {
    const missing = [
      !adminPassword ? 'ADMIN_PASSWORD' : null,
      !qrSecret ? 'QR_SECRET_KEY' : null,
    ]
      .filter(Boolean)
      .join(' y ');
    console.error(`[AUTH] Missing runtime secret(s): ${missing}`);
    return jsonResponse(
      {
        error: `Falta configurar ${missing} en Variables y secretos de tiempo de ejecución del Worker (sección Vinculaciones, no en Compilaciones).`,
      },
      503,
    );
  }

  const db = await getDatabase(env);
  if (db) {
    const ip = getClientIp(request);
    const limit = await checkRateLimit(db, `login:${ip}`, 8, 15 * 60 * 1000);
    if (!limit.allowed) {
      return jsonResponse(
        { error: 'Demasiados intentos de acceso. Espera unos minutos antes de reintentar.' },
        429,
        { 'Retry-After': String(limit.retryAfterSec) },
      );
    }
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const provided = typeof body?.password === 'string' ? body.password : '';

  if (!provided || !(await timingSafeEqualStrings(provided, adminPassword))) {
    return jsonResponse({ error: 'Contraseña incorrecta.' }, 401);
  }

  const token = await createSessionToken(qrSecret);
  const cookieHeader = buildSessionCookieHeader(request, token, 60 * 60 * 12);

  return jsonResponse({ authenticated: true, token }, 200, {
    'Set-Cookie': cookieHeader,
  });
};
