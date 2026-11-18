import {
  extractSessionToken,
  getQrSecretKey,
  jsonResponse,
  verifySessionToken,
} from '../_lib/security';
import { CloudflareEnv, PagesFunction } from '../_lib/types';

export const onRequestGet: PagesFunction<CloudflareEnv> = async ({ request, env }) => {
  const token = extractSessionToken(request);
  const authenticated = await verifySessionToken(token, getQrSecretKey(env));
  return jsonResponse({ authenticated });
};
