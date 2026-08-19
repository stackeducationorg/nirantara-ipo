import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

/** Screens on the root stack. Tabs are nested underneath `Tabs`. */
export type RootStackParamList = {
  Tabs: { screen?: keyof TabParamList } | undefined;
  IpoDetail: { id: string; name?: string | null };
};

export type TabParamList = {
  IPOs: undefined;
  GMP: undefined;
  Allotment: undefined;
  Money: undefined;
  Accounts: undefined;
  Alerts: undefined;
};

export type RootNavigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * Tab screens live inside the stack, so they can push IpoDetail even though it is not one of
 * their own routes. Reading navigation from the hook (rather than props) keeps every screen a
 * plain zero-prop component, which is what the navigators expect.
 */
export function useAppNavigation(): RootNavigation {
  return useNavigation<RootNavigation>();
}
