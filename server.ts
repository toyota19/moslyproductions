import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import QRCode from 'qrcode';
import { Resend } from 'resend';

type TicketZone = 'general' | 'vip' | 'box_individual' | 'mesa_box_6';
type PaymentCurrency = 'USD' | 'BS';
type PaymentMethod =
  | 'transferencia_bs'
  | 'pago_movil'
  | 'transferencia_usd'
  | 'zelle'
  | 'binance';

const PORT = Number(process.env.PORT) || 3000;
const SESSION_COOKIE_NAME = 'mosly_session';
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5 MB strict limit

const CONFIGURED_QR_SECRET =
  process.env.QR_SECRET_KEY?.trim() || process.env.JWT_SECRET?.trim() || '';
const QR_SECRET_KEY = CONFIGURED_QR_SECRET || crypto.randomBytes(32).toString('hex');

if (!CONFIGURED_QR_SECRET) {
  console.warn(
    '[SECURITY] QR_SECRET_KEY is not set in environment; using an ephemeral runtime key.',
  );
}

if (!process.env.ADMIN_PASSWORD?.trim()) {
  console.warn(
    '[SECURITY] ADMIN_PASSWORD is not set in environment; admin and scanner logins are disabled until configured.',
  );
}

const SESSION_SECRET = crypto
  .createHmac('sha256', QR_SECRET_KEY)
  .update('mosly-http-only-session-v1')
  .digest('hex');

const ZONE_PRICES: Record<TicketZone, number> = {
  general: 20,
  vip: 30,
  box_individual: 60,
  mesa_box_6: 450,
};

const ZONE_PEOPLE_COUNT: Record<TicketZone, number> = {
  general: 1,
  vip: 1,
  box_individual: 1,
  mesa_box_6: 6,
};

const ZONE_LABELS: Record<TicketZone, string> = {
  general: 'General — Pista Principal',
  vip: 'VIP — Zona Preferencial',
  box_individual: 'Box Individual — Sector Box',
  mesa_box_6: 'Mesa Box — 6 Personas',
};

const VALID_METHODS_BY_CURRENCY: Record<PaymentCurrency, PaymentMethod[]> = {
  BS: ['transferencia_bs', 'pago_movil'],
  USD: ['transferencia_usd', 'zelle', 'binance'],
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transferencia_bs: 'Transferencia Bancaria (Bs)',
  pago_movil: 'Pago Móvil (Bs)',
  transferencia_usd: 'Transferencia Bancaria (USD)',
  zelle: 'Zelle (USD)',
  binance: 'Binance Pay (USD)',
};

const RECEIPTS_DIR = path.resolve(process.cwd(), 'uploads', 'receipts');
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

