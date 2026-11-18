CREATE TABLE IF NOT EXISTS tickets (
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

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_qr_token ON tickets(qr_token);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);
