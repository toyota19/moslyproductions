import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, ShieldAlert, Users } from 'lucide-react';
import { DigitalPassData, EVENT_LOGO_URL, ZONE_PRICING } from '../types';
import { safeParseJson } from '../utils/api';

interface DigitalPassViewProps {
  token: string;
  onBackToStore: () => void;
}

function formatTimeStamp(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export const DigitalPassView: React.FC<DigitalPassViewProps> = ({ token, onBackToStore }) => {
  const [pass, setPass] = useState<DigitalPassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setErrorMsg('Enlace de pase digital incompleto.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    fetch(`/api/pass?t=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await safeParseJson<DigitalPassData & { error?: string }>(res);
        if (!res.ok || !data) {
          throw new Error(data?.error || 'Este pase no es válido o ha expirado.');
        }
        setPass(data);
      })
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : 'No se pudo cargar tu pase digital.');
      })
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-lg items-center justify-center px-4 py-10">
      <div className="w-full overflow-hidden rounded-2xl border border-white/15 bg-[#111114]">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <img
            src={EVENT_LOGO_URL}
            alt="MOSLY"
            className="h-6 w-auto object-contain mix-blend-screen"
          />
          <span className="text-xs font-medium text-zinc-400">Pase Digital</span>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
            <p className="mt-3 text-xs text-zinc-400">Cargando tu entrada...</p>
          </div>
        ) : errorMsg || !pass ? (
          <div className="px-6 py-12 text-center">
            <ShieldAlert className="mx-auto h-10 w-10 text-red-400" />
            <h1 className="mt-3 font-display text-lg font-semibold text-zinc-50">
              Pase no disponible
            </h1>
            <p className="mt-1.5 text-xs text-zinc-400">{errorMsg}</p>
            <button
              type="button"
              onClick={onBackToStore}
              className="mt-6 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
            >
              Ir a Taquilla
            </button>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            <div className="text-center">
              {pass.status === 'approved' ? (
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Válido para ingreso</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400">
                  <ShieldAlert className="h-4 w-4" />
                  <span>Entrada ya utilizada ({formatTimeStamp(pass.used_at)})</span>
                </div>
              )}

              <h1 className="mt-2 font-display text-2xl font-bold text-zinc-50">
                {pass.buyer_name}
              </h1>
              <p className="mt-1 text-xs text-zinc-400">
                Presenta este código QR en la entrada principal
              </p>
            </div>

            <div className="flex justify-center">
              <div className="rounded-xl bg-white p-3.5">
                <img
                  src={pass.qr_data_url}
                  alt={`Código QR de entrada ${pass.id}`}
                  className="h-56 w-56 object-contain"
                />
              </div>
            </div>

            <dl className="space-y-3 border-t border-white/10 pt-5 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Orden</dt>
                <dd className="font-mono font-semibold tabular-nums text-amber-400">{pass.id}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Zona</dt>
                <dd className="font-semibold text-zinc-100">
                  {ZONE_PRICING[pass.zone]?.label || pass.zone}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-zinc-500">Capacidad</dt>
                <dd className="inline-flex items-center gap-1.5 font-semibold text-zinc-100">
                  <Users className="h-3.5 w-3.5 text-amber-400" />
                  <span>
                    {pass.people_count === 1 ? '1 persona' : `${pass.people_count} personas`}
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </main>
  );
};
