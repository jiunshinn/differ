import type {
  GithubDeviceCode,
  GithubOAuthConfig,
  GithubOAuthPollResult,
} from '../../shared/types';
import { addAccount } from './githubService';

// OAuth Device Flow against github.com. The client_id is loaded from the
// DIFFER_GITHUB_OAUTH_CLIENT_ID environment variable at runtime (main process).
// The client_id for an OAuth App is public information — safe to embed in
// official builds via build-time env. We don't hardcode it because Differ is
// open source; forks should register their own OAuth App.

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEFAULT_SCOPES = ['repo', 'read:org', 'read:user'];

interface ActiveFlow {
  deviceCode: string;
  expiresAt: number; // epoch ms
  minIntervalMs: number; // last-known polling interval (server may bump via slow_down)
  lastPollAt: number; // epoch ms of the last token-poll request to GitHub
  scopes: string[];
  // A granted access token that we received but could not yet durably persist
  // (probeUser failed transiently). Retried on the next poll instead of dropped.
  pendingToken: string | null;
}

let activeFlow: ActiveFlow | null = null;

function getClientId(): string | null {
  const id = (process.env.DIFFER_GITHUB_OAUTH_CLIENT_ID || '').trim();
  return id.length > 0 ? id : null;
}

function getScopes(): string[] {
  const raw = (process.env.DIFFER_GITHUB_OAUTH_SCOPES || '').trim();
  if (!raw) return DEFAULT_SCOPES;
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getOAuthConfig(): GithubOAuthConfig {
  const clientId = getClientId();
  return {
    configured: clientId !== null,
    clientIdPresent: clientId !== null,
    scopes: getScopes(),
  };
}

export async function startDeviceFlow(): Promise<GithubDeviceCode> {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error(
      'GitHub OAuth is not configured for this build. Set DIFFER_GITHUB_OAUTH_CLIENT_ID, or paste a personal access token instead.',
    );
  }
  const scopes = getScopes();
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ client_id: clientId, scope: scopes.join(' ') }),
  });
  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(`GitHub device code request failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
    error_description?: string;
  };
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error('GitHub returned an incomplete device code response');
  }
  const interval = Math.max(1, data.interval ?? 5);
  const expiresIn = data.expires_in ?? 900;
  activeFlow = {
    deviceCode: data.device_code,
    expiresAt: Date.now() + expiresIn * 1000,
    minIntervalMs: interval * 1000,
    lastPollAt: 0,
    scopes,
    pendingToken: null,
  };
  // Note: device_code is intentionally NOT returned to the renderer — it is a
  // credential (combined with the public client_id it can mint the access
  // token). The main process keeps it in activeFlow and pollDeviceFlow uses it.
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn,
    interval,
  };
}

export async function pollDeviceFlow(): Promise<GithubOAuthPollResult> {
  const clientId = getClientId();
  if (!clientId) {
    return { status: 'error', error: 'OAuth is not configured' };
  }
  const flow = activeFlow;
  if (!flow) {
    return { status: 'error', error: 'No active OAuth flow. Start sign-in again.' };
  }
  if (Date.now() > flow.expiresAt) {
    activeFlow = null;
    return { status: 'expired', error: 'The device code expired. Start sign-in again.' };
  }

  const intervalSeconds = Math.ceil(flow.minIntervalMs / 1000);

  // Enforce the (possibly raised) polling interval. If called too soon, return
  // pending without hitting GitHub (or re-probing) so we never trip slow_down
  // repeatedly.
  if (Date.now() < flow.lastPollAt + flow.minIntervalMs) {
    return { status: 'pending', nextIntervalSeconds: intervalSeconds };
  }
  flow.lastPollAt = Date.now();

  // If a previous poll obtained the access token but could not persist it (a
  // transient probeUser failure), retry persisting instead of polling GitHub
  // again — the token is already granted.
  if (flow.pendingToken) {
    return persistGrantedToken(flow, flow.pendingToken, intervalSeconds);
  }

  let res: Response;
  try {
    res = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: flow.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
  } catch (e) {
    return { status: 'error', error: (e as Error).message };
  }
  if (!res.ok) {
    const text = await safeText(res);
    return { status: 'error', error: `GitHub token poll failed (${res.status}): ${text}` };
  }
  const data = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
    interval?: number;
  };
  if (data.access_token) {
    return persistGrantedToken(flow, data.access_token, intervalSeconds);
  }
  switch (data.error) {
    case 'authorization_pending':
      return { status: 'pending', nextIntervalSeconds: intervalSeconds };
    case 'slow_down': {
      const next = Math.max(1, data.interval ?? 5);
      flow.minIntervalMs = next * 1000;
      return { status: 'slow_down', nextIntervalSeconds: next };
    }
    case 'expired_token':
      activeFlow = null;
      return { status: 'expired', error: 'The device code expired. Start sign-in again.' };
    case 'access_denied':
      activeFlow = null;
      return { status: 'denied', error: 'Authorization was denied.' };
    default:
      return {
        status: 'error',
        error: data.error_description || data.error || 'Unknown OAuth error',
      };
  }
}

// Persist a granted access token. If addAccount (which probes GET /user) fails
// transiently, keep the token in the flow's pendingToken so the next poll can
// retry rather than discarding an already-authorized grant and forcing the user
// to redo the whole device flow.
async function persistGrantedToken(
  flow: ActiveFlow,
  token: string,
  intervalSeconds: number,
): Promise<GithubOAuthPollResult> {
  try {
    const account = await addAccount(token);
    activeFlow = null;
    return { status: 'authorized', account };
  } catch (e) {
    flow.pendingToken = token;
    // Treat as transient: report pending so the renderer keeps polling and we
    // retry persisting on the next tick.
    return { status: 'pending', nextIntervalSeconds: intervalSeconds, error: (e as Error).message };
  }
}

export function cancelDeviceFlow(): void {
  activeFlow = null;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}
