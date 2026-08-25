const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return inr.format(value);
}

export function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-IN').format(value);
}

/** "18 Aug" / "18 Aug 25" when the year differs from today's. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: '2-digit' }),
  });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  // SQLite timestamps come back as "YYYY-MM-DD HH:MM:SS" in UTC without a zone marker.
  const normalised = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
  const then = new Date(normalised).getTime();
  if (Number.isNaN(then)) return '';

  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'open':
      return 'Open now';
    case 'upcoming':
      return 'Upcoming';
    case 'closed':
      return 'Closed';
    case 'allotment':
      return 'Allotment';
    case 'listed':
      return 'Listed';
    default:
      return status;
  }
}

/** Colour class for a GMP figure — zero is neutral, not a loss. */
export function gmpTone(gmp: number | null | undefined): 'up' | 'down' | 'faint' {
  if (gmp === null || gmp === undefined || gmp === 0) return 'faint';
  return gmp > 0 ? 'up' : 'down';
}

/** "+45", "-12", or "—" when there is no premium quoted at all. */
export function gmpText(gmp: number | null | undefined): string {
  if (gmp === null || gmp === undefined) return '—';
  if (gmp === 0) return '0';
  return gmp > 0 ? `+${gmp}` : String(gmp);
}

/**
 * What one lot would be worth at the current grey market premium — GMP is quoted per share,
 * which is not the number an applicant actually cares about. Null when either input is
 * missing, since a lot size of zero would silently render a confident ₹0.
 */
export function gmpPerLot(gmp: number | null | undefined, lotSize: number | null | undefined): number | null {
  if (gmp === null || gmp === undefined || !lotSize) return null;
  return gmp * lotSize;
}

/** Signed currency, so a negative premium reads as a loss rather than an amount. */
export function signedMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value > 0 ? `+${money(value)}` : money(value);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
