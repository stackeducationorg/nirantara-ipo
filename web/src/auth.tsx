import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, clearToken, getToken, setToken } from './api';

export interface Account {
  id: string;
  email: string | null;
  name: string | null;
  syncKey: string;
  createdAt: string;
}

interface AuthContextValue {
  account: Account | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  pair: (syncKey: string) => Promise<void>;
  googleSignIn: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  // Restore the session on boot; an expired token simply lands the user on the sign-in screen.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((me) => setAccount(me))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const adopt = useCallback(
    (result: { token: string; account: Account }) => {
      setToken(result.token);
      setAccount(result.account);
      // Anything cached under the previous identity must not leak into this one.
      void queryClient.clear();
    },
    [queryClient],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      account,
      loading,
      login: async (email, password) => adopt(await api.login(email, password)),
      register: async (email, password, name) => adopt(await api.register(email, password, name)),
      pair: async (syncKey) => adopt(await api.pair(syncKey)),
      googleSignIn: async (idToken) => adopt(await api.google(idToken)),
      logout: async () => {
        await api.logout().catch(() => {});
        clearToken();
        setAccount(null);
        queryClient.clear();
      },
      refresh: async () => setAccount(await api.me()),
    }),
    [account, loading, adopt, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
