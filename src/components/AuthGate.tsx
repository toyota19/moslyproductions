import React, { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { safeReadJson } from '../utils/api';

interface AuthGateProps {
  title: string;
  subtitle: string;
  onAuthenticated: (token: string | null) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ title, subtitle, onAuthenticated }) => {
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const result = await safeReadJson<{
        authenticated?: boolean;
        token?: string;
        error?: string;
      }>(response);

      if (!result.data) {
        const detail = result.isHtml
          ? `HTTP ${result.status} (respuesta HTML)`
          : result.isEmpty
          ? `HTTP ${result.status} (respuesta vacía)`
          : `HTTP ${result.status}`;
        throw new Error(
          `Las rutas /api no están activas en este despliegue (${detail}). En Cloudflare debes publicar como Cloudflare Pages con la carpeta "functions/" en la raíz (vía Git o "wrangler pages deploy dist"), no subir solo "dist/".`,
        );
      }

      if (!response.ok || !result.data.authenticated) {
        throw new Error(result.data.error || 'No se pudo verificar el acceso.');
      }

      setPassword('');
      onAuthenticated(result.data.token || null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error de autenticación.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-7xl items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#111114] p-7 sm:p-8">
        <div className="flex items-center gap-2.5 text-amber-400">
          <KeyRound className="h-5 w-5" />
          <span className="text-xs font-semibold tracking-wider uppercase">Acceso de Equipo</span>
        </div>
        <h1 className="mt-3 font-display text-2xl font-bold text-zinc-50">{title}</h1>
        <p className="mt-1.5 text-sm text-zinc-400">{subtitle}</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="staff-password" className="block text-xs font-medium text-zinc-300">
              Clave de acceso
            </label>
            <input
              id="staff-password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#09090B] px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300"
            >
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Verificando...</span>
              </>
            ) : (
              <span>Ingresar</span>
            )}
          </button>
        </form>
      </div>
    </main>
  );
};
