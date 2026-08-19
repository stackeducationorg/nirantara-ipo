import { call, post } from './api';
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

export interface Account {
  id: string;
  email: string | null;
  name: string | null;
  syncKey: string;
  createdAt: string;
}

type AuthResult = { token: string; account: Account };

export const api = {
  login: (email: string, password: string) =>
    post<AuthResult>('/auth/login', { email, password, platform: 'android' }),
  register: (email: string, password: string, name?: string) =>
    post<AuthResult>('/auth/register', { email, password, name, platform: 'android' }),
  pair: (syncKey: string) => post<AuthResult>('/auth/pair', { syncKey, platform: 'android' }),
  logout: () => post<{ ok: true }>('/auth/logout'),

  me: () => call<Account & { deviceCount: number; panCount: number }>('/auth/me'),

  dashboard: () => call<Dashboard>('/ipos/dashboard'),
  ipo: (id: string) => call<Ipo>(`/ipos/${id}`),
  gmpBoard: () => call<Ipo[]>('/ipos/gmp/live'),

  pans: () => call<Pan[]>('/pans'),
  addPan: (body: { pan: string; label: string }) => post<Pan>('/pans', body),
  updatePan: (id: string, body: Partial<{ label: string; isActive: boolean }>) =>
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
  registerPush: (body: { expoToken: string }) => post<{ ok: true }>('/notifications/register-push', body),

  applicationBoard: (ipoId: string) => call<ApplicationBoard>(`/applications/ipo/${ipoId}`),
  moneySummary: () => call<MoneySummary>('/applications/summary'),
  moneyByIpo: () => call<IpoMoneyRow[]>('/applications/by-ipo'),
  saveApplication: (ipoId: string, body: { panId: string; lots: number }) =>
    call<{ application: Application | null }>(`/applications/ipo/${ipoId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  applyAll: (ipoId: string, lots: number) =>
    post<Application[]>(`/applications/ipo/${ipoId}/apply-all`, { lots }),
  markRefund: (applicationId: string, received: boolean) =>
    post<Application>(`/applications/${applicationId}/refund`, { received }),
};
