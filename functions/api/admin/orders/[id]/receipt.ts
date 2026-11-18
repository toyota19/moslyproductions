import { getDatabase } from '../../../_lib/db';
import {
  jsonResponse,
  MAX_RECEIPT_BYTES_R2,
  requireStaffAuth,
  validateAndDecodeImage,
} from '../../../_lib/security';
import { CloudflareEnv, PagesFunction } from '../../../_lib/types';

export const onRequestGet: PagesFunction<CloudflareEnv, { id: string }> = async ({
  request,
  env,
  params,
}) => {
  const authError = await requireStaffAuth(request, env);
  if (authError) return authError;

  const db = await getDatabase(env);
  if (!db) {
    return jsonResponse({ error: 'Base de datos D1 no configurada.' }, 503);
  }

  const orderId = typeof params.id === 'string' ? params.id.trim() : '';
  if (!orderId) {
    return jsonResponse({ error: 'Identificador inválido.' }, 400);
  }

  const row = await db
    .prepare('SELECT receipt_filename, receipt_data_url FROM tickets WHERE id = ?')
    .bind(orderId)
    .first<{ receipt_filename: string | null; receipt_data_url: string }>();

  if (!row) {
    return jsonResponse({ error: 'Comprobante no encontrado.' }, 404);
  }

  if (env.RECEIPTS_BUCKET && row.receipt_filename) {
    const object = await env.RECEIPTS_BUCKET.get(row.receipt_filename);
    if (object) {
      const ext = row.receipt_filename.split('.').pop()?.toLowerCase();
      const fallbackMime =
        ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const contentType = object.httpMetadata?.contentType || fallbackMime;
      const body = await object.arrayBuffer();
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      });
    }
  }

  if (row.receipt_data_url) {
    const parsed = validateAndDecodeImage(row.receipt_data_url, MAX_RECEIPT_BYTES_R2);
    if (parsed) {
      const copy = new Uint8Array(parsed.bytes.byteLength);
      copy.set(parsed.bytes);
      return new Response(copy.buffer, {
        status: 200,
        headers: {
          'Content-Type': parsed.mime,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      });
    }
  }

  return jsonResponse({ error: 'Archivo de comprobante no disponible.' }, 404);
};
