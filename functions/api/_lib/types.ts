export type TicketZone = 'general' | 'vip' | 'box_individual' | 'mesa_box_6';
export type PaymentCurrency = 'USD' | 'BS';
export type PaymentMethod =
  | 'transferencia_bs'
  | 'pago_movil'
  | 'transferencia_usd'
  | 'zelle'
  | 'binance';

export type TicketStatus = 'pending' | 'approved' | 'rejected' | 'used';
export type EmailStatus = 'not_sent' | 'sent' | 'pending_retry';

export interface TicketRow {
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
  status: TicketStatus;
  qr_nonce: string | null;
  qr_token: string | null;
  qr_data_url: string | null;
  email_status: EmailStatus;
  email_error: string | null;
  created_at: string;
  approved_at: string | null;
  used_at: string | null;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<{
    success: boolean;
    meta: { changes: number; duration?: number; last_row_id?: number };
    results?: T[];
  }>;
  all<T = Record<string, unknown>>(): Promise<{
    success: boolean;
    results: T[];
  }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
  exec(query: string): Promise<unknown>;
}

export interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: {
    contentType?: string;
  };
}

export interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
}

export interface CloudflareEnv {
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
  DB?: D1Database;
  RECEIPTS_BUCKET?: R2Bucket;
  ADMIN_PASSWORD?: string;
  QR_SECRET_KEY?: string;
  JWT_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  APP_URL?: string;
}

export interface EventContext<
  Env = CloudflareEnv,
  Params extends Record<string, string> = Record<string, string>,
> {
  request: Request;
  env: Env;
  params: Params;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
}

export type PagesFunction<
  Env = CloudflareEnv,
  Params extends Record<string, string> = Record<string, string>,
> = (context: EventContext<Env, Params>) => Response | Promise<Response>;

export const ZONE_PRICES: Record<TicketZone, number> = {
  general: 20,
  vip: 30,
  box_individual: 60,
  mesa_box_6: 450,
};

export const ZONE_PEOPLE_COUNT: Record<TicketZone, number> = {
  general: 1,
  vip: 1,
  box_individual: 1,
  mesa_box_6: 6,
};

export const ZONE_LABELS: Record<TicketZone, string> = {
  general: 'General — Pista Principal',
  vip: 'VIP — Zona Preferencial',
  box_individual: 'Box Individual — Sector Box',
  mesa_box_6: 'Mesa Box — 6 Personas',
};

export const VALID_METHODS_BY_CURRENCY: Record<PaymentCurrency, PaymentMethod[]> = {
  BS: ['transferencia_bs', 'pago_movil'],
  USD: ['transferencia_usd', 'zelle', 'binance'],
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transferencia_bs: 'Transferencia Bancaria (Bs)',
  pago_movil: 'Pago Móvil (Bs)',
  transferencia_usd: 'Transferencia Bancaria (USD)',
  zelle: 'Zelle (USD)',
  binance: 'Binance Pay (USD)',
};
