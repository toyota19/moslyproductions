import { CloudflareEnv, D1Database } from './types';

let schemaInitialized = false;

export async function getDatabase(env: CloudflareEnv): Promise<D1Database | null> {
  if (!env.DB) return null;
  if (!schemaInitialized) {
    await ensureD1Schema(env.DB);
    schemaInitialized = true;
  }
  return env.DB;
}

export async function ensureD1Schema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS tickets (
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
      )`,
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      )`,
    )
    .run();

  await db.prepare('CREATE INDEX IF NOT EXISTS idx_tickets_qr_token ON tickets(qr_token)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)').run();
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC)')
    .run();
}

export async function checkRateLimit(
  db: D1Database,
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const now = Date.now();
  const row = await db
    .prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?')
    .bind(key)
    .first<{ count: number; reset_at: number }>();

  if (!row || row.reset_at <= now) {
    const nextReset = now + windowMs;
    await db
      .prepare(
        `INSERT INTO rate_limits (key, count, reset_at)
         VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at`,
      )
      .bind(key, nextReset)
      .run();

    // Opportunistic cleanup of expired buckets
    if (Math.random() < 0.05) {
      await db.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').bind(now).run();
    }

    return { allowed: true, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  if (row.count >= maxRequests) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((row.reset_at - now) / 1000)),
    };
  }

  await db
    .prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?')
    .bind(key)
    .run();

  return {
    allowed: true,
    retryAfterSec: Math.max(1, Math.ceil((row.reset_at - now) / 1000)),
  };
}
