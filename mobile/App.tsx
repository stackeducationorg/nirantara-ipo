import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth';
import {
  IconBell,
  IconList,
  IconMonitor,
  IconMoon,
  IconSun,
  IconTarget,
  IconTrend,
  IconUser,
  IconWallet,
} from './src/icons';
import type { RootStackParamList, TabParamList } from './src/navigation';
import { AccountsScreen } from './src/screens/AccountsScreen';
import { AlertsScreen } from './src/screens/AlertsScreen';
import { AllotmentScreen } from './src/screens/AllotmentScreen';
import { GmpScreen } from './src/screens/GmpScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { IpoDetailScreen } from './src/screens/IpoDetailScreen';
import { MoneyScreen } from './src/screens/MoneyScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { ThemeProvider, useTheme, useThemeMode } from './src/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

const TAB_ICON = {
  IPOs: IconList,
  GMP: IconTrend,
  Allotment: IconTarget,
  Money: IconWallet,
  Accounts: IconUser,
  Alerts: IconBell,
} as const;

/** Cycles light -> dark -> system, mirroring the website's toggle. */
function ThemeButton() {
  const { mode, cycle } = useThemeMode();
  const t = useTheme();
  const Icon = mode === 'light' ? IconSun : mode === 'dark' ? IconMoon : IconMonitor;

  return (
    <Pressable onPress={cycle} hitSlop={12} style={{ paddingHorizontal: 6 }}>
      <Icon size={19} color={t.textDim} />
    </Pressable>
  );
}

function Tabs() {
  const t = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: t.bg },
        headerTitleStyle: { color: t.text, fontSize: 16 },
        headerShadowVisible: false,
        headerRight: () => <ThemeButton />,
        tabBarStyle: { backgroundColor: t.bg, borderTopColor: t.border },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.textFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        tabBarIcon: ({ color }) => {
          const Icon = TAB_ICON[route.name];
          return <Icon size={20} color={color} />;
        },
      })}
    >
      <Tab.Screen name="IPOs" component={HomeScreen} options={{ headerShown: false }} />
      <Tab.Screen name="GMP" component={GmpScreen} options={{ headerShown: false }} />
      <Tab.Screen name="Allotment" component={AllotmentScreen} options={{ headerShown: false }} />
      <Tab.Screen name="Money" component={MoneyScreen} options={{ headerShown: false }} />
      <Tab.Screen name="Accounts" component={AccountsScreen} options={{ headerShown: false }} />
      <Tab.Screen name="Alerts" component={AlertsScreen} options={{ headerShown: false }} />
    </Tab.Navigator>
  );
}

function Navigation() {
  const t = useTheme();
  const { resolved } = useThemeMode();

  const navTheme = {
    ...(resolved === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(resolved === 'dark' ? DarkTheme : DefaultTheme).colors,
      background: t.bg,
      card: t.surface,
      text: t.text,
      border: t.border,
      primary: t.accent,
    },
  };

  // Tapping an allotment push should land on that IPO, not just open the app.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const ipoId = response.notification.request.content.data?.ipoId as string | undefined;
      if (ipoId && navigationRef.isReady()) navigationRef.navigate('IpoDetail', { id: ipoId });
    });
    return () => sub.remove();
  }, []);

  return (
    <NavigationContainer theme={navTheme} ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTitleStyle: { color: t.text, fontSize: 16 },
          headerTintColor: t.accent,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen
          name="IpoDetail"
          component={IpoDetailScreen}
          options={({ route }) => ({ title: route.params?.name ?? 'IPO' })}
        />
      </Stack.Navigator>
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
    </NavigationContainer>
  );
}

function Gate() {
  const { account, loading } = useAuth();
  const t = useTheme();

  // Hold the first paint until the stored session resolves, so sign-in never flashes for an
  // already-authenticated user.
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  return account ? <Navigation /> : <SignInScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
