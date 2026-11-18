import { getDatabase } from '../../../_lib/db';
import {
  jsonResponse,
  requireStaffAuth,
  serializeAdminOrder,
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
    return jsonResponse(
      { error: 'No se puede rechazar una entrada que ya fue utilizada.' },
      409,
    );
  }

  await db.prepare("UPDATE tickets SET status = 'rejected' WHERE id = ?").bind(orderId).run();

  const updated = await db
    .prepare('SELECT * FROM tickets WHERE id = ?')
    .bind(orderId)
    .first<TicketRow>();

  return jsonResponse({ order: updated ? serializeAdminOrder(updated) : null });
};
