import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  ImageUp,
  Keyboard,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Users,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import {
  ScannerRecentResponse,
  ScannerValidationResponse,
  ZONE_PRICING,
} from '../types';
import { safeParseJson } from '../utils/api';
import { AuthGate } from './AuthGate';

interface ScannerViewProps {
  authToken: string | null;
  isAuthenticated: boolean;
  isCheckingAuth: boolean;
  onAuthenticated: (token: string | null) => void;
  onLogout: () => void;
}

function formatDoorTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatTimeOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function playFeedbackFeedback(kind: 'success' | 'error', soundEnabled: boolean): void {
  if (!soundEnabled) return;

  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(kind === 'success' ? [90] : [130, 70, 130]);
  }

  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    if (kind === 'success') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.setValueAtTime(880, now + 0.08);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.setValueAtTime(165, now + 0.14);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    }
  } catch {
    // Ignore AudioContext autoplay restrictions
  }
}

export const ScannerView: React.FC<ScannerViewProps> = ({
  authToken,
  isAuthenticated,
  isCheckingAuth,
  onAuthenticated,
  onLogout,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScannedRef = useRef<{ token: string; timestamp: number }>({
    token: '',
    timestamp: 0,
  });
  const isValidatingRef = useRef(false);
  const qrFileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [showManualSheet, setShowManualSheet] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastResult, setLastResult] = useState<ScannerValidationResponse | null>(null);
  const [recentData, setRecentData] = useState<ScannerRecentResponse | null>(null);

  const fetchRecent = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const response = await fetch('/api/scanner/recent', {
        credentials: 'include',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });
      if (response.status === 401) {
        onLogout();
        return;
      }
      if (response.ok) {
        const data = await safeParseJson<ScannerRecentResponse>(response);
        if (data) {
          setRecentData(data);
        }
      }
    } catch {
      // Ignore silent refresh failures
    }
  }, [authToken, isAuthenticated, onLogout]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchRecent();
    } else {
      setRecentData(null);
    }
  }, [isAuthenticated, fetchRecent]);

  const validateToken = useCallback(
    async (rawToken: string) => {
      const clean = rawToken.trim();
      if (!clean || isValidatingRef.current) return;

      isValidatingRef.current = true;
      setIsValidating(true);

      try {
        const response = await fetch('/api/scanner/validate', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ token: clean }),
        });

        if (response.status === 401) {
          onLogout();
          return;
        }

        const payload = await safeParseJson<ScannerValidationResponse>(response);
        if (!payload) {
          throw new Error('Empty response');
        }
        setLastResult(payload);
        playFeedbackFeedback(payload.valid ? 'success' : 'error', soundEnabled);
        fetchRecent();
      } catch {
        setLastResult({
          valid: false,
          reason: 'invalid_input',
          message: 'No se pudo verificar el código en este momento.',
        });
        playFeedbackFeedback('error', soundEnabled);
      } finally {
        isValidatingRef.current = false;
        setIsValidating(false);
      }
    },
    [authToken, fetchRecent, onLogout, soundEnabled],
  );

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const scanFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });

        if (decoded?.data) {
          const now = Date.now();
          const sameCodeRecently =
            lastScannedRef.current.token === decoded.data &&
            now - lastScannedRef.current.timestamp < 3000;

          if (!sameCodeRecently && !isValidatingRef.current) {
            lastScannedRef.current = { token: decoded.data, timestamp: now };
            validateToken(decoded.data);
          }
        }
      }
    }

    rafRef.current = requestAnimationFrame(scanFrame);
  }, [validateToken]);

  const startCamera = useCallback(
    async (deviceIdOverride?: string) => {
      setCameraError(null);
      stopCamera();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          'Tu dispositivo no permite acceso directo a la cámara en este contexto. Usa la lectura por imagen o código manual.',
        );
        return;
      }

      try {
        const constraints: MediaStreamConstraints = {
          video: deviceIdOverride
            ? { deviceId: { exact: deviceIdOverride } }
            : { facingMode: { ideal: 'environment' } },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setCameraActive(true);

        try {
          const allDevices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');
          setCameras(videoInputs);
          if (!deviceIdOverride && videoInputs[0]?.deviceId) {
            setSelectedDeviceId(videoInputs[0].deviceId);
          }
        } catch {
          // Device enumeration optional
        }

        rafRef.current = requestAnimationFrame(scanFrame);
      } catch (err) {
        const message =
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Habilítalo en tu navegador o usa la lectura por imagen.'
            : 'No se encontró cámara activa. Puedes validar mediante imagen QR o código.';
        setCameraError(message);
        stopCamera();
      }
    },
    [scanFrame, stopCamera],
  );

  useEffect(() => {
    if (isAuthenticated) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isAuthenticated, startCamera, stopCamera]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    validateToken(manualCode);
    setManualCode('');
    setShowManualSheet(false);
  };

  const handleUploadQrImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : '';
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (decoded?.data) {
          validateToken(decoded.data);
        } else {
          setLastResult({
            valid: false,
            reason: 'invalid_input',
            message: 'No se detectó un código QR legible en esa imagen.',
          });
          playFeedbackFeedback('error', soundEnabled);
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  if (isCheckingAuth) {
    return (
      <main className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-7xl items-center justify-center px-4">
        <Loader2 className="h-7 w-7 animate-spin text-amber-500" />
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthGate
        title="Control de Puerta"
        subtitle="Inicia sesión con tu clave de equipo para habilitar el escáner de acceso."
        onAuthenticated={onAuthenticated}
      />
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8 sm:px-6 lg:px-8 pb-28 sm:pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-zinc-50">
            Control de Puerta
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-zinc-400">
            Lectura instantánea de pases digitales MOSLY.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSoundEnabled((prev) => !prev)}
            aria-label={soundEnabled ? 'Silenciar alertas' : 'Activar sonido y vibración'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#111114] px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            {soundEnabled ? (
              <>
                <Volume2 className="h-3.5 w-3.5 text-amber-400" />
                <span className="hidden sm:inline">Sonido activo</span>
              </>
            ) : (
              <>
                <VolumeX className="h-3.5 w-3.5 text-zinc-500" />
                <span className="hidden sm:inline">En silencio</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={fetchRecent}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#111114] px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Actualizar</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#111114] px-3 py-2 text-xs font-medium text-zinc-300 hover:border-red-500/40 hover:text-red-300"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </div>

      {/* Live Attendance Strip */}
      <div className="mt-5 grid grid-cols-3 sm:grid-cols-6 divide-x divide-white/10 rounded-xl border border-white/10 bg-[#111114]">
        <div className="p-3.5 sm:p-4">
          <div className="text-[11px] text-zinc-400">Personas adentro</div>
          <div className="mt-1 font-mono text-xl sm:text-2xl font-semibold tabular-nums text-emerald-400">
            {recentData?.stats.peopleEnteredCount ?? 0}
          </div>
        </div>
        <div className="p-3.5 sm:p-4">
          <div className="text-[11px] text-zinc-400">Pases usados</div>
          <div className="mt-1 font-mono text-xl sm:text-2xl font-semibold tabular-nums text-zinc-50">
            {recentData?.stats.usedCount ?? 0}
            <span className="text-xs font-normal text-zinc-500">
              /{recentData?.stats.approvedTotalCount ?? 0}
            </span>
          </div>
        </div>
        <div className="p-3.5 sm:p-4">
          <div className="text-[11px] text-zinc-400">General</div>
          <div className="mt-1 font-mono text-xl sm:text-2xl font-semibold tabular-nums text-zinc-200">
            {recentData?.stats.generalUsedCount ?? 0}
          </div>
        </div>
        <div className="hidden sm:block p-4">
          <div className="text-[11px] text-zinc-400">VIP</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-400">
            {recentData?.stats.vipUsedCount ?? 0}
          </div>
        </div>
        <div className="hidden sm:block p-4">
          <div className="text-[11px] text-zinc-400">Box Ind.</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-200">
            {recentData?.stats.boxIndividualUsedCount ?? 0}
          </div>
        </div>
        <div className="hidden sm:block p-4">
          <div className="text-[11px] text-zinc-400">Mesa Box x6</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-400">
            {recentData?.stats.mesaBoxUsedCount ?? 0}
          </div>
        </div>
      </div>

      {/* Scanner Workspace */}
      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Camera Feed */}
        <div className="lg:col-span-7 overflow-hidden rounded-xl border border-white/10 bg-[#111114]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-200">
              {cameraActive ? (
                <>
                  <Camera className="h-4 w-4 text-amber-400" />
                  <span>Cámara en vivo</span>
                </>
              ) : (
                <>
                  <CameraOff className="h-4 w-4 text-zinc-500" />
                  <span>Cámara en pausa</span>
                </>
              )}
            </div>

            {cameras.length > 1 && (
              <select
                aria-label="Seleccionar cámara"
                value={selectedDeviceId}
                onChange={(e) => {
                  setSelectedDeviceId(e.target.value);
                  startCamera(e.target.value);
                }}
                className="max-w-[180px] truncate rounded-md border border-white/15 bg-[#09090B] px-2.5 py-1.5 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
              >
                {cameras.map((cam, idx) => (
                  <option key={cam.deviceId} value={cam.deviceId}>
                    {cam.label || `Cámara ${idx + 1}`}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="relative aspect-[3/4] sm:aspect-[4/3] w-full bg-[#09090B] flex items-center justify-center overflow-hidden">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`h-full w-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {cameraActive ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
              >
                <div className="relative h-60 w-60 sm:h-64 sm:w-64">
                  <span className="absolute left-0 top-0 h-9 w-9 border-l-2 border-t-2 border-amber-400 rounded-tl-lg" />
                  <span className="absolute right-0 top-0 h-9 w-9 border-r-2 border-t-2 border-amber-400 rounded-tr-lg" />
                  <span className="absolute bottom-0 left-0 h-9 w-9 border-b-2 border-l-2 border-amber-400 rounded-bl-lg" />
                  <span className="absolute bottom-0 right-0 h-9 w-9 border-b-2 border-r-2 border-amber-400 rounded-br-lg" />
                </div>
              </div>
            ) : (
              <div className="px-6 text-center max-w-sm">
                <QrCode className="mx-auto h-11 w-11 text-zinc-600" />
                <p className="mt-3 text-xs text-zinc-400 leading-relaxed">
                  {cameraError || 'Activa la cámara para leer los códigos QR en puerta.'}
                </p>
              </div>
            )}

            {isValidating && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
                <div className="inline-flex items-center gap-2 rounded-lg bg-[#111114] border border-white/15 px-4 py-2.5 text-xs font-medium text-zinc-100">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                  <span>Validando pase...</span>
                </div>
              </div>
            )}
          </div>

          {/* One-handed Bottom Thumb Control Dock (Desktop inline, Mobile ergonomic) */}
          <div className="grid grid-cols-3 gap-2 border-t border-white/10 p-3 bg-[#111114]">
            <button
              type="button"
              onClick={() => (cameraActive ? stopCamera() : startCamera(selectedDeviceId || undefined))}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-3 px-2 text-xs font-semibold transition-colors ${
                cameraActive
                  ? 'border border-white/15 bg-[#09090B] text-zinc-200'
                  : 'bg-amber-500 text-zinc-950'
              }`}
            >
              {cameraActive ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
              <span>{cameraActive ? 'Pausar' : 'Activar'}</span>
            </button>

            <input
              ref={qrFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                handleUploadQrImage(e.target.files?.[0]);
                e.target.value = '';
              }}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => qrFileInputRef.current?.click()}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-[#09090B] py-3 px-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              <ImageUp className="h-4 w-4 text-amber-400" />
              <span>Imagen QR</span>
            </button>

            <button
              type="button"
              onClick={() => setShowManualSheet((prev) => !prev)}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-[#09090B] py-3 px-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              <Keyboard className="h-4 w-4 text-amber-400" />
              <span>Manual</span>
            </button>
          </div>

          {showManualSheet && (
            <form
              onSubmit={handleManualSubmit}
              className="flex gap-2 border-t border-white/10 bg-[#09090B] p-3"
            >
              <input
                type="text"
                autoFocus
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Pega el código del pase..."
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-[#111114] px-3 py-2.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!manualCode.trim() || isValidating}
                className="rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
              >
                Validar
              </button>
            </form>
          )}
        </div>

        {/* Right: Recent Door Log */}
        <div className="lg:col-span-5 overflow-hidden rounded-xl border border-white/10 bg-[#111114]">
          <div className="border-b border-white/10 px-5 py-3.5">
            <h2 className="font-display text-sm font-semibold text-zinc-100">
              Últimos ingresos confirmados
            </h2>
          </div>

          {!recentData || recentData.recent.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-zinc-500">
              Aún no se registran ingresos en puerta.
            </div>
          ) : (
            <ul className="divide-y divide-white/5 text-xs">
              {recentData.recent.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="font-medium text-zinc-100 truncate">{entry.buyer_name}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-400">
                      {ZONE_PRICING[entry.zone]?.label || entry.zone} ·{' '}
                      {entry.people_count === 1 ? '1 persona' : `${entry.people_count} personas`}
                    </div>
                  </div>
                  <span className="font-mono tabular-nums text-emerald-400 shrink-0">
                    {formatTimeOnly(entry.used_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Full-Screen High-Contrast Door Result Overlay (Mobile One-Handed UX) */}
      {lastResult && (
        <div
          role="dialog"
          aria-modal="true"
          aria-live="assertive"
          onClick={() => setLastResult(null)}
          className={`fixed inset-0 z-50 flex flex-col justify-between p-6 sm:p-10 backdrop-blur-md ${
            lastResult.valid ? 'bg-emerald-950/95' : 'bg-red-950/95'
          }`}
        >
          <div className="flex items-center justify-between text-xs uppercase tracking-widest opacity-80">
            <span className="font-semibold text-white">Control de Puerta · MOSLY</span>
            <span className="font-mono text-white">
              {lastResult.ticket?.id || 'Verificación'}
            </span>
          </div>

          <div className="mx-auto flex max-w-lg flex-col items-center text-center">
            {lastResult.valid ? (
              <CheckCircle2 className="h-24 w-24 text-emerald-300" />
            ) : lastResult.reason === 'already_used' ? (
              <ShieldAlert className="h-24 w-24 text-red-300" />
            ) : (
              <XCircle className="h-24 w-24 text-red-300" />
            )}

            <div
              className={`mt-5 text-sm font-bold uppercase tracking-[0.18em] ${
                lastResult.valid ? 'text-emerald-300' : 'text-red-300'
              }`}
            >
              {lastResult.valid
                ? 'Acceso Autorizado'
                : lastResult.reason === 'already_used'
                ? 'Entrada Ya Utilizada'
                : 'Acceso Denegado'}
            </div>

            <h2 className="mt-2 font-display text-3xl sm:text-4xl font-bold text-white">
              {lastResult.ticket ? lastResult.ticket.buyer_name : 'Pase no válido'}
            </h2>

            <p className="mt-2 text-sm sm:text-base text-white/85 max-w-md">
              {lastResult.message}
            </p>

            {lastResult.ticket && (
              <div className="mt-7 grid w-full grid-cols-2 gap-3 rounded-2xl border border-white/20 bg-black/30 p-5 text-left">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Zona</div>
                  <div className="mt-1 font-display text-xl sm:text-2xl font-bold text-white">
                    {ZONE_PRICING[lastResult.ticket.zone]?.shortLabel || lastResult.ticket.zone}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-white/60">
                    Capacidad
                  </div>
                  <div className="mt-1 inline-flex items-center gap-2 font-display text-xl sm:text-2xl font-bold text-white">
                    <Users className="h-5 w-5 text-amber-300" />
                    <span>
                      {lastResult.ticket.people_count === 1
                        ? '1 persona'
                        : `${lastResult.ticket.people_count} personas`}
                    </span>
                  </div>
                </div>

                {lastResult.ticket.used_at && (
                  <div className="col-span-2 border-t border-white/15 pt-3 mt-1 flex items-center justify-between text-xs">
                    <span className="text-white/70">
                      {lastResult.valid ? 'Hora de ingreso' : 'Ingresó previamente'}
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-white">
                      {formatDoorTimestamp(lastResult.ticket.used_at)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mx-auto w-full max-w-md pt-4">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLastResult(null);
              }}
              className="w-full rounded-xl bg-white py-4 text-base font-bold text-zinc-950 shadow-lg active:scale-[0.99] transition-transform"
            >
              {lastResult.valid ? 'Escanear siguiente' : 'Continuar escaneando'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
};
