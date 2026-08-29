import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { clearToken, getToken, setToken } from './api';
import { api, type Account } from './queries';

interface AuthContextValue {
  account: Account | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  pair: (syncKey: string) => Promise<void>;
  googleSignIn: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    void (async () => {
      if (!(await getToken())) {
        setLoading(false);
        return;
      }
      try {
        setAccount(await api.me());
      } catch {
        await clearToken();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const adopt = useCallback(
    async (result: { token: string; account: Account }) => {
      await setToken(result.token);
      setAccount(result.account);
      // Nothing cached under the previous identity may leak into this one.
      queryClient.clear();
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
        await clearToken();
        setAccount(null);
        queryClient.clear();
      },
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
