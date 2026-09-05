/**
 * AdSense configuration.
 *
 * The loader script lives in index.html; this file is only about which units get requested.
 *
 * Slot IDs come from AdSense → Ads → By ad unit. Create a unit, copy the `data-ad-slot`
 * number out of the snippet it gives you, and paste it here — the rest of the snippet is
 * already handled by <AdSlot>. A slot left empty renders nothing at all, which is the point:
 * the placements below are live in the code before the units exist in the dashboard, and no
 * empty boxes appear on the site in the meantime.
 */

export const AD_CLIENT = 'ca-pub-3938222693637430';

export const AD_SLOTS = {
  /** Below the board on /gmp. */
  gmpBoard: '',
  /** Below the issue detail on /ipo/:id. */
  ipoDetail: '',
  /** Below the guide on /ipo-allotment-status. */
  allotmentGuide: '',
} as const;
