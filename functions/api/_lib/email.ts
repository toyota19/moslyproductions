import { bytesToBase64, cleanEnvSecret, escapeHtml } from './security';
import { CloudflareEnv, TicketRow, ZONE_LABELS } from './types';

function resolveFromAddress(env: CloudflareEnv): string {
  const configured = cleanEnvSecret(env.RESEND_FROM_EMAIL);
  return configured || 'MOSLY <entradas@moslyproductions.com>';
}

export async function sendTicketEmailEdge(
  env: CloudflareEnv,
  ticket: TicketRow,
  qrToken: string,
  qrBuffer: Uint8Array,
  passUrl: string,
): Promise<{ emailStatus: 'sent' | 'pending_retry'; emailError: string | null }> {
  const apiKey = cleanEnvSecret(env.RESEND_API_KEY);
  const fromAddress = resolveFromAddress(env);

  if (!apiKey) {
    console.warn(`[MAIL_DELIVERY] RESEND_API_KEY missing; order=${ticket.id}`);
    return {
      emailStatus: 'pending_retry',
      emailError: 'Falta configurar RESEND_API_KEY en Cloudflare Pages.',
    };
  }

  const safeName = escapeHtml(ticket.buyer_name);
  const safeZone = escapeHtml(ZONE_LABELS[ticket.zone] || ticket.zone);
  const safeOrderId = escapeHtml(ticket.id);
  const safePassUrl = escapeHtml(passUrl);
  const safeToken = escapeHtml(qrToken);
  const capacityLabel =
    ticket.people_count === 1 ? '1 persona' : `${ticket.people_count} personas`;

  const html = `
    <div style="margin:0;padding:32px 16px;background-color:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#fafafa;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;background-color:#111114;border:1px solid #27272a;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="padding:28px 28px 20px;border-bottom:1px solid #27272a;">
            <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#f59e0b;font-weight:700;">MOSLY</div>
            <h1 style="margin:8px 0 0;font-size:22px;line-height:1.25;color:#fafafa;">Tu entrada está confirmada</h1>
            <p style="margin:8px 0 0;font-size:14px;color:#a1a1aa;line-height:1.5;">
              Hola ${safeName}, hemos validado tu comprobante de pago. Presenta el siguiente código QR en la puerta para acceder al evento.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;text-align:center;background-color:#0d0d10;">
            <div style="display:inline-block;padding:16px;background-color:#ffffff;border-radius:12px;">
              <img src="cid:mosly-qr" width="220" height="220" alt="Código QR de entrada ${safeOrderId}" style="display:block;border:0;" />
            </div>
            <div style="margin-top:16px;">
              <a href="${safePassUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#f59e0b;color:#09090b;text-decoration:none;font-size:13px;font-weight:700;padding:11px 20px;border-radius:8px;">
                Abrir pase digital en el navegador
              </a>
            </div>
            <div style="margin-top:12px;font-size:12px;color:#a1a1aa;">
              Pase único e intransferible. Al escanearse en puerta quedará marcado como utilizado.
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px 28px;border-top:1px solid #27272a;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;color:#d4d4d8;">
              <tr>
                <td style="padding:6px 0;color:#71717a;">Orden</td>
                <td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600;color:#fafafa;">${safeOrderId}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#71717a;">Sector</td>
                <td style="padding:6px 0;text-align:right;font-weight:600;color:#f59e0b;">${safeZone}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#71717a;">Capacidad</td>
                <td style="padding:6px 0;text-align:right;font-weight:600;color:#fafafa;">${capacityLabel}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#71717a;">Titular</td>
                <td style="padding:6px 0;text-align:right;color:#fafafa;">${safeName}</td>
              </tr>
            </table>
            <div style="margin-top:14px;padding-top:12px;border-top:1px solid #27272a;font-size:11px;color:#71717a;word-break:break-all;">
              Código de respaldo: <span style="font-family:monospace;color:#a1a1aa;">${safeToken}</span>
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [ticket.buyer_email],
        subject: `Tu entrada MOSLY — ${ZONE_LABELS[ticket.zone]} (${ticket.id})`,
        html,
        attachments: [
          {
            filename: `entrada-mosly-${ticket.id}.png`,
            content: bytesToBase64(qrBuffer),
            content_id: 'mosly-qr',
          },
        ],
      }),
    });

    const data = (await res.json().catch(() => null)) as {
      id?: string;
      message?: string;
      name?: string;
    } | null;

    if (!res.ok) {
      const detail = data?.message || `Resend respondió HTTP ${res.status}`;
      console.error(`[MAIL_DELIVERY] Failed to=${ticket.buyer_email} (${ticket.id}):`, detail);
      return {
        emailStatus: 'pending_retry',
        emailError: `Remitente (${fromAddress}): ${detail}`,
      };
    }

    return { emailStatus: 'sent', emailError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error de conexión al enviar correo.';
    console.error(`[MAIL_DELIVERY] Exception (${ticket.id}):`, message);
    return {
      emailStatus: 'pending_retry',
      emailError: `Remitente (${fromAddress}): ${message}`,
    };
  }
}
