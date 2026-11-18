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

export const EVENT_LOGO_URL =
  '/assets/aistudio/WhatsApp_Image_2026-11-17_at_11.11.07_PM_8f6673e0.jpeg';

export interface TicketRecord {
  id: string;
  buyer_name: string;
  buyer_email: string;
  zone: TicketZone;
  people_count: number;
  amount: number;
  currency: PaymentCurrency;
  payment_method: PaymentMethod;
  receipt_filename: string | null;
  status: TicketStatus;
  qr_token: string | null;
  qr_data_url: string | null;
  email_status: EmailStatus;
  email_error?: string | null;
  created_at: string;
  approved_at: string | null;
  used_at: string | null;
}

export interface OrderCreateResponse {
  id: string;
  buyer_name: string;
  buyer_email: string;
  zone: TicketZone;
  people_count: number;
  amount: number;
  currency: PaymentCurrency;
  payment_method: PaymentMethod;
  status: TicketStatus;
  created_at: string;
}

export interface DigitalPassData {
  id: string;
  buyer_name: string;
  zone: TicketZone;
  people_count: number;
  status: 'approved' | 'used';
  qr_token: string;
  qr_data_url: string;
  approved_at: string | null;
  used_at: string | null;
}

export interface ScannerValidationResponse {
  valid: boolean;
  reason?: 'not_found' | 'invalid_signature' | 'not_approved' | 'already_used' | 'invalid_input';
  message: string;
  ticket?: {
    id: string;
    buyer_name: string;
    zone: TicketZone;
    people_count: number;
    amount: number;
    currency: PaymentCurrency;
    payment_method: PaymentMethod;
    status: TicketStatus;
    approved_at: string | null;
    used_at: string | null;
  };
}

export interface ScannerRecentResponse {
  stats: {
    usedCount: number;
    approvedTotalCount: number;
    peopleEnteredCount: number;
    vipUsedCount: number;
    generalUsedCount: number;
    boxIndividualUsedCount: number;
    mesaBoxUsedCount: number;
  };
  recent: Array<{
    id: string;
    buyer_name: string;
    zone: TicketZone;
    people_count: number;
    used_at: string;
  }>;
}

export const ZONE_PRICING: Record<
  TicketZone,
  {
    label: string;
    shortLabel: string;
    subtitle: string;
    price: number;
    peopleCount: number;
    capacityNote: string;
    perks: string[];
  }
> = {
  general: {
    label: 'General',
    shortLabel: 'General',
    subtitle: 'Acceso completo a Pista Principal',
    price: 20,
    peopleCount: 1,
    capacityNote: '1 persona',
    perks: [
      'Acceso a pista principal y barras generales',
      'Ingreso válido durante toda la noche',
    ],
  },
  vip: {
    label: 'VIP',
    shortLabel: 'VIP',
    subtitle: 'Zona VIP con vista elevada y barra preferencial',
    price: 30,
    peopleCount: 1,
    capacityNote: '1 persona',
    perks: [
      'Ingreso prioritario sin fila en puerta',
      'Acceso a sector VIP con barra y baños dedicados',
    ],
  },
  box_individual: {
    label: 'Box Individual',
    shortLabel: 'Box Individual',
    subtitle: 'Acceso individual a sector privado Box',
    price: 60,
    peopleCount: 1,
    capacityNote: '1 persona',
    perks: [
      'Brazalete de ingreso directo al área Box',
      'Servicio de atención en barra privada',
    ],
  },
  mesa_box_6: {
    label: 'Mesa Box (6 personas)',
    shortLabel: 'Mesa Box x6',
    subtitle: 'Mesa privada reservada para grupo de 6',
    price: 450,
    peopleCount: 6,
    capacityNote: '6 personas',
    perks: [
      'Mesa reservada en primera línea para 6 asistentes',
      'Ingreso grupal preferencial y atención dedicada',
    ],
  },
};

export interface PaymentMethodDetail {
  id: PaymentMethod;
  label: string;
  shortLabel: string;
  fields: Array<{
    label: string;
    value: string;
    copyable?: boolean;
  }>;
}

export const PAYMENT_METHODS_BY_CURRENCY: Record<PaymentCurrency, PaymentMethodDetail[]> = {
  BS: [
    {
      id: 'transferencia_bs',
      label: 'Transferencia Bancaria (Bs)',
      shortLabel: 'Transferencia',
      fields: [
        { label: 'Banco', value: 'Banco Mercantil (0105)' },
        { label: 'Cuenta Corriente', value: '0105-0021-48-1029384756', copyable: true },
        { label: 'Titular', value: 'MOSLY Eventos C.A.' },
        { label: 'RIF', value: 'J-50481920-3', copyable: true },
      ],
    },
    {
      id: 'pago_movil',
      label: 'Pago Móvil (Bs)',
      shortLabel: 'Pago Móvil',
      fields: [
        { label: 'Banco', value: 'Banesco (0134)' },
        { label: 'Teléfono', value: '0412-555-0192', copyable: true },
        { label: 'RIF / Cédula', value: 'J-50481920-3', copyable: true },
        { label: 'Concepto', value: 'Entrada MOSLY' },
      ],
    },
  ],
  USD: [
    {
      id: 'transferencia_usd',
      label: 'Transferencia Bancaria (USD)',
      shortLabel: 'Transferencia',
      fields: [
        { label: 'Banco', value: 'Mercury Bank (USA)' },
        { label: 'Cuenta / Account', value: '8849201938', copyable: true },
        { label: 'Routing (ABA)', value: '021000021', copyable: true },
        { label: 'Beneficiario', value: 'MOSLY Entertainment LLC' },
      ],
    },
    {
      id: 'zelle',
      label: 'Zelle (USD)',
      shortLabel: 'Zelle',
      fields: [
        { label: 'Correo Zelle', value: 'pagos@moslyclub.com', copyable: true },
        { label: 'Titular', value: 'MOSLY Entertainment LLC' },
        { label: 'Nota', value: 'Indicar nombre del asistente' },
      ],
    },
    {
      id: 'binance',
      label: 'Binance Pay (USDT)',
      shortLabel: 'Binance',
      fields: [
        { label: 'Binance Pay ID', value: '482910475', copyable: true },
        { label: 'Correo Binance', value: 'crypto@moslyclub.com', copyable: true },
        { label: 'Moneda / Red', value: 'USDT · Binance Pay o TRC20' },
      ],
    },
  ],
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transferencia_bs: 'Transferencia (Bs)',
  pago_movil: 'Pago Móvil (Bs)',
  transferencia_usd: 'Transferencia (USD)',
  zelle: 'Zelle (USD)',
  binance: 'Binance (USD)',
};
