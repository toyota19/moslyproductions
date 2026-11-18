import { getDatabase } from './_lib/db';
import { getQrSecretKey, jsonResponse, verifyQrPayload } from './_lib/security';
import { CloudflareEnv, PagesFunction, TicketRow } from './_lib/types';

export const onRequestGet: PagesFunction<CloudflareEnv> = async ({ request, env }) => {
  const url = new URL(request.url);
  const rawToken = url.searchParams.get('t')?.trim() || '';
  const verified = await verifyQrPayload(getQrSecretKey(env), rawToken);

  if (!verified) {
    return jsonResponse({ error: 'Pase digital no válido.' }, 403);
  }

  const db = await getDatabase(env);
  if (!db) {
    return jsonResponse({ error: 'Base de datos no configurada.' }, 503);
  }

  const ticket = await db
    .prepare('SELECT * FROM tickets WHERE id = ?')
    .bind(verified.tid)
    .first<TicketRow>();

  if (
    !ticket ||
    ticket.qr_token !== rawToken ||
    ticket.qr_nonce !== verified.n ||
    (ticket.status !== 'approved' && ticket.status !== 'used')
  ) {
    return jsonResponse({ error: 'Este pase no se encuentra activo.' }, 404);
  }

  return jsonResponse({
    id: ticket.id,
    buyer_name: ticket.buyer_name,
    zone: ticket.zone,
    people_count: ticket.people_count,
    status: ticket.status,
    qr_token: ticket.qr_token,
    qr_data_url: ticket.qr_data_url,
    approved_at: ticket.approved_at,
    used_at: ticket.used_at,
  });
};