const dbPath = path.resolve(process.cwd(), 'noctis_tickets.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function ensureDatabaseSchema(): void {
  const existingTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tickets'")
    .get() as { sql?: string } | undefined;

  if (!existingTable) {
    db.exec(`
      CREATE TABLE tickets (
        id TEXT PRIMARY KEY,
        buyer_name TEXT NOT NULL,
        buyer_email TEXT NOT NULL,
        zone TEXT NOT NULL CHECK(zone IN ('general', 'vip', 'box_individual', 'mesa_box_6')),
        people_count INTEGER NOT NULL DEFAULT 1,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency IN ('USD', 'BS')),
        payment_method TEXT NOT NULL DEFAULT 'zelle',
        receipt_data_url TEXT NOT NULL DEFAULT '',
        receipt_filename TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'used')),
        qr_nonce TEXT,
        qr_token TEXT UNIQUE,
        qr_data_url TEXT,
        email_status TEXT NOT NULL DEFAULT 'not_sent',
        email_error TEXT,
        created_at TEXT NOT NULL,
        approved_at TEXT,
        used_at TEXT
      );
    `);
  } else {
    const sql = existingTable.sql || '';
    const needsMigration =
      !sql.includes('box_individual') ||
      !sql.includes('mesa_box_6') ||
      !sql.includes('currency') ||
      !sql.includes('payment_method') ||
      !sql.includes('people_count') ||
      !sql.includes('qr_nonce');

    if (needsMigration) {
      const hasCurrency = sql.includes('currency');
      const hasMethod = sql.includes('payment_method');
      const hasPeople = sql.includes('people_count');
      const hasNonce = sql.includes('qr_nonce');

      const migrate = db.transaction(() => {
        db.exec(`
          CREATE TABLE tickets_new (
            id TEXT PRIMARY KEY,
            buyer_name TEXT NOT NULL,
            buyer_email TEXT NOT NULL,
            zone TEXT NOT NULL CHECK(zone IN ('general', 'vip', 'box_individual', 'mesa_box_6')),
            people_count INTEGER NOT NULL DEFAULT 1,
            amount INTEGER NOT NULL,
            currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency IN ('USD', 'BS')),
            payment_method TEXT NOT NULL DEFAULT 'zelle',
            receipt_data_url TEXT NOT NULL DEFAULT '',
            receipt_filename TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'used')),
            qr_nonce TEXT,
            qr_token TEXT UNIQUE,
            qr_data_url TEXT,
            email_status TEXT NOT NULL DEFAULT 'not_sent',
            email_error TEXT,
            created_at TEXT NOT NULL,
            approved_at TEXT,
            used_at TEXT
          );

          INSERT INTO tickets_new (
            id, buyer_name, buyer_email, zone, people_count, amount, currency, payment_method,
            receipt_data_url, receipt_filename, status, qr_nonce, qr_token, qr_data_url,
            email_status, email_error, created_at, approved_at, used_at
          )
          SELECT
            id,
            buyer_name,
            buyer_email,
            zone,
            ${hasPeople ? 'people_count' : "CASE WHEN zone = 'mesa_box_6' THEN 6 ELSE 1 END"},
            amount,
            ${hasCurrency ? 'currency' : "'USD'"},
            ${hasMethod ? 'payment_method' : "'zelle'"},
            receipt_data_url,
            receipt_filename,
            status,
            ${hasNonce ? 'qr_nonce' : 'NULL'},
            qr_token,
            qr_data_url,
            CASE WHEN email_status IN ('skipped_no_key', 'failed') THEN 'pending_retry' ELSE email_status END,
            NULL,
            created_at,
            approved_at,
            used_at
          FROM tickets;

          DROP TABLE tickets;
          ALTER TABLE tickets_new RENAME TO tickets;
        `);
      });
      migrate();
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tickets_qr_token ON tickets(qr_token);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);
  `);
}

ensureDatabaseSchema();

interface TicketRow {
  id: string;
  buyer_name: string;
  buyer_email: string;
  zone: TicketZone;
  people_count: number;
  amount: number;
  currency: PaymentCurrency;
  payment_method: PaymentMethod;
  receipt_data_url: string;
  receipt_filename: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'used';
  qr_nonce: string | null;
  qr_token: string | null;
  qr_data_url: string | null;
  email_status: 'not_sent' | 'sent' | 'pending_retry';
  email_error: string | null;
  created_at: string;
  approved_at: string | null;
  used_at: string | null;
}

function getAdminPassword(): string | null {
  const pwd = process.env.ADMIN_PASSWORD?.trim();
  return pwd && pwd.length > 0 ? pwd : null;
}

function sanitizeText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\0/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
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

function isRequestHttps(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string') {
    return proto.split(',')[0].trim().toLowerCase() === 'https';
  }
  return false;
}

function createSessionToken(): string {
  const payload = Buffer.from(
    JSON.stringify({
      role: 'admin',
      jti: crypto.randomUUID(),
      exp: Date.now() + 1000 * 60 * 60 * 12,
    }),
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifySessionToken(token: string | undefined): boolean {
  if (!token || !token.includes('.')) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  if (!payload || !signature) return false;

  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: string;
      exp?: number;
    };
    return parsed.role === 'admin' && typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const secure = isRequestHttps(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${60 * 60 * 12}`,
    'HttpOnly',
  ];
  if (secure) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const secure = isRequestHttps(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
  ];
  if (secure) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function extractSessionToken(req: Request): string | undefined {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return cookies[SESSION_COOKIE_NAME];
  }
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return undefined;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const sessionToken = extractSessionToken(req);
  if (!verifySessionToken(sessionToken)) {
    res.status(401).json({ error: 'Sesión no autorizada. Inicia sesión para continuar.' });
    return;
  }
  next();
}

