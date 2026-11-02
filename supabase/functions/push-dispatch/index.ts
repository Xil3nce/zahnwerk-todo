// Versendet offene Eintraege aus notification_log ueber FCM HTTP v1.
// Aufgerufen von Postgres (pg_net) mit dem Header x-push-secret.
import { createClient } from 'npm:@supabase/supabase-js@2';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface LogRow {
  id: number;
  recipient_id: string;
  kind: string;
  todo_id: string | null;
  title: string;
  body: string;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let cachedToken: { value: string; expiresAt: number } | null = null;

const base64Url = (data: ArrayBuffer | string): string => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function getAccessToken(account: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const der = Uint8Array.from(
    atob(account.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '')),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );

  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(
    JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }),
  )}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${base64Url(signature)}`,
    }),
  });
  if (!response.ok) throw new Error(`OAuth ${response.status}`);
  const json = await response.json();
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

type SendResult = 'ok' | 'invalid-token' | 'retry';

async function send(account: ServiceAccount, accessToken: string, token: string, row: LogRow): Promise<SendResult> {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: row.title, body: row.body },
        data: { kind: row.kind, todo_id: row.todo_id ?? '' },
        android: {
          priority: 'high',
          ttl: row.kind === 'due' ? '43200s' : '604800s',
          notification: {
            channel_id: 'zahnwerk',
            icon: 'ic_notification',
            // Gleiches Tag ersetzt die vorige Meldung, damit nach Offline-Phasen keine Flut entsteht.
            tag: row.todo_id ?? row.kind,
          },
        },
      },
    }),
  });
  if (response.ok) return 'ok';

  const error = await response.json().catch(() => null);
  const status = error?.error?.status;
  const details = JSON.stringify(error?.error?.details ?? []);
  console.error('FCM', response.status, status);
  if (status === 'UNREGISTERED' || response.status === 404) return 'invalid-token';
  // INVALID_ARGUMENT kann auch den Payload betreffen; nur ein bemaengeltes Token zaehlt.
  if (status === 'INVALID_ARGUMENT' && details.includes('message.token')) return 'invalid-token';
  return 'retry';
}

Deno.serve(async (req) => {
  if (req.headers.get('x-push-secret') !== Deno.env.get('PUSH_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }

  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  const adminKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(Deno.env.get('SUPABASE_URL')!, adminKey, { auth: { persistSession: false } });

  const { data: rows, error } = await db.rpc('claim_notifications', { p_limit: 100 });
  if (error) return new Response(error.message, { status: 500 });
  if (!rows?.length) return Response.json({ sent: 0 });

  const account: ServiceAccount = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT')!);
  const accessToken = await getAccessToken(account);

  let sent = 0;
  for (const row of rows as LogRow[]) {
    const { data: devices } = await db.from('device_tokens').select('token').eq('profile_id', row.recipient_id);
    let needsRetry = false;
    for (const { token } of devices ?? []) {
      const result = await send(account, accessToken, token, row);
      if (result === 'ok') sent++;
      if (result === 'retry') needsRetry = true;
      if (result === 'invalid-token') await db.from('device_tokens').delete().eq('token', token);
    }
    // Ohne Geraet gibt es nichts nachzuholen; der Eintrag gilt dann als erledigt.
    await db.from('notification_log')
      .update(needsRetry ? { claimed_at: null } : { sent_at: new Date().toISOString() })
      .eq('id', row.id);
  }
  return Response.json({ sent });
});
