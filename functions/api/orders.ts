import { checkRateLimit, getDatabase } from './_lib/db';
import {
  bytesToBase64,
  generateOrderId,
  getClientIp,
  jsonResponse,
  MAX_RECEIPT_BYTES_D1,
  MAX_RECEIPT_BYTES_R2,
  sanitizeText,
  validateAndDecodeImage,
  verifySameOriginCsrf,
} from './_lib/security';
import {
  CloudflareEnv,
  PagesFunction,
  PaymentCurrency,
  PaymentMethod,
  TicketZone,
  VALID_METHODS_BY_CURRENCY,
  ZONE_PEOPLE_COUNT,
  ZONE_PRICES,
} from './_lib/types';

export const onRequestPost: PagesFunction<CloudflareEnv> = async ({ request, env }) => {
  if (!verifySameOriginCsrf(request)) {
    return jsonResponse({ error: 'Solicitud no autorizada.' }, 403);
  }

  const db = await getDatabase(env);
  if (!db) {
    console.error('[DB] Cloudflare D1 binding "DB" is missing.');
    return jsonResponse(
      { error: 'El servicio de reservas está en mantenimiento. Intenta en unos minutos.' },
      503,
    );
  }

  const ip = getClientIp(request);
  const limit = await checkRateLimit(db, `orders:${ip}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    return jsonResponse(
      { error: 'Has enviado varias solicitudes recientes. Intenta nuevamente en unos minutos.' },
      429,
      { 'Retry-After': String(limit.retryAfterSec) },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    buyerName?: unknown;
    buyerEmail?: unknown;
    zone?: unknown;
    currency?: unknown;
    paymentMethod?: unknown;
    receiptDataUrl?: unknown;
  } | null;

  if (!body) {
    return jsonResponse({ error: 'Datos de solicitud inválidos.' }, 400);
  }

  const cleanName = sanitizeText(body.buyerName, 120);
  const cleanEmail = sanitizeText(body.buyerEmail, 180).toLowerCase();
  const cleanZone: TicketZone | null =
    body.zone === 'general' ||
    body.zone === 'vip' ||
    body.zone === 'box_individual' ||
    body.zone === 'mesa_box_6'
      ? body.zone
      : null;
  const cleanCurrency: PaymentCurrency | null =
    body.currency === 'USD' || body.currency === 'BS' ? body.currency : null;
  const cleanMethod =
    typeof body.paymentMethod === 'string' ? (body.paymentMethod as PaymentMethod) : null;
  const rawReceipt = typeof body.receiptDataUrl === 'string' ? body.receiptDataUrl.trim() : '';

  if (cleanName.length < 2) {
    return jsonResponse({ error: 'Ingresa tu nombre completo.' }, 400);
  }

  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  if (!emailRegex.test(cleanEmail)) {
    return jsonResponse({ error: 'Ingresa un correo electrónico válido.' }, 400);
  }

  if (!cleanZone) {
    return jsonResponse({ error: 'Selecciona una zona válida.' }, 400);
  }

  if (!cleanCurrency) {
    return jsonResponse({ error: 'Selecciona una moneda de pago válida.' }, 400);
  }

  if (!cleanMethod || !VALID_METHODS_BY_CURRENCY[cleanCurrency].includes(cleanMethod)) {
    return jsonResponse({ error: 'Método de pago inválido para la moneda elegida.' }, 400);
  }

  const maxAllowedBytes = env.RECEIPTS_BUCKET ? MAX_RECEIPT_BYTES_R2 : MAX_RECEIPT_BYTES_D1;
  const decodedImage = validateAndDecodeImage(rawReceipt, maxAllowedBytes);
  if (!decodedImage) {
    return jsonResponse(
      { error: 'El comprobante debe ser una imagen válida (JPG, PNG o WEBP) de máximo 5 MB.' },
      400,
    );
  }

  let receiptFilename: string | null = null;
  let storedDataUrl = '';

  if (env.RECEIPTS_BUCKET) {
    const objectKey = `${crypto.randomUUID()}.${decodedImage.ext}`;
    await env.RECEIPTS_BUCKET.put(objectKey, decodedImage.bytes, {
      httpMetadata: { contentType: decodedImage.mime },
    });
    receiptFilename = objectKey;
  } else {
    receiptFilename = `${crypto.randomUUID()}.${decodedImage.ext}`;
    storedDataUrl = `data:${decodedImage.mime};base64,${bytesToBase64(decodedImage.bytes)}`;
  }

  let orderId = generateOrderId();
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = await db
      .prepare('SELECT 1 AS found FROM tickets WHERE id = ?')
      .bind(orderId)
      .first<{ found: number }>();
    if (!existing) break;
    orderId = generateOrderId();
  }

  const amount = ZONE_PRICES[cleanZone];
  const peopleCount = ZONE_PEOPLE_COUNT[cleanZone];
  const createdAt = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO tickets (
        id, buyer_name, buyer_email, zone, people_count, amount, currency, payment_method,
        receipt_data_url, receipt_filename, status, email_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'not_sent', ?)`,
    )
    .bind(
      orderId,
      cleanName,
      cleanEmail,
      cleanZone,
      peopleCount,
      amount,
      cleanCurrency,
      cleanMethod,
      storedDataUrl,
      receiptFilename,
      createdAt,
    )
    .run();

  return jsonResponse(
    {
      id: orderId,
      buyer_name: cleanName,
      buyer_email: cleanEmail,
      zone: cleanZone,
      people_count: peopleCount,
      amount,
      currency: cleanCurrency,
      payment_method: cleanMethod,
      status: 'pending',
      created_at: createdAt,
    },
    201,
  );
};
