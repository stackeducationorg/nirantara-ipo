import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AD_CLIENT } from '../ads';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

type Props = {
  /** `data-ad-slot` from the unit's snippet in the AdSense dashboard. Empty renders nothing. */
  slot: string;
  format?: string;
  className?: string;
};

/**
 * One AdSense unit.
 *
 * Google's copy-paste snippet assumes a page load per ad: it pushes to the `adsbygoogle` queue
 * once, inline, and never runs again. Neither assumption survives this app — routing is client
 * side, so navigating never reloads the document, and StrictMode runs every effect twice in
 * development. Both of those produce the same failure if the snippet is used as written, and
 * it is a silent one: AdSense refuses an <ins> it has already filled ("All ins elements in the
 * DOM with class=adsbygoogle already have ads in them") and the slot stays blank.
 *
 * So the push happens from an effect, guarded to fire once per element, and AdSlot re-keys
 * itself on navigation so each route gets a genuinely new element and a fresh request.
 */
function AdUnit({ slot, format = 'auto', className }: Props) {
  const ref = useRef<HTMLModElement>(null);
  const pushed = useRef(false);
  const [unfilled, setUnfilled] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const request = () => {
      if (pushed.current) return;
      pushed.current = true;
      try {
        (window.adsbygoogle = window.adsbygoogle ?? []).push({});
      } catch {
        // The loader is blocked (ad blocker, offline, consent tooling). Collapse and move on —
        // a failed ad must never be a broken-looking hole in the page.
        setUnfilled(true);
      }
    };

    // AdSense measures the element when the request is made and drops any slot that has no
    // width, without retrying. A mount before first paint hits that, so wait for real layout.
    if (el.offsetWidth > 0) {
      request();
      return;
    }

    const observer = new ResizeObserver(() => {
      if (el.offsetWidth > 0) {
        observer.disconnect();
        request();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // AdSense stamps the outcome onto the element. An unfilled slot keeps its reserved height
    // otherwise, leaving a labelled empty box above the footer.
    const observer = new MutationObserver(() => {
      const status = el.getAttribute('data-ad-status');
      if (status === 'unfilled') setUnfilled(true);
      else if (status === 'filled') setUnfilled(false);
    });
    observer.observe(el, { attributes: true, attributeFilter: ['data-ad-status'] });
    return () => observer.disconnect();
  }, []);

  return (
    <aside className={`ad-slot${className ? ` ${className}` : ''}`} hidden={unfilled}>
      <span className="ad-slot-label">Advertisement</span>
      <ins
        ref={ref}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={AD_CLIENT}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </aside>
  );
}

export function AdSlot(props: Props) {
  const { pathname } = useLocation();

  // No unit created in the dashboard yet: render nothing rather than an empty labelled frame.
  if (!props.slot) return null;

  // Remount per route so navigation requests a new ad instead of stranding the previous one.
  return <AdUnit key={`${pathname}:${props.slot}`} {...props} />;
}
