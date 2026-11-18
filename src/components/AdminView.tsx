import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Download,
  Expand,
  Eye,
  Loader2,
  LogOut,
  Mail,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import {
  PAYMENT_METHOD_LABELS,
  TicketRecord,
  TicketStatus,
  ZONE_PRICING,
} from '../types';
import { safeParseJson } from '../utils/api';
import { AuthGate } from './AuthGate';

interface AdminViewProps {
  authToken: string | null;
  isAuthenticated: boolean;
  isCheckingAuth: boolean;
  onAuthenticated: (token: string | null) => void;
  onLogout: () => void;
}

function formatDateTime(iso: string | null): string {
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

function StatusBadge({ status }: { status: TicketStatus }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>Aprobada</span>
      </span>
    );
  }
  if (status === 'used') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        <span>Usada</span>
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
        <XCircle className="h-3.5 w-3.5 shrink-0" />
        <span>Rechazada</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span>Pendiente</span>
    </span>
  );
}

export const AdminView: React.FC<AdminViewProps> = ({
  authToken,
  isAuthenticated,
  isCheckingAuth,
  onAuthenticated,
  onLogout,
}) => {
  const [orders, setOrders] = useState<TicketRecord[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | TicketStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [receiptBlobUrl, setReceiptBlobUrl] = useState<string | null>(null);
  const [isLoadingReceipt, setIsLoadingReceipt] = useState(false);
  const [zoomedReceiptUrl, setZoomedReceiptUrl] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setIsLoadingOrders(true);
    setOrdersError(null);
    try {
      const response = await fetch('/api/admin/orders', {
        credentials: 'include',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });

      if (response.status === 401) {
        onLogout();
        return;
      }

      const data = await safeParseJson<{
        orders?: TicketRecord[];
        error?: string;
      }>(response);
      if (!response.ok || !data) {
        throw new Error(data?.error || 'No se pudieron cargar las solicitudes.');
      }

      const loadedOrders = data.orders ?? [];
      setOrders(loadedOrders);
      setSelectedId((prev) => {
        if (prev && loadedOrders.some((o) => o.id === prev)) return prev;
        return loadedOrders[0]?.id ?? null;
      });
    } catch (err) {
      setOrdersError(err instanceof Error ? err.message : 'Error al consultar las órdenes.');
    } finally {
      setIsLoadingOrders(false);
    }
  }, [authToken, onLogout]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchOrders();
    } else {
      setOrders([]);
      setSelectedId(null);
    }
  }, [isAuthenticated, fetchOrders]);

  const handleApprove = async (orderId: string) => {
    setActionLoadingId(orderId);
    setActionNotice(null);

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });

      if (response.status === 401) {
        onLogout();
        return;
      }

      const data = await safeParseJson<{ order?: TicketRecord; error?: string }>(response);
      if (!response.ok || !data?.order) {
        throw new Error(data?.error || 'No se pudo aprobar la solicitud.');
      }

      const updated = data.order;
      setOrders((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));

      if (updated.email_status === 'sent') {
        setActionNotice({
          type: 'success',
          text: `Entrada aprobada y pase digital enviado a ${updated.buyer_email}.`,
        });
      } else {
        setActionNotice({
          type: 'warning',
          text: updated.email_error
            ? `Pago aprobado - Envío de correo pendiente (${updated.email_error})`
            : 'Pago aprobado - Envío de correo pendiente. Puedes reintentar el envío desde el panel.',
        });
      }
    } catch (err) {
      setActionNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'No se pudo completar la aprobación.',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (orderId: string) => {
    setActionLoadingId(orderId);
    setActionNotice(null);

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });

      if (response.status === 401) {
        onLogout();
        return;
      }

      const data = await safeParseJson<{ order?: TicketRecord; error?: string }>(response);
      if (!response.ok || !data?.order) {
        throw new Error(data?.error || 'No se pudo rechazar la solicitud.');
      }

      const updated = data.order;
      setOrders((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setActionNotice({
        type: 'success',
        text: `Solicitud ${updated.id} marcada como rechazada.`,
      });
    } catch (err) {
      setActionNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al rechazar la solicitud.',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const counts = useMemo(() => {
    return {
      total: orders.length,
      pending: orders.filter((o) => o.status === 'pending').length,
      approved: orders.filter((o) => o.status === 'approved').length,
      used: orders.filter((o) => o.status === 'used').length,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== 'all' && order.status !== statusFilter) return false;
      if (!q) return true;
      return (
        order.id.toLowerCase().includes(q) ||
        order.buyer_name.toLowerCase().includes(q) ||
        order.buyer_email.toLowerCase().includes(q)
      );
    });
  }, [orders, statusFilter, searchQuery]);

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedId) ?? filteredOrders[0] ?? null,
    [orders, filteredOrders, selectedId],
  );

  useEffect(() => {
    if (!isAuthenticated || !selectedOrder) {
      setReceiptBlobUrl(null);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    setIsLoadingReceipt(true);
    setReceiptBlobUrl(null);

    fetch(`/api/admin/orders/${selectedOrder.id}/receipt`, {
      credentials: 'include',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.blob();
      })
      .then((blob) => {
        if (cancelled || !blob) return;
        createdUrl = URL.createObjectURL(blob);
        setReceiptBlobUrl(createdUrl);
      })
      .catch(() => {
        if (!cancelled) setReceiptBlobUrl(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingReceipt(false);
      });

    return () => {
      cancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [isAuthenticated, selectedOrder, authToken]);

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
        title="Panel de Administración"
        subtitle="Ingresa la clave autorizada para revisar comprobantes de pago y emitir pases digitales."
        onAuthenticated={onAuthenticated}
      />
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-zinc-50">
            Gestión de Entradas
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Verifica los comprobantes recibidos para activar y emitir los pases digitales.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fetchOrders}
            disabled={isLoadingOrders}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#111114] px-3.5 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingOrders ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#111114] px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-red-500/40 hover:text-red-300"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Salir</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="mt-6 grid grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/10 rounded-xl border border-white/10 bg-[#111114] sm:grid-cols-4">
        <div className="p-4 sm:p-5">
          <div className="text-xs text-zinc-400">Total registradas</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-50">
            {counts.total}
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs text-zinc-400">Por aprobar</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-400">
            {counts.pending}
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs text-zinc-400">Activas</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-400">
            {counts.approved}
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs text-zinc-400">Ingresaron en puerta</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-sky-400">
            {counts.used}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-[#111114] p-1">
          {(
            [
              { id: 'all', label: 'Todas' },
              { id: 'pending', label: 'Pendientes' },
              { id: 'approved', label: 'Aprobadas' },
              { id: 'used', label: 'Usadas' },
              { id: 'rejected', label: 'Rechazadas' },
            ] as const
          ).map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  active ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar cliente, correo u orden..."
            className="w-full rounded-lg border border-white/15 bg-[#111114] py-2 pl-9 pr-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
          />
        </div>
      </div>

      {actionNotice && (
        <div
          role="status"
          className={`mt-5 rounded-xl border px-4 py-3 text-xs ${
            actionNotice.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : actionNotice.type === 'warning'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
              : 'border-red-500/30 bg-red-500/10 text-red-200'
          }`}
        >
          {actionNotice.text}
        </div>
      )}

      {ordersError && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300"
        >
          {ordersError}
        </div>
      )}

      {/* Master-Detail Grid */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left: Orders Table */}
        <div className="lg:col-span-7 overflow-hidden rounded-xl border border-white/10 bg-[#111114]">
          {isLoadingOrders && orders.length === 0 ? (
            <div className="space-y-3 p-6">
              {[1, 2, 3, 4].map((row) => (
                <div key={row} className="h-11 animate-pulse rounded-lg bg-white/5" />
              ))}
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <QrCode className="mx-auto h-8 w-8 text-zinc-600" />
              <h2 className="mt-3 font-display text-base font-semibold text-zinc-200">
                Sin solicitudes en esta vista
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Las reservas enviadas desde la taquilla aparecerán aquí.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-zinc-400">
                    <th className="px-4 py-3 font-medium">Orden</th>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Zona</th>
                    <th className="px-4 py-3 font-medium text-right">Monto</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium text-right">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredOrders.map((order) => {
                    const isSelected = selectedOrder?.id === order.id;
                    return (
                      <tr
                        key={order.id}
                        onClick={() => setSelectedId(order.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-amber-500/10' : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        <td className="px-4 py-3.5 font-mono tabular-nums text-zinc-200 whitespace-nowrap">
                          {order.id}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-medium text-zinc-100 truncate max-w-[160px]">
                            {order.buyer_name}
                          </div>
                          <div className="text-[11px] text-zinc-500 truncate max-w-[160px]">
                            {order.buyer_email}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-zinc-300 whitespace-nowrap">
                          {ZONE_PRICING[order.zone]?.shortLabel || order.zone}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums text-zinc-200 whitespace-nowrap">
                          <div>${order.amount}</div>
                          <div className="text-[10px] text-zinc-500">{order.currency}</div>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(order.id);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 hover:text-amber-300"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Ver</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Receipt & Pass Inspector */}
        <div className="lg:col-span-5 rounded-xl border border-white/10 bg-[#111114] p-6">
          {selectedOrder ? (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <div className="font-mono text-xs text-amber-400 tabular-nums">
                    {selectedOrder.id}
                  </div>
                  <h2 className="mt-1 font-display text-lg font-semibold text-zinc-50">
                    {selectedOrder.buyer_name}
                  </h2>
                  <p className="text-xs text-zinc-400">{selectedOrder.buyer_email}</p>
                </div>
                <StatusBadge status={selectedOrder.status} />
              </div>

              {/* Metadata grid */}
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-zinc-500">Zona y capacidad</dt>
                  <dd className="mt-0.5 font-medium text-zinc-200">
                    {ZONE_PRICING[selectedOrder.zone]?.label || selectedOrder.zone} ·{' '}
                    {selectedOrder.people_count === 1
                      ? '1 persona'
                      : `${selectedOrder.people_count} personas`}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Pago reportado</dt>
                  <dd className="mt-0.5 font-mono font-semibold tabular-nums text-zinc-200">
                    ${selectedOrder.amount} USD ·{' '}
                    <span className="font-sans font-normal text-amber-300">
                      {PAYMENT_METHOD_LABELS[selectedOrder.payment_method] ||
                        selectedOrder.payment_method}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Fecha de registro</dt>
                  <dd className="mt-0.5 tabular-nums text-zinc-300">
                    {formatDateTime(selectedOrder.created_at)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Entrega por correo</dt>
                  <dd className="mt-0.5">
                    {selectedOrder.email_status === 'sent' && (
                      <span className="text-emerald-400 font-medium">Enviado correctamente</span>
                    )}
                    {selectedOrder.email_status === 'pending_retry' && (
                      <div className="space-y-1">
                        <span className="text-amber-400 font-medium block">
                          Pago aprobado - Envío de correo pendiente
                        </span>
                        {selectedOrder.email_error && (
                          <span className="text-[11px] text-zinc-400 block leading-snug">
                            {selectedOrder.email_error}
                          </span>
                        )}
                      </div>
                    )}
                    {selectedOrder.email_status === 'not_sent' && (
                      <span className="text-zinc-500">En espera de aprobación</span>
                    )}
                  </dd>
                </div>
              </dl>

              {/* Secure Receipt Preview */}
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-300">Comprobante adjunto</span>
                  {receiptBlobUrl && (
                    <button
                      type="button"
                      onClick={() => setZoomedReceiptUrl(receiptBlobUrl)}
                      className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300"
                    >
                      <Expand className="h-3.5 w-3.5" />
                      <span>Ampliar</span>
                    </button>
                  )}
                </div>
                {isLoadingReceipt ? (
                  <div className="mt-2 flex h-44 w-full items-center justify-center rounded-lg border border-white/10 bg-[#09090B]">
                    <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                  </div>
                ) : receiptBlobUrl ? (
                  <button
                    type="button"
                    onClick={() => setZoomedReceiptUrl(receiptBlobUrl)}
                    className="mt-2 block w-full overflow-hidden rounded-lg border border-white/10 bg-[#09090B]"
                  >
                    <img
                      src={receiptBlobUrl}
                      alt={`Comprobante de ${selectedOrder.buyer_name}`}
                      className="max-h-64 w-full object-contain"
                    />
                  </button>
                ) : (
                  <div className="mt-2 flex h-32 w-full items-center justify-center rounded-lg border border-white/10 bg-[#09090B] text-xs text-zinc-500">
                    Comprobante no disponible
                  </div>
                )}
              </div>

              {/* Generated Digital Pass Actions */}
              {selectedOrder.qr_token && selectedOrder.qr_data_url && (
                <div className="border-t border-white/10 pt-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-300">Pase digital firmado</span>
                    <span className="text-[11px] text-zinc-400">
                      {selectedOrder.status === 'used'
                        ? `Utilizado el ${formatDateTime(selectedOrder.used_at)}`
                        : 'Activo para puerta'}
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-4 rounded-lg border border-white/10 bg-[#09090B] p-4">
                    <img
                      src={selectedOrder.qr_data_url}
                      alt={`QR ${selectedOrder.id}`}
                      className="h-28 w-28 rounded-md bg-white p-1.5 shrink-0"
                    />
                    <div className="flex-1 space-y-2.5 text-xs w-full">
                      <p className="text-zinc-400 leading-relaxed">
                        {selectedOrder.status === 'used'
                          ? 'Este código QR ya fue validado en puerta.'
                          : 'Pase digital firmado y listo para escanear en puerta.'}
                      </p>

                      <a
                        href={selectedOrder.qr_data_url}
                        download={`entrada-mosly-${selectedOrder.id}.png`}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-white/15 bg-[#111114] px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Descargar imagen QR</span>
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* Approval / Retry Controls */}
              {selectedOrder.status === 'pending' && (
                <div className="flex flex-col sm:flex-row gap-3 border-t border-white/10 pt-5">
                  <button
                    type="button"
                    disabled={actionLoadingId === selectedOrder.id}
                    onClick={() => handleApprove(selectedOrder.id)}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400 disabled:opacity-60"
                  >
                    {actionLoadingId === selectedOrder.id ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Procesando...</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        <span>Aprobar y Enviar Pase</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={actionLoadingId === selectedOrder.id}
                    onClick={() => handleReject(selectedOrder.id)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-60"
                  >
                    <XCircle className="h-4 w-4" />
                    <span>Rechazar</span>
                  </button>
                </div>
              )}

              {selectedOrder.status === 'approved' && (
                <div className="border-t border-white/10 pt-5">
                  <button
                    type="button"
                    disabled={actionLoadingId === selectedOrder.id}
                    onClick={() => handleApprove(selectedOrder.id)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-[#09090B] px-4 py-2.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-60"
                  >
                    {actionLoadingId === selectedOrder.id ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Enviando...</span>
                      </>
                    ) : (
                      <>
                        <Mail className="h-3.5 w-3.5" />
                        <span>
                          {selectedOrder.email_status === 'pending_retry'
                            ? 'Reintentar envío de correo'
                            : 'Reenviar correo al cliente'}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-zinc-500">
              Selecciona una solicitud para inspeccionar el comprobante.
            </div>
          )}
        </div>
      </div>

      {/* Receipt Lightbox Modal */}
      {zoomedReceiptUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Comprobante ampliado"
          onClick={() => setZoomedReceiptUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-xl border border-white/15 bg-[#111114] p-2"
          >
            <button
              type="button"
              onClick={() => setZoomedReceiptUrl(null)}
              aria-label="Cerrar vista ampliada"
              className="absolute right-3 top-3 rounded-lg bg-black/70 p-2 text-zinc-200 hover:bg-black"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={zoomedReceiptUrl}
              alt="Comprobante de pago ampliado"
              className="max-h-[84vh] w-auto object-contain rounded-lg"
            />
          </div>
        </div>
      )}
    </main>
  );
};
