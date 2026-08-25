import type {
  Application,
  ApplicationBoard,
  IpoMoneyRow,
  MoneySummary,
  AlertPrefs,
  AllotmentHistoryRow,
  AllotmentSummary,
  AppNotification,
  Dashboard,
  Ipo,
  Pan,
} from './types';

const BASE = import.meta.env.VITE_API_BASE ?? '/api';
const TOKEN_KEY = 'niranthar.token';

/**
 * Absolute URL for a proxied company logo.
 *
 * This has to be built from BASE like every other call. A bare `/api/...` resolves against
 * the page's own origin, which works in dev only because Vite proxies it — in production the
 * frontend and the API are on different hosts, so the request hits the static site and 404s.
 */
export function logoSrc(upstreamUrl: string): string {
  return `${BASE}/media/logo?u=${encodeURIComponent(upstreamUrl)}`;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  const text = await res.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const message = (payload as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return payload as T;
}

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

interface Account {
  id: string;
  email: string | null;
  name: string | null;
  syncKey: string;
  createdAt: string;
}

type AuthResult = { token: string; account: Account };

export const api = {
  login: (email: string, password: string) =>
    post<AuthResult>('/auth/login', { email, password, platform: 'web' }),
  register: (email: string, password: string, name?: string) =>
    post<AuthResult>('/auth/register', { email, password, name, platform: 'web' }),
  pair: (syncKey: string) => post<AuthResult>('/auth/pair', { syncKey, platform: 'web' }),
  google: (idToken: string) => post<AuthResult>('/auth/google', { idToken, platform: 'web' }),
  logout: () => post<{ ok: true }>('/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: true }>('/auth/change-password', { currentPassword, newPassword }),

  me: () => call<Account & { deviceCount: number; panCount: number }>('/auth/me'),

  /** Public: what the current release is, used by the download page. */
  appVersion: () =>
    call<{ minVersion: string; latestVersion: string; downloadUrl: string; message?: string }>(
      '/app/version',
    ),

  dashboard: () => call<Dashboard>('/ipos/dashboard'),
  ipos: (params?: { status?: string; category?: string }) => {
    const q = new URLSearchParams();
    if (params?.status && params.status !== 'all') q.set('status', params.status);
    if (params?.category && params.category !== 'all') q.set('category', params.category);
    const qs = q.toString();
    return call<Ipo[]>(`/ipos${qs ? `?${qs}` : ''}`);
  },
  ipo: (id: string) => call<Ipo>(`/ipos/${id}`),
  gmpBoard: () => call<Ipo[]>('/ipos/gmp/live'),

  pans: () => call<Pan[]>('/pans'),
  addPan: (body: { pan?: string; label: string; holderName?: string; demat?: string }) =>
    post<Pan>('/pans', body),
  updatePan: (
    id: string,
    body: Partial<{ label: string; holderName: string | null; isActive: boolean; demat: string | null }>,
  ) =>
    call<Pan>(`/pans/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deletePan: (id: string) => call<{ ok: true }>(`/pans/${id}`, { method: 'DELETE' }),

  allotmentHistory: () => call<AllotmentHistoryRow[]>('/allotment'),
  allotment: (ipoId: string) => call<AllotmentSummary>(`/allotment/${ipoId}`),
  checkAllotment: (ipoId: string) => post<AllotmentSummary>(`/allotment/${ipoId}/check`),

  notifications: () => call<AppNotification[]>('/notifications'),
  unreadCount: () => call<{ count: number }>('/notifications/unread-count'),
  markRead: (id?: string) => post<{ ok: true }>('/notifications/read', id ? { id } : {}),
  prefs: () => call<AlertPrefs>('/notifications/prefs'),
  savePrefs: (body: Record<string, boolean | number>) =>
    call<AlertPrefs>('/notifications/prefs', { method: 'PUT', body: JSON.stringify(body) }),
  vapidKey: () => call<{ key: string | null }>('/notifications/vapid-key'),
  registerPush: (body: { expoToken?: string; webPushSubscription?: unknown }) =>
    post<{ ok: true }>('/notifications/register-push', body),

  applicationBoard: (ipoId: string) => call<ApplicationBoard>(`/applications/ipo/${ipoId}`),
  moneySummary: () => call<MoneySummary>('/applications/summary'),
  moneyByIpo: () => call<IpoMoneyRow[]>('/applications/by-ipo'),
  saveApplication: (ipoId: string, body: { panId: string; lots: number; category?: string }) =>
    call<{ application: Application | null }>(`/applications/ipo/${ipoId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  applyAll: (ipoId: string, lots: number) =>
    post<Application[]>(`/applications/ipo/${ipoId}/apply-all`, { lots }),
  /** Settles every outstanding refund for one IPO in a single call. */
  markIpoRefund: (ipoId: string, received = true) =>
    post<{ ok: true; updated: number }>(`/applications/ipo/${ipoId}/refund`, { received }),
  markRefund: (applicationId: string, received: boolean) =>
    post<Application>(`/applications/${applicationId}/refund`, { received }),

  watchlist: () => call<{ id: string; name: string; status: string }[]>('/watchlist'),
  watch: (ipoId: string) => call<{ watching: boolean }>(`/watchlist/${ipoId}`, { method: 'PUT' }),
  unwatch: (ipoId: string) => call<{ watching: boolean }>(`/watchlist/${ipoId}`, { method: 'DELETE' }),
};