function generateOrderId(): string {
  const randomDigits = crypto.randomInt(100000, 999999);
  return `ORD-${randomDigits}`;
}

interface SignedQrPayload {
  tid: string;
  z: TicketZone;
  n: string;
  iat: number;
}

function signQrPayload(ticketId: string, zone: TicketZone, nonceHash: string): string {
  const payloadObj: SignedQrPayload = {
    tid: ticketId,
    z: zone,
    n: nonceHash,
    iat: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', QR_SECRET_KEY)
    .update(encoded)
    .digest('base64url');
  return `MSL1.${encoded}.${signature}`;
}

function verifyQrPayload(rawToken: string): SignedQrPayload | null {
  const trimmed = rawToken.trim();
  if (!trimmed.startsWith('MSL1.')) return null;

  const parts = trimmed.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, signature] = parts;
  if (!encoded || !signature) return null;

  const expectedSig = crypto
    .createHmac('sha256', QR_SECRET_KEY)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SignedQrPayload>;
    if (
      typeof parsed.tid !== 'string' ||
      typeof parsed.n !== 'string' ||
      (parsed.z !== 'general' &&
        parsed.z !== 'vip' &&
        parsed.z !== 'box_individual' &&
        parsed.z !== 'mesa_box_6')
    ) {
      return null;
    }
    return parsed as SignedQrPayload;
  } catch {
    return null;
  }
}

function validateAndDecodeImage(
  dataUrl: string,
): { buffer: Buffer; mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' } | null {
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) return null;

  const declaredMime = match[1].toLowerCase();
  const base64Body = match[2];
  const buffer = Buffer.from(base64Body, 'base64');

  if (buffer.byteLength < 12 || buffer.byteLength > MAX_RECEIPT_BYTES) {
    return null;
  }

  // Verify real binary magic bytes
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  const isWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if ((declaredMime === 'image/jpeg' || declaredMime === 'image/jpg') && isJpeg) {
    return { buffer, mime: 'image/jpeg', ext: 'jpg' };
  }
  if (declaredMime === 'image/png' && isPng) {
    return { buffer, mime: 'image/png', ext: 'png' };
  }
  if (declaredMime === 'image/webp' && isWebp) {
    return { buffer, mime: 'image/webp', ext: 'webp' };
  }

  return null;
}

