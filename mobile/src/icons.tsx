import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * Mirrors the web icon set on a 24px grid so both builds read as one product.
 * Colour comes from the `color` prop rather than a stylesheet, since RN has no `currentColor`.
 */
interface IconProps {
  size?: number;
  color: string;
  strokeWidth?: number;
}

const base = ({ size = 20, strokeWidth = 1.75 }: IconProps) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconList = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke={p.color} />
  </Svg>
);

export const IconTrend = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M22 7l-8.5 8.5-5-5L2 17M16 7h6v6" stroke={p.color} />
  </Svg>
);

export const IconTarget = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="9" stroke={p.color} />
    <Circle cx="12" cy="12" r="5" stroke={p.color} />
    <Circle cx="12" cy="12" r="1.5" stroke={p.color} />
  </Svg>
);

export const IconWallet = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path
      d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5M16 12h.01"
      stroke={p.color}
    />
  </Svg>
);

export const IconBell = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" stroke={p.color} />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M20 6 9 17l-5-5" stroke={p.color} />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" stroke={p.color} />
  </Svg>
);

export const IconInfo = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="9" stroke={p.color} />
    <Path d="M12 16v-4M12 8h.01" stroke={p.color} />
  </Svg>
);

export const IconClock = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="9" stroke={p.color} />
    <Path d="M12 7v5l3 2" stroke={p.color} />
  </Svg>
);

export const IconInbox = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path
      d="M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"
      stroke={p.color}
    />
  </Svg>
);

export const IconCalendar = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="3" y="4" width="18" height="18" rx="2" stroke={p.color} />
    <Path d="M16 2v4M8 2v4M3 10h18" stroke={p.color} />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="m9 18 6-6-6-6" stroke={p.color} />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path
      d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
      stroke={p.color}
    />
  </Svg>
);

export const IconCopy = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="9" y="9" width="12" height="12" rx="2" stroke={p.color} />
    <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke={p.color} />
  </Svg>
);

export const IconSun = (p: IconProps) => (
  <Svg {...base(p)}>
    <Circle cx="12" cy="12" r="4" stroke={p.color} />
    <Path
      d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
      stroke={p.color}
    />
  </Svg>
);

export const IconMoon = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" stroke={p.color} />
  </Svg>
);

export const IconMonitor = (p: IconProps) => (
  <Svg {...base(p)}>
    <Rect x="2" y="3" width="20" height="14" rx="2" stroke={p.color} />
    <Path d="M8 21h8M12 17v4" stroke={p.color} />
  </Svg>
);

export const IconUser = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke={p.color} />
    <Circle cx="12" cy="7" r="4" stroke={p.color} />
  </Svg>
);

export const IconLogout = (p: IconProps) => (
  <Svg {...base(p)}>
    <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke={p.color} />
  </Svg>
);
