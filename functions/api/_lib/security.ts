import { CloudflareEnv, TicketRow, TicketZone } from './types';

export const SESSION_COOKIE_NAME = 'mosly_session';
export const MAX_RECEIPT_BYTES_R2 = 5 * 1024 * 1024;
export const MAX_RECEIPT_BYTES_D1 = 1_500_000;

export function cleanEnvSecret(raw: string | undefined): string {
  if (!raw) return '';
  let val = raw.trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1).trim();
  }
  return val;
}

export function getAdminPassword(env: CloudflareEnv): string | null {
  const pwd = cleanEnvSecret(env.ADMIN_PASSWORD);
  return pwd.length > 0 ? pwd : null;
}

export function getQrSecretKey(env: CloudflareEnv): string | null {
  const key = cleanEnvSecret(env.QR_SECRET_KEY) || cleanEnvSecret(env.JWT_SECRET);
  return key.length >= 16 ? key : key.length > 0 ? key : null;
}

export function sanitizeText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\0/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function getClientIp(request: Request): string {
  const cfIp = request.headers.get('CF-Connecting-IP')?.trim();
  if (cfIp) return cfIp;
  const xff = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
  return xff || 'unknown';
}

export function verifySameOriginCsrf(request: Request): boolean {
  const origin = request.headers.get('Origin');
  const expectedOrigin = new URL(request.url).origin;
  if (origin && origin !== expectedOrigin) {
    return false;
  }
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
    return false;
  }
  return true;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64url.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(''));
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(message));
  return bytesToBase64Url(new Uint8Array(sig));
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', textEncoder.encode(a)),
    crypto.subtle.digest('SHA-256', textEncoder.encode(b)),
  ]);
  return constantTimeEqualBytes(new Uint8Array(hashA), new Uint8Array(hashB));
}

async function getDerivedSessionSecret(qrSecret: string): Promise<string> {
  return hmacSha256Base64Url(qrSecret, 'mosly-http-only-session-v1');
}

export async function createSessionToken(qrSecret: string): Promise<string> {
  const sessionSecret = await getDerivedSessionSecret(qrSecret);
  const payloadBytes = textEncoder.encode(
    JSON.stringify({
      role: 'admin',
      jti: crypto.randomUUID(),
      exp: Date.now() + 1000 * 60 * 60 * 12,
    }),
  );
  const payload = bytesToBase64Url(payloadBytes);
  const signature = await hmacSha256Base64Url(sessionSecret, payload);
  return `${payload}.${signature}`;
}

export async function verifySessionToken(
  token: string | undefined,
  qrSecret: string | null,
): Promise<boolean> {
  if (!token || !qrSecret || !token.includes('.')) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  if (!payload || !signature) return false;

  const sessionSecret = await getDerivedSessionSecret(qrSecret);
  const expected = await hmacSha256Base64Url(sessionSecret, payload);

  const sigBytes = textEncoder.encode(signature);
  const expBytes = textEncoder.encode(expected);
  if (!constantTimeEqualBytes(sigBytes, expBytes)) return false;

  try {
    const parsed = JSON.parse(textDecoder.decode(base64UrlToBytes(payload))) as {
      role?: string;
      exp?: number;
    };
    return parsed.role === 'admin' && typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export function extractSessionToken(request: Request): string | undefined {
  const cookies = parseCookies(request.headers.get('Cookie'));
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  return undefined;
}

export function buildSessionCookieHeader(request: Request, token: string, maxAgeSeconds: number): string {
  const isHttps = new URL(request.url).protocol === 'https:';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
  ];
  if (isHttps) {
    parts.push('SameSite=Lax', 'Secure');
  } else {
    parts.push('SameSite=Lax');
  }
  return parts.join('; ');
}

export async function requireStaffAuth(
  request: Request,
  env: CloudflareEnv,
): Promise<Response | null> {
  const qrSecret = getQrSecretKey(env);
  const token = extractSessionToken(request);
  const valid = await verifySessionToken(token, qrSecret);
  if (!valid) {
    return jsonResponse({ error: 'Sesión requerida o expirada. Inicia sesión nuevamente.' }, 401);
  }
  return null;
}

export interface SignedQrPayload {
  v: 1;
  tid: string;
  z: TicketZone;
  n: string;
  iat: number;
}

export async function signQrPayload(
  qrSecret: string,
  ticketId: string,
  zone: TicketZone,
  nonceHash: string,
): Promise<string> {
  const payloadObj: SignedQrPayload = {
    v: 1,
    tid: ticketId,
    z: zone,
    n: nonceHash,
    iat: Math.floor(Date.now() / 1000),
  };
  const encodedPayload = bytesToBase64Url(textEncoder.encode(JSON.stringify(payloadObj)));
  const sig = await hmacSha256Base64Url(qrSecret, encodedPayload);
  return `MSL1.${encodedPayload}.${sig}`;
}

export async function verifyQrPayload(
  qrSecret: string | null,
  token: string,
): Promise<SignedQrPayload | null> {
  if (!qrSecret || !token || typeof token !== 'string') return null;
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== 'MSL1') return null;

  const [, encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;

  const expectedSig = await hmacSha256Base64Url(qrSecret, encodedPayload);
  if (!constantTimeEqualBytes(textEncoder.encode(signature), textEncoder.encode(expectedSig))) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      textDecoder.decode(base64UrlToBytes(encodedPayload)),
    ) as SignedQrPayload;
    if (
      parsed.v !== 1 ||
      typeof parsed.tid !== 'string' ||
      typeof parsed.n !== 'string' ||
      (parsed.z !== 'general' &&
        parsed.z !== 'vip' &&
        parsed.z !== 'box_individual' &&
        parsed.z !== 'mesa_box_6')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface DecodedReceiptImage {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  ext: 'jpg' | 'png' | 'webp';
  bytes: Uint8Array;
}

export function validateAndDecodeImage(
  dataUrl: string,
  maxBytes: number,
): DecodedReceiptImage | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;

  const declaredMime = match[1] as 'image/jpeg' | 'image/png' | 'image/webp';
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(match[2]);
  } catch {
    return null;
  }

  if (bytes.length < 32 || bytes.length > maxBytes) {
    return null;
  }

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isWebp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;

  if (declaredMime === 'image/jpeg' && isJpeg) return { mime: 'image/jpeg', ext: 'jpg', bytes };
  if (declaredMime === 'image/png' && isPng) return { mime: 'image/png', ext: 'png', bytes };
  if (declaredMime === 'image/webp' && isWebp) return { mime: 'image/webp', ext: 'webp', bytes };
  return null;
}

export function generateOrderId(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const num = 100000 + (buf[0] % 900000);
  return `ORD-${num}`;
}

export function generateRandomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function serializeAdminOrder(row: TicketRow) {
  return {
    id: row.id,
    buyer_name: row.buyer_name,
    buyer_email: row.buyer_email,
    zone: row.zone,
    people_count: row.people_count,
    amount: row.amount,
    currency: row.currency,
    payment_method: row.payment_method,
    has_receipt: Boolean(row.receipt_filename || row.receipt_data_url),
    status: row.status,
    qr_token: row.qr_token,
    qr_data_url: row.qr_data_url,
    email_status: row.email_status,
    email_error: row.email_error,
    created_at: row.created_at,
    approved_at: row.approved_at,
    used_at: row.used_at,
  };
}