function serializeAdminOrder(row: TicketRow) {
  return {
    id: row.id,
    buyer_name: row.buyer_name,
    buyer_email: row.buyer_email,
    zone: row.zone,
    people_count: row.people_count,
    amount: row.amount,
    currency: row.currency,
    payment_method: row.payment_method,
    receipt_filename: row.receipt_filename,
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

async function buildQrAssets(qrToken: string): Promise<{ qrDataUrl: string; qrBuffer: Buffer }> {
  const qrOptions: QRCode.QRCodeToDataURLOptions = {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 440,
    color: {
      dark: '#09090B',
      light: '#FFFFFF',
    },
  };
  const qrDataUrl = await QRCode.toDataURL(qrToken, qrOptions);
  const qrBuffer = await QRCode.toBuffer(qrToken, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 440,
    color: {
      dark: '#09090B',
      light: '#FFFFFF',
    },
  });
  return { qrDataUrl, qrBuffer };
}

function cleanEnvSecret(value: string | undefined): string {
  if (!value) return '';
  return value.trim().replace(/^["']|["']$/g, '').trim();
}

async function sendTicketEmail(
  ticket: TicketRow,
  qrToken: string,
  qrBuffer: Buffer,
  passUrl: string,
): Promise<{ emailStatus: 'sent' | 'pending_retry'; emailError: string | null }> {
  const apiKey = cleanEnvSecret(process.env.RESEND_API_KEY);
  if (!apiKey) {
    console.warn(`[MAIL_DELIVERY] Email queued as pending_retry for ${ticket.id}: RESEND_API_KEY not configured.`);
    return {
      emailStatus: 'pending_retry',
      emailError: 'Falta configurar la clave de envío de correo en los Secrets del proyecto.',
    };
  }

  const configuredFrom = cleanEnvSecret(process.env.RESEND_FROM_EMAIL);
  const fromAddress = configuredFrom || 'MOSLY <entradas@moslyproductions.com>';
  const resend = new Resend(apiKey);
  const safeName = escapeHtml(ticket.buyer_name);
  const safeZone = escapeHtml(ZONE_LABELS[ticket.zone]);
  const safeOrderId = escapeHtml(ticket.id);
  const safeMethod = escapeHtml(PAYMENT_METHOD_LABELS[ticket.payment_method] || ticket.payment_method);
  const safePassUrl = escapeHtml(passUrl);
  const peopleLabel = ticket.people_count === 1 ? '1 persona' : `${ticket.people_count} personas`;

  const html = `
    <!doctype html>
    <html lang="es">
      <body style="margin:0;padding:0;background-color:#09090B;color:#FAFAFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#09090B;padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;background-color:#111114;border:1px solid #27272A;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:28px 32px;border-bottom:1px solid #27272A;">
                    <div style="font-size:15px;letter-spacing:0.24em;color:#F59E0B;font-weight:700;">MOSLY</div>
                    <h1 style="margin:10px 0 6px;font-size:24px;line-height:1.25;color:#FAFAFA;">Tu acceso está confirmado</h1>
                    <p style="margin:0;font-size:14px;line-height:1.5;color:#A1A1AA;">
                      Hola ${safeName}, hemos validado tu comprobante de pago. Presenta este código QR en la puerta para ingresar al evento.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:32px;background-color:#141418;">
                    <div style="display:inline-block;padding:16px;background-color:#FFFFFF;border-radius:12px;">
                      <img src="cid:mosly-qr" alt="Pase QR MOSLY ${safeOrderId}" width="220" height="220" style="display:block;border:0;" />
                    </div>
                    <div style="margin-top:18px;">
                      <a href="${safePassUrl}" style="display:inline-block;padding:10px 20px;background-color:#F59E0B;color:#09090B;text-decoration:none;border-radius:8px;font-size:13px;font-weight:700;">
                        Abrir pase digital
                      </a>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 32px;border-top:1px solid #27272A;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;color:#D4D4D8;">
                      <tr>
                        <td style="padding:6px 0;color:#71717A;">Orden</td>
                        <td align="right" style="padding:6px 0;font-family:'Courier New',monospace;color:#FAFAFA;">${safeOrderId}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#71717A;">Zona</td>
                        <td align="right" style="padding:6px 0;color:#FAFAFA;font-weight:600;">${safeZone}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#71717A;">Capacidad</td>
                        <td align="right" style="padding:6px 0;color:#FAFAFA;">${peopleLabel}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#71717A;">Pago verificado</td>
                        <td align="right" style="padding:6px 0;color:#FAFAFA;">$${ticket.amount} USD · ${safeMethod}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 32px;background-color:#09090B;border-top:1px solid #27272A;font-size:12px;color:#71717A;line-height:1.5;">
                    Este pase QR es personal, intransferible y de un solo uso. Al validarse en puerta quedará registrado como utilizado.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  try {
    const result = await resend.emails.send({
      from: fromAddress,
      to: ticket.buyer_email,
      subject: `Tu entrada ${ZONE_LABELS[ticket.zone]} · MOSLY (${ticket.id})`,
      headers: {
        'X-Entity-Ref-ID': ticket.id,
      },
      html,
      text: `Hola ${ticket.buyer_name}, tu acceso para MOSLY (${ZONE_LABELS[ticket.zone]} · ${peopleLabel}) está confirmado. Orden: ${ticket.id}. Abre tu pase digital aquí: ${passUrl}`,
      attachments: [
        {
          filename: `entrada-mosly-${ticket.id}.png`,
          content: qrBuffer.toString('base64'),
          contentType: 'image/png',
          contentId: 'mosly-qr',
        },
      ],
    });

    if (result.error) {
      console.error(`[MAIL_DELIVERY] Failed sending to ${ticket.buyer_email} (${ticket.id}) from=${fromAddress}:`, result.error.message);
      return {
        emailStatus: 'pending_retry',
        emailError: `Remitente (${fromAddress}): ${result.error.message}`,
      };
    }

    console.info(`[MAIL_DELIVERY] Sent to ${ticket.buyer_email} (${ticket.id}) messageId=${result.data?.id || 'ok'}`);
    return { emailStatus: 'sent', emailError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error de conexión al enviar correo.';
    console.error(`[MAIL_DELIVERY] Exception sending to ${ticket.buyer_email} (${ticket.id}) from=${fromAddress}:`, message);
    return {
      emailStatus: 'pending_retry',
      emailError: `Remitente (${fromAddress}): ${message}`,
    };
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      xFrameOptions: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '8mb' }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de acceso. Espera unos minutos antes de reintentar.' },
  });

  const orderLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Has enviado varias solicitudes recientes. Intenta nuevamente en unos minutos.' },
  });

  const scannerLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      valid: false,
      reason: 'invalid_input',
      message: 'Límite temporal de lecturas alcanzado. Espera un momento.',
    },
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Authentication endpoints (HTTP-Only Partitioned Cookie + Signed Token fallback)
  app.get('/api/auth/session', (req, res) => {
    const authenticated = verifySessionToken(extractSessionToken(req));
    res.json({ authenticated });
  });

  app.post('/api/auth/login', loginLimiter, (req, res) => {
    const adminPassword = getAdminPassword();
    if (!adminPassword) {
      console.error('[AUTH] Login attempted while ADMIN_PASSWORD is not configured.');
      res.status(503).json({
        error: 'El acceso administrativo no está habilitado en este entorno.',
      });
      return;
    }

    const { password } = req.body as { password?: unknown };
    const provided = typeof password === 'string' ? password : '';

    if (!provided || !timingSafeEqualStrings(provided, adminPassword)) {
      res.status(401).json({ error: 'Contraseña incorrecta.' });
      return;
    }

    const token = createSessionToken();
    setSessionCookie(req, res, token);
    res.json({ authenticated: true, token });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // Public Ticket Purchase Endpoint
  app.post('/api/orders', orderLimiter, (req, res) => {
    const {
      buyerName,
      buyerEmail,
      zone,
      currency,
      paymentMethod,
      receiptDataUrl,
    } = req.body as {
      buyerName?: unknown;
      buyerEmail?: unknown;
      zone?: unknown;
      currency?: unknown;
      paymentMethod?: unknown;
      receiptDataUrl?: unknown;
    };

    const cleanName = sanitizeText(buyerName, 120);
    const cleanEmail = sanitizeText(buyerEmail, 180).toLowerCase();
    const cleanZone: TicketZone | null =
      zone === 'general' ||
      zone === 'vip' ||
      zone === 'box_individual' ||
      zone === 'mesa_box_6'
        ? zone
        : null;
    const cleanCurrency: PaymentCurrency | null =
      currency === 'USD' || currency === 'BS' ? currency : null;
    const cleanMethod = typeof paymentMethod === 'string' ? (paymentMethod as PaymentMethod) : null;
    const rawReceipt = typeof receiptDataUrl === 'string' ? receiptDataUrl.trim() : '';

    if (cleanName.length < 2) {
      res.status(400).json({ error: 'Ingresa tu nombre completo.' });
      return;
    }

    const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
    if (!emailRegex.test(cleanEmail)) {
      res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
      return;
    }

    if (!cleanZone) {
      res.status(400).json({ error: 'Selecciona una zona válida.' });
      return;
    }

    if (!cleanCurrency) {
      res.status(400).json({ error: 'Selecciona una moneda de pago válida.' });
      return;
    }

    if (!cleanMethod || !VALID_METHODS_BY_CURRENCY[cleanCurrency].includes(cleanMethod)) {
      res.status(400).json({ error: 'Método de pago inválido para la moneda elegida.' });
      return;
    }

    const decodedImage = validateAndDecodeImage(rawReceipt);
    if (!decodedImage) {
      res.status(400).json({
        error: 'El comprobante debe ser una imagen válida (JPG, PNG o WEBP) de máximo 5 MB.',
      });
      return;
    }

    const uuidFilename = `${crypto.randomUUID()}.${decodedImage.ext}`;
    const targetFile = path.join(RECEIPTS_DIR, uuidFilename);
    fs.writeFileSync(targetFile, decodedImage.buffer);

    let orderId = generateOrderId();
    const existsStmt = db.prepare('SELECT 1 FROM tickets WHERE id = ?');
    while (existsStmt.get(orderId)) {
      orderId = generateOrderId();
    }

    const amount = ZONE_PRICES[cleanZone];
    const peopleCount = ZONE_PEOPLE_COUNT[cleanZone];
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO tickets (
        id, buyer_name, buyer_email, zone, people_count, amount, currency, payment_method,
        receipt_data_url, receipt_filename, status,
        email_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, 'pending', 'not_sent', ?)
    `).run(
      orderId,
      cleanName,
      cleanEmail,
      cleanZone,
      peopleCount,
      amount,
      cleanCurrency,
      cleanMethod,
      uuidFilename,
      createdAt,
    );

    res.status(201).json({
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
    });
  });

  // Public Digital Pass lookup (requires valid HMAC-SHA256 signed token)
  app.get('/api/pass', (req, res) => {
    const rawToken = typeof req.query.t === 'string' ? req.query.t.trim() : '';
    const verified = verifyQrPayload(rawToken);
    if (!verified) {
      res.status(403).json({ error: 'Pase digital no válido.' });
      return;
    }

    const ticket = db
      .prepare('SELECT * FROM tickets WHERE id = ?')
      .get(verified.tid) as TicketRow | undefined;

    if (
      !ticket ||
      ticket.qr_token !== rawToken ||
      ticket.qr_nonce !== verified.n ||
      (ticket.status !== 'approved' && ticket.status !== 'used')
    ) {
      res.status(404).json({ error: 'Este pase no se encuentra activo.' });
      return;
    }

    res.json({
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
  });

  // Protected Admin Routes
  app.get('/api/admin/orders', requireAuth, (_req, res) => {
    const rows = db
      .prepare('SELECT * FROM tickets ORDER BY created_at DESC')
      .all() as TicketRow[];
    res.json({
      orders: rows.map(serializeAdminOrder),
    });
  });

  app.get('/api/admin/orders/:id/receipt', requireAuth, (req, res) => {
    const { id } = req.params;
    const row = db
      .prepare('SELECT receipt_filename, receipt_data_url FROM tickets WHERE id = ?')
      .get(id) as { receipt_filename: string | null; receipt_data_url: string } | undefined;

    if (!row) {
      res.status(404).json({ error: 'Comprobante no encontrado.' });
      return;
    }

    if (row.receipt_filename) {
      const safeName = path.basename(row.receipt_filename);
      const filePath = path.join(RECEIPTS_DIR, safeName);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(safeName).toLowerCase();
        const mime =
          ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        res.setHeader('Content-Type', mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.sendFile(filePath);
        return;
      }
    }

    // Legacy fallback if an older record stored inline base64 before file storage
    if (row.receipt_data_url) {
      const parsed = validateAndDecodeImage(row.receipt_data_url);
      if (parsed) {
        res.setHeader('Content-Type', parsed.mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(parsed.buffer);
        return;
      }
    }

    res.status(404).json({ error: 'Archivo de comprobante no disponible.' });
  });

  app.post('/api/admin/orders/:id/approve', requireAuth, async (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Solicitud no encontrada.' });
      return;
    }

    if (existing.status === 'used') {
      res.status(409).json({ error: 'Esta entrada ya fue escaneada en puerta.' });
      return;
    }

    if (existing.status === 'rejected') {
      res.status(409).json({ error: 'Esta solicitud fue rechazada previamente.' });
      return;
    }

    const nonceHash = existing.qr_nonce || crypto.randomBytes(8).toString('hex');
    const qrToken = existing.qr_token || signQrPayload(existing.id, existing.zone, nonceHash);
    const { qrDataUrl, qrBuffer } = await buildQrAssets(qrToken);
    const approvedAt = existing.approved_at || new Date().toISOString();

    db.prepare(`
      UPDATE tickets
      SET status = 'approved',
          qr_nonce = ?,
          qr_token = ?,
          qr_data_url = ?,
          approved_at = ?
      WHERE id = ?
    `).run(nonceHash, qrToken, qrDataUrl, approvedAt, id);

    const originHeader = `${req.protocol}://${req.get('host')}`;
    const rawAppUrl = cleanEnvSecret(process.env.APP_URL);
    const baseUrl = rawAppUrl && /^https?:\/\//i.test(rawAppUrl) ? rawAppUrl : originHeader;
    const passUrl = `${baseUrl.replace(/\/$/, '')}/#pase?t=${encodeURIComponent(qrToken)}`;

    const { emailStatus, emailError } = await sendTicketEmail(existing, qrToken, qrBuffer, passUrl);

    db.prepare(`
      UPDATE tickets
      SET email_status = ?,
          email_error = ?
      WHERE id = ?
    `).run(emailStatus, emailError, id);

    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow;
    res.json({ order: serializeAdminOrder(updated) });
  });

  app.post('/api/admin/orders/:id/reject', requireAuth, (req, res) => {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Solicitud no encontrada.' });
      return;
    }

    if (existing.status === 'used') {
      res.status(409).json({ error: 'No se puede rechazar una entrada que ya fue utilizada.' });
      return;
    }

    db.prepare(`
      UPDATE tickets
      SET status = 'rejected'
      WHERE id = ?
    `).run(id);

    const updated = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow;
    res.json({ order: serializeAdminOrder(updated) });
  });

  // Protected Door QR Scanner Validation (Cryptographic HMAC-SHA256 + Atomic Idempotency)
  const validateTicketTransaction = db.transaction((rawToken: string) => {
    const signedPayload = verifyQrPayload(rawToken);
    if (!signedPayload) {
      return {
        httpStatus: 403,
        body: {
          valid: false,
          reason: 'invalid_signature' as const,
          message: 'Código QR no válido o firma criptográfica alterada.',
        },
      };
    }

    const ticket = db
      .prepare('SELECT * FROM tickets WHERE id = ?')
      .get(signedPayload.tid) as TicketRow | undefined;

    if (
      !ticket ||
      ticket.qr_token !== rawToken ||
      ticket.qr_nonce !== signedPayload.n ||
      ticket.zone !== signedPayload.z
    ) {
      return {
        httpStatus: 404,
        body: {
          valid: false,
          reason: 'not_found' as const,
          message: 'Pase no registrado o revocado en el sistema.',
        },
      };
    }

    if (ticket.status === 'pending' || ticket.status === 'rejected') {
      return {
        httpStatus: 400,
        body: {
          valid: false,
          reason: 'not_approved' as const,
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
      };
    }

    if (ticket.status === 'used') {
      return {
        httpStatus: 409,
        body: {
          valid: false,
          reason: 'already_used' as const,
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
      };
    }

    const usedAt = new Date().toISOString();
    const updateInfo = db
      .prepare(`UPDATE tickets SET status = 'used', used_at = ? WHERE id = ? AND status = 'approved'`)
      .run(usedAt, ticket.id);

    if (updateInfo.changes !== 1) {
      return {
        httpStatus: 409,
        body: {
          valid: false,
          reason: 'already_used' as const,
          message: 'Entrada utilizada simultáneamente. Acceso bloqueado.',
        },
      };
    }

    return {
      httpStatus: 200,
      body: {
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
          status: 'used' as const,
          approved_at: ticket.approved_at,
          used_at: usedAt,
        },
      },
    };
  });

  app.post('/api/scanner/validate', requireAuth, scannerLimiter, (req, res) => {
    const { token } = req.body as { token?: unknown };
    let normalized = typeof token === 'string' ? token.trim() : '';

    // Support scanning full digital pass URLs (e.g. https://.../#pase?t=MSL1...)
    if (normalized.includes('t=MSL1.')) {
      try {
        const idx = normalized.indexOf('t=MSL1.');
        const extracted = normalized.slice(idx + 2).split('&')[0];
        normalized = decodeURIComponent(extracted);
      } catch {
        // Leave normalized as-is
      }
    }

    if (!normalized || normalized.length < 16 || normalized.length > 600) {
      res.status(400).json({
        valid: false,
        reason: 'invalid_input',
        message: 'El código escaneado no corresponde a un pase oficial.',
      });
      return;
    }

    const outcome = validateTicketTransaction(normalized);
    res.status(outcome.httpStatus).json(outcome.body);
  });

  app.get('/api/scanner/recent', requireAuth, (_req, res) => {
    const counts = db
      .prepare(`
        SELECT
          SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS usedCount,
          SUM(CASE WHEN status IN ('approved', 'used') THEN 1 ELSE 0 END) AS approvedTotalCount,
          SUM(CASE WHEN status = 'used' THEN people_count ELSE 0 END) AS peopleEnteredCount,
          SUM(CASE WHEN status = 'used' AND zone = 'vip' THEN 1 ELSE 0 END) AS vipUsedCount,
          SUM(CASE WHEN status = 'used' AND zone = 'general' THEN 1 ELSE 0 END) AS generalUsedCount,
          SUM(CASE WHEN status = 'used' AND zone = 'box_individual' THEN 1 ELSE 0 END) AS boxIndividualUsedCount,
          SUM(CASE WHEN status = 'used' AND zone = 'mesa_box_6' THEN 1 ELSE 0 END) AS mesaBoxUsedCount
        FROM tickets
      `)
      .get() as {
      usedCount: number | null;
      approvedTotalCount: number | null;
      peopleEnteredCount: number | null;
      vipUsedCount: number | null;
      generalUsedCount: number | null;
      boxIndividualUsedCount: number | null;
      mesaBoxUsedCount: number | null;
    };

    const recent = db
      .prepare(`
        SELECT id, buyer_name, zone, people_count, used_at
        FROM tickets
        WHERE status = 'used' AND used_at IS NOT NULL
        ORDER BY used_at DESC
        LIMIT 12
      `)
      .all() as Array<{
      id: string;
      buyer_name: string;
      zone: TicketZone;
      people_count: number;
      used_at: string;
    }>;

    res.json({
      stats: {
        usedCount: counts.usedCount || 0,
        approvedTotalCount: counts.approvedTotalCount || 0,
        peopleEnteredCount: counts.peopleEnteredCount || 0,
        vipUsedCount: counts.vipUsedCount || 0,
        generalUsedCount: counts.generalUsedCount || 0,
        boxIndividualUsedCount: counts.boxIndividualUsedCount || 0,
        mesaBoxUsedCount: counts.mesaBoxUsedCount || 0,
      },
      recent,
    });
  });

  // Ensure unknown /api/* routes always return JSON instead of HTML/empty fallback
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Endpoint de API no encontrado.' });
  });

  // Global Express error handler returning structured JSON on /api/*
  app.use((err: Error & { status?: number; type?: string }, req: Request, res: Response, _next: NextFunction) => {
    console.error('[SERVER_ERROR]', err.message);
    if (req.path.startsWith('/api/')) {
      const statusCode = err.status || (err.type === 'entity.too.large' ? 413 : 500);
      res.status(statusCode).json({
        error:
          err.type === 'entity.too.large'
            ? 'El archivo enviado supera el tamaño permitido.'
            : 'Error interno al procesar la solicitud.',
      });
      return;
    }
    res.status(500).send('Error interno del servidor.');
  });

  // Vite dev middleware vs static production serving
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MOSLY server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
