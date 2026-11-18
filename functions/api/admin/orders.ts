import { getDatabase } from '../_lib/db';
import { jsonResponse, requireStaffAuth, serializeAdminOrder } from '../_lib/security';
import { CloudflareEnv, PagesFunction, TicketRow } from '../_lib/types';

export const onRequestGet: PagesFunction<CloudflareEnv> = async ({ request, env }) => {
  const authError = await requireStaffAuth(request, env);
  if (authError) return authError;

  const db = await getDatabase(env);
  if (!db) {
    return jsonResponse({ error: 'Base de datos D1 no configurada (binding DB).' }, 503);
  }

  const result = await db
    .prepare('SELECT * FROM tickets ORDER BY created_at DESC')
    .all<TicketRow>();

  return jsonResponse({
    orders: (result.results || []).map(serializeAdminOrder),
  });
};
