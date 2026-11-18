import { getDatabase } from '../_lib/db';
import { jsonResponse, requireStaffAuth } from '../_lib/security';
import { CloudflareEnv, PagesFunction, TicketZone } from '../_lib/types';

export const onRequestGet: PagesFunction<CloudflareEnv> = async ({ request, env }) => {
  const authError = await requireStaffAuth(request, env);
  if (authError) return authError;

  const db = await getDatabase(env);
  if (!db) {
    return jsonResponse({ error: 'Base de datos D1 no configurada.' }, 503);
  }

  const counts = await db
    .prepare(
      `SELECT
        SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS usedCount,
        SUM(CASE WHEN status IN ('approved', 'used') THEN 1 ELSE 0 END) AS approvedTotalCount,
        SUM(CASE WHEN status = 'used' THEN people_count ELSE 0 END) AS peopleEnteredCount,
        SUM(CASE WHEN status = 'used' AND zone = 'vip' THEN 1 ELSE 0 END) AS vipUsedCount,
        SUM(CASE WHEN status = 'used' AND zone = 'general' THEN 1 ELSE 0 END) AS generalUsedCount,
        SUM(CASE WHEN status = 'used' AND zone = 'box_individual' THEN 1 ELSE 0 END) AS boxIndividualUsedCount,
        SUM(CASE WHEN status = 'used' AND zone = 'mesa_box_6' THEN 1 ELSE 0 END) AS mesaBoxUsedCount
      FROM tickets`,
    )
    .first<{
      usedCount: number | null;
      approvedTotalCount: number | null;
      peopleEnteredCount: number | null;
      vipUsedCount: number | null;
      generalUsedCount: number | null;
      boxIndividualUsedCount: number | null;
      mesaBoxUsedCount: number | null;
    }>();

  const recentResult = await db
    .prepare(
      `SELECT id, buyer_name, zone, people_count, used_at
       FROM tickets
       WHERE status = 'used' AND used_at IS NOT NULL
       ORDER BY used_at DESC
       LIMIT 12`,
    )
    .all<{
      id: string;
      buyer_name: string;
      zone: TicketZone;
      people_count: number;
      used_at: string;
    }>();

  return jsonResponse({
    stats: {
      usedCount: counts?.usedCount || 0,
      approvedTotalCount: counts?.approvedTotalCount || 0,
      peopleEnteredCount: counts?.peopleEnteredCount || 0,
      vipUsedCount: counts?.vipUsedCount || 0,
      generalUsedCount: counts?.generalUsedCount || 0,
      boxIndividualUsedCount: counts?.boxIndividualUsedCount || 0,
      mesaBoxUsedCount: counts?.mesaBoxUsedCount || 0,
    },
    recent: recentResult.results || [],
  });
};
