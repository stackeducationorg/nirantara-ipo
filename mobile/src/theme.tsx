import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

/** Palette mirrors the website's tokens so both builds read as one product. */
const light = {
  bg: '#ffffff',
  bgSubtle: '#fafafa',
  surface: '#ffffff',
  surface2: '#f4f4f5',
  surface3: '#ebebed',
  border: '#e4e4e7',
  text: '#09090b',
  textDim: '#52525b',
  textFaint: '#8b8b94',
  accent: '#e0483d',
  accentSubtle: '#fdeceb',
  pos: '#12864c',
  posSubtle: '#e7f6ee',
  neg: '#c8324a',
  negSubtle: '#fdebee',
  warn: '#a1660b',
  warnSubtle: '#fdf4e3',
  info: '#2563c9',
  infoSubtle: '#eaf1fd',
};

const dark: typeof light = {
  bg: '#0a0a0b',
  bgSubtle: '#0f0f11',
  surface: '#141416',
  surface2: '#1c1c1f',
  surface3: '#26262a',
  border: '#232326',
  text: '#fafafa',
  textDim: '#a1a1aa',
  textFaint: '#6f6f78',
  accent: '#f0564a',
  accentSubtle: '#2a1512',
  pos: '#3ddc84',
  posSubtle: '#10261a',
  neg: '#ff6b7f',
  negSubtle: '#2a1219',
  warn: '#f5b950',
  warnSubtle: '#2a2010',
  info: '#6ea8fe',
  infoSubtle: '#12203a',
};

export type Theme = typeof light;
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'niranthar.theme';

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') setModeState(stored);
    });
  }, []);

  const resolved = mode === 'system' ? system : mode;

  const value = useMemo<ThemeContextValue>(() => {
    const setMode = (next: ThemeMode) => {
      setModeState(next);
      void AsyncStorage.setItem(STORAGE_KEY, next);
    };
    return {
      theme: resolved === 'dark' ? dark : light,
      mode,
      resolved,
      setMode,
      cycle: () => {
        const order: ThemeMode[] = ['light', 'dark', 'system'];
        setMode(order[(order.indexOf(mode) + 1) % order.length]);
      },
    };
  }, [mode, resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeMode(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeMode must be used inside ThemeProvider');
  return ctx;
}

export function useTheme(): Theme {
  return useThemeMode().theme;
}

export const statusColor = (t: Theme, status: string): { bg: string; fg: string } => {
  switch (status) {
    case 'open':
      return { bg: t.posSubtle, fg: t.pos };
    case 'upcoming':
      return { bg: t.infoSubtle, fg: t.info };
    case 'allotment':
      return { bg: t.warnSubtle, fg: t.warn };
    default:
      return { bg: t.surface3, fg: t.textDim };
  }
};
