import { getDatabase } from './_lib/db';
import { getAdminPassword, getQrSecretKey, jsonResponse } from './_lib/security';
import { CloudflareEnv, PagesFunction } from './_lib/types';

export const onRequestGet: PagesFunction<CloudflareEnv> = async ({ env }) => {
  const db = await getDatabase(env).catch(() => null);
  return jsonResponse({
    ok: true,
    runtime: 'cloudflare-pages',
    dbReady: Boolean(db),
    authConfigured: Boolean(getAdminPassword(env) && getQrSecretKey(env)),
  });
};
