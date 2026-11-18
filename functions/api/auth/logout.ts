import {
  buildSessionCookieHeader,
  jsonResponse,
  verifySameOriginCsrf,
} from '../_lib/security';
import { CloudflareEnv, PagesFunction } from '../_lib/types';

export const onRequestPost: PagesFunction<CloudflareEnv> = async ({ request }) => {
  if (!verifySameOriginCsrf(request)) {
    return jsonResponse({ error: 'Solicitud de origen no autorizado.' }, 403);
  }

  return jsonResponse({ ok: true }, 200, {
    'Set-Cookie': buildSessionCookieHeader(request, '', 0),
  });
};
