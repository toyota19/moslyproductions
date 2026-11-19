import { getDatabase } from './_lib/db';
import {
  cleanEnvSecret,
  getAdminPassword,
  getQrSecretKey,
  jsonResponse,
} from './_lib/security';
import { CloudflareEnv, PagesFunction } from './_lib/types';

export const onRequestGet: PagesFunction<CloudflareEnv> = async ({ env }) => {
  const db = await getDatabase(env).catch(() => null);
  const hasAdminPassword = Boolean(getAdminPassword(env));
  const hasQrSecret = Boolean(getQrSecretKey(env));
  const hasResendKey = Boolean(cleanEnvSecret(env.RESEND_API_KEY));

  return jsonResponse({
    ok: true,
    runtime: 'cloudflare-worker',
    dbReady: Boolean(db),
    authConfigured: hasAdminPassword && hasQrSecret,
    hasAdminPassword,
    hasQrSecret,
    hasResendKey,
  });
};
