import React, { useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  ImagePlus,
  Loader2,
  Mail,
  Music2,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import {
  EVENT_LOGO_URL,
  OrderCreateResponse,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS_BY_CURRENCY,
  PaymentCurrency,
  PaymentMethod,
  TicketZone,
  ZONE_PRICING,
} from '../types';

const HERO_IMAGE = '/src/assets/images/hero_club_atmosphere_1794972877352.jpg';
const ZONE_IMAGES: Record<TicketZone, string> = {
  general: '/src/assets/images/zone_general_floor_1794972877912.jpg',
  vip: '/src/assets/images/zone_vip_lounge_1794972878404.jpg',
  box_individual: '/src/assets/images/zone_vip_lounge_1794972878404.jpg',
  mesa_box_6: '/src/assets/images/hero_club_atmosphere_1794972877352.jpg',
};

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

interface PurchaseViewProps {
  selectedZone: TicketZone;
  onSelectZone: (zone: TicketZone) => void;
  formSectionRef: React.RefObject<HTMLDivElement | null>;
}

async function prepareReceiptImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) {
        reject(new Error('El archivo está vacío.'));
        return;
      }

      const img = new Image();
      img.onerror = () => reject(new Error('La imagen seleccionada no es válida.'));
      img.onload = () => {
        // Keep original format when <= 1600px and <= 3.5MB, otherwise downscale cleanly as JPEG
        const maxDim = 1600;
        const needsResize = img.width > maxDim || img.height > maxDim || file.size > 3_500_000;
        if (!needsResize) {
          resolve(dataUrl);
          return;
        }

        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export const PurchaseView: React.FC<PurchaseViewProps> = ({
  selectedZone,
  onSelectZone,
  formSectionRef,
}) => {
  const [currency, setCurrency] = useState<PaymentCurrency>('USD');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('zelle');
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [receiptDataUrl, setReceiptDataUrl] = useState<string | null>(null);
  const [receiptFilename, setReceiptFilename] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<OrderCreateResponse | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [logoImgFailed, setLogoImgFailed] = useState(false);
  const [zoneImgFailed, setZoneImgFailed] = useState<Record<TicketZone, boolean>>({
    general: false,
    vip: false,
    box_individual: false,
    mesa_box_6: false,
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeZoneMeta = ZONE_PRICING[selectedZone];
  const availableMethods = PAYMENT_METHODS_BY_CURRENCY[currency];
  const activeMethodDetail =
    availableMethods.find((m) => m.id === paymentMethod) ?? availableMethods[0];

  const handleCurrencyChange = (nextCurrency: PaymentCurrency) => {
    setCurrency(nextCurrency);
    const firstMethod = PAYMENT_METHODS_BY_CURRENCY[nextCurrency][0].id;
    setPaymentMethod(firstMethod);
    setConfirmedOrder(null);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setErrorMsg(null);

    if (!ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
      setErrorMsg('Solo se permiten imágenes en formato JPG, PNG o WEBP.');
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setErrorMsg('El comprobante supera el límite máximo de 5 MB.');
      return;
    }

    try {
      setIsProcessingImage(true);
      const processed = await prepareReceiptImage(file);
      setReceiptDataUrl(processed);
      setReceiptFilename(file.name);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo procesar la imagen.');
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleCopyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      window.setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Clipboard blocked in restricted browser contexts
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (buyerName.trim().length < 2) {
      setErrorMsg('Ingresa tu nombre completo.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail.trim())) {
      setErrorMsg('Ingresa un correo electrónico válido.');
      return;
    }

    if (!receiptDataUrl) {
      setErrorMsg('Adjunta la imagen de tu comprobante de pago.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerName: buyerName.trim(),
          buyerEmail: buyerEmail.trim(),
          zone: selectedZone,
          currency,
          paymentMethod: activeMethodDetail.id,
          receiptDataUrl,
        }),
      });

      const payload = (await response.json()) as OrderCreateResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'No se pudo completar tu solicitud. Intenta nuevamente.');
      }

      setConfirmedOrder(payload);
      setBuyerName('');
      setBuyerEmail('');
      setReceiptDataUrl(null);
      setReceiptFilename('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'No pudimos conectar en este momento. Intenta nuevamente.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="pb-20">
      {/* Hero Banner */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="relative h-[330px] sm:h-[390px] w-full bg-[#111114]">
          {!heroImgFailed ? (
            <img
              src={HERO_IMAGE}
              alt="MOSLY — Experiencia Nocturna"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgFailed(true)}
              className="h-full w-full object-cover object-center opacity-70"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 via-[#141418] to-[#09090B]">
              <Music2 className="h-12 w-12 text-amber-500/40" />
            </div>
          )}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-[#09090B] via-[#09090B]/65 to-[#09090B]/30"
          />
          <div className="absolute inset-0 flex items-end">
            <div className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
              <div className="mb-4">
                {!logoImgFailed ? (
                  <img
                    src={EVENT_LOGO_URL}
                    alt="MOSLY"
                    onError={() => setLogoImgFailed(true)}
                    className="h-10 sm:h-12 w-auto object-contain mix-blend-screen"
                  />
                ) : (
                  <span className="font-display text-3xl font-bold tracking-[0.2em] text-zinc-50">
                    MOSLY
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-zinc-300 tracking-wide">
                <span>Sábado 21 Noviembre</span>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <span>23:00 — 06:00</span>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <span>Taquilla Oficial</span>
              </div>
              <h1 className="mt-2.5 max-w-3xl font-display text-2xl sm:text-4xl font-bold tracking-tight text-zinc-50 [text-wrap:balance]">
                Reserva tu entrada y asegura tu ingreso
              </h1>
              <p className="mt-2.5 max-w-2xl text-sm sm:text-base text-zinc-300 leading-relaxed">
                Selecciona tu sector, realiza el pago en Bolívares o Dólares y sube el comprobante para recibir tu pase digital en tu correo.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Main 2-Column Purchase Workspace */}
      <section ref={formSectionRef} className="mx-auto mt-10 max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
          {/* Left Column: 4 Zones + Payment Methods */}
          <div id="zonas" className="lg:col-span-7 flex flex-col gap-6 scroll-mt-24">
            <div>
              <h2 className="font-display text-xl sm:text-2xl font-semibold text-zinc-50">
                1. Elige tu zona
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                Cada entrada cuenta con código QR personal válido para un único ingreso.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(['general', 'vip', 'box_individual', 'mesa_box_6'] as TicketZone[]).map((zoneKey) => {
                const info = ZONE_PRICING[zoneKey];
                const isSelected = selectedZone === zoneKey;
                return (
                  <button
                    key={zoneKey}
                    type="button"
                    onClick={() => {
                      onSelectZone(zoneKey);
                      setConfirmedOrder(null);
                    }}
                    className={`group flex flex-col justify-between text-left rounded-xl border transition-all duration-150 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                      isSelected
                        ? 'border-amber-500 bg-[#141418]'
                        : 'border-white/10 bg-[#111114] hover:border-white/25 hover:-translate-y-0.5'
                    }`}
                  >
                    <div>
                      <div className="relative aspect-[16/9] w-full overflow-hidden bg-zinc-900">
                        {!zoneImgFailed[zoneKey] ? (
                          <img
                            src={ZONE_IMAGES[zoneKey]}
                            alt={info.label}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setZoneImgFailed((prev) => ({ ...prev, [zoneKey]: true }))
                            }
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-600">
                            <Music2 className="h-8 w-8" />
                          </div>
                        )}
                        <div
                          aria-hidden="true"
                          className="absolute inset-0 bg-gradient-to-t from-[#111114] via-transparent to-transparent"
                        />
                      </div>

                      <div className="p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
                              <Users className="h-3 w-3 text-amber-500/80" />
                              <span>{info.capacityNote}</span>
                            </div>
                            <h3 className="mt-0.5 font-display text-base sm:text-lg font-semibold text-zinc-50">
                              {info.label}
                            </h3>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-mono text-xl font-semibold tabular-nums text-amber-400">
                              ${info.price}
                            </span>
                            <span className="block text-[10px] text-zinc-500">USD</span>
                          </div>
                        </div>

                        <p className="mt-1.5 text-xs text-zinc-400">{info.subtitle}</p>

                        <ul className="mt-3 space-y-1.5 border-t border-white/10 pt-3 text-xs text-zinc-300">
                          {info.perks.map((perk) => (
                            <li key={perk} className="flex items-start gap-2">
                              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                              <span>{perk}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                      <div className="flex items-center justify-between border-t border-white/10 pt-3 text-xs font-medium">
                        <span className={isSelected ? 'text-amber-400' : 'text-zinc-400'}>
                          {isSelected ? 'Zona seleccionada' : 'Seleccionar'}
                        </span>
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                            isSelected
                              ? 'border-amber-500 bg-amber-500 text-zinc-950'
                              : 'border-white/20 text-transparent'
                          }`}
                        >
                          <Check className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Currency & Payment Methods */}
            <div
              id="pagos"
              className="rounded-xl border border-white/10 bg-[#111114] p-5 sm:p-6 space-y-5 scroll-mt-24"
            >
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <h3 className="font-display text-base sm:text-lg font-semibold text-zinc-50">
                    2. Moneda y datos de pago
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Elige pagar en Bolívares o Dólares para visualizar la cuenta destino.
                  </p>
                </div>
                <div className="font-mono text-lg font-semibold tabular-nums text-amber-400">
                  Total: ${activeZoneMeta.price} USD
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-xs font-medium text-zinc-300">Moneda de pago</div>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-[#09090B] p-1">
                  <button
                    type="button"
                    onClick={() => handleCurrencyChange('USD')}
                    className={`rounded-md py-2.5 text-xs sm:text-sm font-semibold transition-colors ${
                      currency === 'USD'
                        ? 'bg-amber-500 text-zinc-950'
                        : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    Pagar en USD ($)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCurrencyChange('BS')}
                    className={`rounded-md py-2.5 text-xs sm:text-sm font-semibold transition-colors ${
                      currency === 'BS'
                        ? 'bg-amber-500 text-zinc-950'
                        : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    Pagar en Bs (Bolívares)
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-xs font-medium text-zinc-300">
                  {currency === 'BS' ? 'Opciones en Bolívares' : 'Opciones en Dólares'}
                </div>

                <div
                  className={`grid gap-2 ${
                    availableMethods.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
                  }`}
                >
                  {availableMethods.map((method) => {
                    const isMethodActive = activeMethodDetail.id === method.id;
                    return (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => {
                          setPaymentMethod(method.id);
                          setConfirmedOrder(null);
                        }}
                        className={`rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap truncate ${
                          isMethodActive
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-white/10 bg-[#09090B] text-zinc-400 hover:border-white/25 hover:text-zinc-200'
                        }`}
                      >
                        {method.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#09090B] p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                  <span className="text-xs font-semibold text-zinc-100">
                    {activeMethodDetail.label}
                  </span>
                  <span className="text-[11px] text-zinc-400">
                    {currency === 'BS'
                      ? 'Calculado a tasa BCV del día'
                      : `Total exacto: $${activeZoneMeta.price} USD`}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {activeMethodDetail.fields.map((field) => {
                    const fieldKey = `${activeMethodDetail.id}-${field.label}`;
                    const isCopied = copiedField === fieldKey;
                    return (
                      <div key={field.label} className="space-y-1">
                        <div className="text-[11px] text-zinc-500">{field.label}</div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-zinc-100 break-all">
                            {field.value}
                          </span>
                          {field.copyable && (
                            <button
                              type="button"
                              onClick={() => handleCopyValue(fieldKey, field.value)}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400 hover:text-amber-300 whitespace-nowrap shrink-0"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="h-3 w-3" />
                                  <span>Copiado</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  <span>Copiar</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Checkout Form */}
          <div id="reserva" className="lg:col-span-5 lg:sticky lg:top-24 scroll-mt-24">
            <div className="rounded-xl border border-white/10 bg-[#111114] p-6 sm:p-7">
              {confirmedOrder ? (
                <div className="space-y-6">
                  <div>
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-emerald-400">
                      <CheckCircle2 className="h-5 w-5" />
                      <span>Comprobante recibido</span>
                    </div>

                    <h2 className="mt-4 font-display text-2xl font-bold text-zinc-50">
                      Solicitud en verificación
                    </h2>
                    <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
                      Hemos registrado tu pago por{' '}
                      <span className="text-zinc-200 font-medium">
                        {PAYMENT_METHOD_LABELS[confirmedOrder.payment_method]}
                      </span>
                      . Al confirmarse, recibirás tu pase digital con código QR en tu correo.
                    </p>

                    <dl className="mt-6 space-y-3 border-y border-white/10 py-5 text-sm">
                      <div className="flex items-center justify-between">
                        <dt className="text-zinc-400">Orden</dt>
                        <dd className="font-mono font-semibold tabular-nums text-amber-400">
                          {confirmedOrder.id}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-zinc-400">Titular</dt>
                        <dd className="font-medium text-zinc-100">{confirmedOrder.buyer_name}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-zinc-400">Correo</dt>
                        <dd className="font-medium text-zinc-100 truncate max-w-[210px]">
                          {confirmedOrder.buyer_email}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-zinc-400">Zona</dt>
                        <dd className="font-medium text-zinc-100">
                          {ZONE_PRICING[confirmedOrder.zone].label} (${confirmedOrder.amount} USD)
                        </dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-zinc-400">Capacidad</dt>
                        <dd className="font-medium text-zinc-100">
                          {confirmedOrder.people_count === 1
                            ? '1 persona'
                            : `${confirmedOrder.people_count} personas`}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-zinc-400">Estado</dt>
                        <dd className="font-medium text-amber-400">Validando pago</dd>
                      </div>
                    </dl>
                  </div>

                  <button
                    type="button"
                    onClick={() => setConfirmedOrder(null)}
                    className="w-full rounded-lg border border-white/15 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800"
                  >
                    Comprar otra entrada
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <h2 className="font-display text-xl font-semibold text-zinc-50">
                        3. Completa tu reserva
                      </h2>
                      <p className="mt-1 text-xs text-zinc-400">
                        {activeZoneMeta.label} · {activeMethodDetail.label}
                      </p>
                    </div>
                    <span className="font-mono text-xl font-semibold tabular-nums text-amber-400 shrink-0">
                      ${activeZoneMeta.price}
                    </span>
                  </div>

                  <div>
                    <label
                      htmlFor="buyer-name"
                      className="block text-xs font-medium text-zinc-300"
                    >
                      Nombre y apellido
                    </label>
                    <input
                      id="buyer-name"
                      type="text"
                      required
                      maxLength={120}
                      value={buyerName}
                      onChange={(e) => setBuyerName(e.target.value)}
                      placeholder="Ej. Valeria Mendoza"
                      className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#09090B] px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="buyer-email"
                      className="block text-xs font-medium text-zinc-300"
                    >
                      Correo electrónico
                    </label>
                    <input
                      id="buyer-email"
                      type="email"
                      required
                      maxLength={180}
                      value={buyerEmail}
                      onChange={(e) => setBuyerEmail(e.target.value)}
                      placeholder="nombre@correo.com"
                      className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#09090B] px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <Mail className="h-3 w-3 shrink-0 text-zinc-400" />
                      <span>Enviaremos tu pase digital directamente a este correo.</span>
                    </p>
                  </div>

                  <div>
                    <span className="block text-xs font-medium text-zinc-300">
                      Comprobante de pago ({activeMethodDetail.shortLabel} · {currency})
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => {
                        handleFile(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                      className="sr-only"
                    />

                    {receiptDataUrl ? (
                      <div className="mt-2 rounded-lg border border-white/15 bg-[#09090B] p-3">
                        <div className="flex items-center gap-3">
                          <img
                            src={receiptDataUrl}
                            alt="Comprobante adjunto"
                            className="h-20 w-20 rounded-md object-cover border border-white/10 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-zinc-200">
                              {receiptFilename || 'comprobante.jpg'}
                            </p>
                            <p className="mt-1 text-[11px] text-emerald-400">
                              Comprobante listo
                            </p>
                            <div className="mt-2 flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="text-xs font-medium text-amber-400 hover:text-amber-300"
                              >
                                Reemplazar
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setReceiptDataUrl(null);
                                  setReceiptFilename('');
                                }}
                                className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-red-400"
                              >
                                <Trash2 className="h-3 w-3" />
                                <span>Eliminar</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => fileInputRef.current?.click()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            fileInputRef.current?.click();
                          }
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDragging(false);
                          handleFile(e.dataTransfer.files?.[0]);
                        }}
                        className={`mt-2 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-7 text-center transition-colors ${
                          isDragging
                            ? 'border-amber-500 bg-amber-500/5'
                            : 'border-white/20 bg-[#09090B] hover:border-white/35'
                        }`}
                      >
                        {isProcessingImage ? (
                          <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
                        ) : (
                          <ImagePlus className="h-6 w-6 text-zinc-400" />
                        )}
                        <span className="mt-2 text-xs font-medium text-zinc-200">
                          {isProcessingImage
                            ? 'Preparando imagen...'
                            : 'Adjunta la captura de tu pago'}
                        </span>
                        <span className="mt-1 text-[11px] text-zinc-500">
                          JPG, PNG o WEBP · Máximo 5 MB
                        </span>
                      </div>
                    )}
                  </div>

                  {errorMsg && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300"
                    >
                      {errorMsg}
                    </div>
                  )}

                  <div className="pt-2 space-y-3">
                    <button
                      type="submit"
                      disabled={isSubmitting || isProcessingImage}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-5 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Procesando solicitud...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4" />
                          <span>
                            Confirmar Compra (${activeZoneMeta.price} · {currency})
                          </span>
                        </>
                      )}
                    </button>

                    <p className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500">
                      <ShieldCheck className="h-3.5 w-3.5 text-zinc-400" />
                      <span>Pase digital nominal emitido tras validar el pago</span>
                    </p>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};
