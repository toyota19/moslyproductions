import { checkRateLimit, getDatabase } from '../_lib/db';
import {
  getClientIp,
  getQrSecretKey,
  jsonResponse,
  requireStaffAuth,
  verifyQrPayload,
  verifySameOriginCsrf,
} from '../_lib/security';
import { CloudflareEnv, PagesFunction, TicketRow } from '../_lib/types';

export const onRequestPost: PagesFunction<CloudflareEnv> = async ({ request, env }) => {
  if (!verifySameOriginCsrf(request)) {
    return jsonResponse(
      {
        valid: false,
        reason: 'invalid_input',
        message: 'Solicitud de origen no autorizado.',
      },
      403,
    );
  }

  const authError = await requireStaffAuth(request, env);
  if (authError) return authError;

  const db = await getDatabase(env);
  if (!db) {
    return jsonResponse(
      {
        valid: false,
        reason: 'invalid_input',
        message: 'Base de datos D1 no configurada.',
      },
      503,
    );
  }

  const ip = getClientIp(request);
  const limit = await checkRateLimit(db, `scanner:${ip}`, 120, 60 * 1000);
  if (!limit.allowed) {
    return jsonResponse(
      {
        valid: false,
        reason: 'invalid_input',
        message: 'Límite temporal de lecturas alcanzado. Espera un momento.',
      },
      429,
      { 'Retry-After': String(limit.retryAfterSec) },
    );
  }

  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  let normalized = typeof body?.token === 'string' ? body.token.trim() : '';

  if (normalized.includes('t=MSL1.')) {
    try {
      const idx = normalized.indexOf('t=MSL1.');
      const extracted = normalized.slice(idx + 2).split('&')[0];
      normalized = decodeURIComponent(extracted);
    } catch {
      // Keep original string
    }
  }

  if (!normalized || normalized.length < 16 || normalized.length > 600) {
    return jsonResponse(
      {
        valid: false,
        reason: 'invalid_input',
        message: 'El código escaneado no corresponde a un pase oficial.',
      },
      400,
    );
  }

  const signedPayload = await verifyQrPayload(getQrSecretKey(env), normalized);
  if (!signedPayload) {
    return jsonResponse(
      {
        valid: false,
        reason: 'invalid_signature',
        message: 'Código QR no válido o firma criptográfica alterada.',
      },
      403,
    );
  }

  const ticket = await db
    .prepare('SELECT * FROM tickets WHERE id = ?')
    .bind(signedPayload.tid)
    .first<TicketRow>();

  if (
    !ticket ||
    ticket.qr_token !== normalized ||
    ticket.qr_nonce !== signedPayload.n ||
    ticket.zone !== signedPayload.z
  ) {
    return jsonResponse(
      {
        valid: false,
        reason: 'not_found',
        message: 'Pase no registrado o revocado en el sistema.',
      },
      404,
    );
  }

  if (ticket.status === 'pending' || ticket.status === 'rejected') {
    return jsonResponse(
      {
        valid: false,
        reason: 'not_approved',
        message:
          ticket.status === 'pending'
            ? 'Esta entrada aún está pendiente de verificación.'
            : 'Esta entrada fue rechazada y no autoriza el acceso.',
        ticket: {
          id: ticket.id,
          buyer_name: ticket.buyer_name,
          zone: ticket.zone,
          people_count: ticket.people_count,
          amount: ticket.amount,
          currency: ticket.currency,
          payment_method: ticket.payment_method,
          status: ticket.status,
          approved_at: ticket.approved_at,
          used_at: ticket.used_at,
        },
      },
      400,
    );
  }

  if (ticket.status === 'used') {
    return jsonResponse(
      {
        valid: false,
        reason: 'already_used',
        message: 'Esta entrada ya fue escaneada previamente. Acceso bloqueado.',
        ticket: {
          id: ticket.id,
          buyer_name: ticket.buyer_name,
          zone: ticket.zone,
          people_count: ticket.people_count,
          amount: ticket.amount,
          currency: ticket.currency,
          payment_method: ticket.payment_method,
          status: ticket.status,
          approved_at: ticket.approved_at,
          used_at: ticket.used_at,
        },
      },
      409,
    );
  }

  // Atomic idempotent transition from approved -> used
  const usedAt = new Date().toISOString();
  const updateResult = await db
    .prepare(
      "UPDATE tickets SET status = 'used', used_at = ? WHERE id = ? AND status = 'approved'",
    )
    .bind(usedAt, ticket.id)
    .run();

  if (updateResult.meta.changes !== 1) {
    const latest = await db
      .prepare('SELECT used_at FROM tickets WHERE id = ?')
      .bind(ticket.id)
      .first<{ used_at: string | null }>();

    return jsonResponse(
      {
        valid: false,
        reason: 'already_used',
        message: 'Entrada utilizada simultáneamente. Acceso bloqueado.',
        ticket: {
          id: ticket.id,
          buyer_name: ticket.buyer_name,
          zone: ticket.zone,
          people_count: ticket.people_count,
          amount: ticket.amount,
          currency: ticket.currency,
          payment_method: ticket.payment_method,
          status: 'used',
          approved_at: ticket.approved_at,
          used_at: latest?.used_at ?? ticket.used_at,
        },
      },
      409,
    );
  }

  return jsonResponse({
    valid: true,
    message: 'Acceso confirmado. Entrada marcada como usada.',
    ticket: {
      id: ticket.id,
      buyer_name: ticket.buyer_name,
      zone: ticket.zone,
      people_count: ticket.people_count,
      amount: ticket.amount,
      currency: ticket.currency,
      payment_method: ticket.payment_method,
      status: 'used',
      approved_at: ticket.approved_at,
      used_at: usedAt,
    },
  });
};
