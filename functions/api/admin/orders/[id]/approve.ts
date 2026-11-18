import { getDatabase } from '../../../_lib/db';
import { sendTicketEmailEdge } from '../../../_lib/email';
import { buildQrAssetsEdge } from '../../../_lib/qr';
import {
  cleanEnvSecret,
  generateRandomHex,
  getQrSecretKey,
  jsonResponse,
  requireStaffAuth,
  serializeAdminOrder,
  signQrPayload,
  verifySameOriginCsrf,
} from '../../../_lib/security';
import { CloudflareEnv, PagesFunction, TicketRow } from '../../../_lib/types';

export const onRequestPost: PagesFunction<CloudflareEnv, { id: string }> = async ({
  request,
  env,
  params,
}) => {
  if (!verifySameOriginCsrf(request)) {
    return jsonResponse({ error: 'Solicitud no autorizada.' }, 403);
  }

  const authError = await requireStaffAuth(request, env);
  if (authError) return authError;

  const qrSecret = getQrSecretKey(env);
  if (!qrSecret) {
    return jsonResponse({ error: 'Falta configurar QR_SECRET_KEY en Cloudflare Pages.' }, 503);
  }

  const db = await getDatabase(env);
  if (!db) {
    return jsonResponse({ error: 'Base de datos D1 no configurada.' }, 503);
  }

  const orderId = typeof params.id === 'string' ? params.id.trim() : '';
  const existing = await db
    .prepare('SELECT * FROM tickets WHERE id = ?')
    .bind(orderId)
    .first<TicketRow>();

  if (!existing) {
    return jsonResponse({ error: 'Solicitud no encontrada.' }, 404);
  }

  if (existing.status === 'used') {
    return jsonResponse({ error: 'Esta entrada ya fue escaneada en puerta.' }, 409);
  }

  if (existing.status === 'rejected') {
    return jsonResponse({ error: 'Esta solicitud fue rechazada previamente.' }, 409);
  }

  const nonceHash = existing.qr_nonce || generateRandomHex(8);
  const qrToken = existing.qr_token || (await signQrPayload(qrSecret, existing.id, existing.zone, nonceHash));
  const { qrDataUrl, qrBuffer } = await buildQrAssetsEdge(qrToken);
  const approvedAt = existing.approved_at || new Date().toISOString();

  await db
    .prepare(
      `UPDATE tickets
       SET status = 'approved',
           qr_nonce = ?,
           qr_token = ?,
           qr_data_url = ?,
           approved_at = ?
       WHERE id = ?`,
    )
    .bind(nonceHash, qrToken, qrDataUrl, approvedAt, orderId)
    .run();

  const requestOrigin = new URL(request.url).origin;
  const rawAppUrl = cleanEnvSecret(env.APP_URL);
  const baseUrl = rawAppUrl && /^https?:\/\//i.test(rawAppUrl) ? rawAppUrl : requestOrigin;
  const passUrl = `${baseUrl.replace(/\/$/, '')}/#pase?t=${encodeURIComponent(qrToken)}`;

  const { emailStatus, emailError } = await sendTicketEmailEdge(
    env,
    existing,
    qrToken,
    qrBuffer,
    passUrl,
  );

  await db
    .prepare(
      `UPDATE tickets
       SET email_status = ?,
           email_error = ?
       WHERE id = ?`,
    )
    .bind(emailStatus, emailError, orderId)
    .run();

  const updated = await db
    .prepare('SELECT * FROM tickets WHERE id = ?')
    .bind(orderId)
    .first<TicketRow>();

  return jsonResponse({ order: updated ? serializeAdminOrder(updated) : null });
};
