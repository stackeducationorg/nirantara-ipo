import Constants from 'expo-constants';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Dimensions, Easing, Image, Text, View } from 'react-native';

/**
 * Opening screen: the brand plate with snowflakes drifting down it, held briefly before the
 * app appears.
 *
 * Hand-placed rather than randomised, so the arrangement is stable between launches instead
 * of reshuffling. Each entry is [left %, size, fall seconds, initial delay seconds].
 */
const FLAKES: [number, number, number, number][] = [
  [6, 20, 5.2, 0],
  [17, 13, 6.6, 0.7],
  [29, 26, 4.6, 0.3],
  [41, 15, 7.0, 1.2],
  [53, 21, 5.4, 0.5],
  [65, 12, 6.2, 1.6],
  [77, 24, 4.9, 0.2],
  [88, 16, 6.8, 1.0],
];

const HOLD_MS = 5000;
const PLATE = '#1433d8';

function Flake({ left, size, duration, delay }: { left: number; size: number; duration: number; delay: number }) {
  const height = Dimensions.get('window').height;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: duration * 1000,
        delay: delay * 1000,
        easing: Easing.linear,
        // Transform and opacity both run on the UI thread, so the fall stays smooth even
        // while the JS thread is busy restoring the session.
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [progress, duration, delay]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-60, height + 60] });
  const translateX = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 16, 0] });
  const opacity = progress.interpolate({ inputRange: [0, 0.12, 0.85, 1], outputRange: [0, 0.85, 0.7, 0] });
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '220deg'] });

  return (
    <Animated.Text
      style={{
        position: 'absolute',
        left: `${left}%`,
        fontSize: size,
        color: '#ffffff',
        opacity,
        transform: [{ translateY }, { translateX }, { rotate }],
      }}
    >
      ❄
    </Animated.Text>
  );
}

export function SplashGate({ children }: { children: ReactNode }) {
  const [done, setDone] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const flakes = useMemo(() => FLAKES, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      // Fade out rather than cutting, so the hand-off to the app is not a jolt.
      Animated.timing(fade, { toValue: 0, duration: 420, useNativeDriver: true }).start(() =>
        setDone(true),
      );
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, [fade]);

  if (done) return <>{children}</>;

  const version = Constants.expoConfig?.version ?? '';

  return (
    <View style={{ flex: 1 }}>
      {/* Mounted underneath from the start, so it has finished its first paint by the time
          the splash clears and there is no blank frame between them. */}
      <View style={{ ...StyleSheetAbsolute }}>{children}</View>

      <Animated.View
        style={{
          ...StyleSheetAbsolute,
          opacity: fade,
          backgroundColor: PLATE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {flakes.map(([left, size, duration, delay], i) => (
          <Flake key={i} left={left} size={size} duration={duration} delay={delay} />
        ))}

        <Image
          source={require('../assets/icon.png')}
          style={{ width: 84, height: 84, borderRadius: 20, marginBottom: 20 }}
        />
        <Text style={{ color: '#ffffff', fontSize: 25, fontWeight: '700', letterSpacing: -0.5 }}>
          Nirantara IPO
        </Text>
        <Text style={{ color: 'rgba(255,255,255,.66)', fontSize: 13, marginTop: 7 }}>
          Allotment, GMP and money — in one place
        </Text>
        {version ? (
          <Text style={{ color: 'rgba(255,255,255,.42)', fontSize: 11.5, position: 'absolute', bottom: 34 }}>
            v{version}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** Inlined so the splash needs no StyleSheet import for a single repeated value. */
const StyleSheetAbsolute = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
