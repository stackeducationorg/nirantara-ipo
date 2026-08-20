import { useEffect, useRef, useState } from 'react';

/**
 * Google Identity Services button.
 *
 * The button is rendered by Google's own script rather than styled here — Google requires it,
 * and it keeps the branding compliant. All this component does is load the script once, hand
 * Google a callback, and pass the resulting ID token upwards.
 *
 * The token is *not* trusted here. It is posted to the API, which verifies the signature and
 * audience against Google before it means anything.
 */

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

interface GoogleIdApi {
  accounts: {
    id: {
      initialize(config: { client_id: string; callback: (r: { credential: string }) => void }): void;
      renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const el = document.createElement('script');
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      // Let a later mount try again rather than caching the failure forever.
      scriptPromise = null;
      reject(new Error('Could not load Google sign-in'));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

export function GoogleButton({
  onCredential,
  disabled,
}: {
  onCredential: (idToken: string) => void;
  disabled?: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  // Kept in a ref so re-renders never re-initialise Google with a stale closure.
  const callback = useRef(onCredential);
  callback.current = onCredential;

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !holder.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => callback.current(response.credential),
        });
        window.google.accounts.id.renderButton(holder.current, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Without a client id configured there is nothing to show, and an empty box would just
  // look broken — so the whole block is omitted and email sign-in stands on its own.
  if (!CLIENT_ID) return null;

  if (failed) {
    return <p className="input-hint" style={{ textAlign: 'center' }}>Google sign-in is unavailable right now.</p>;
  }

  return (
    <div className="google-signin" style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <div ref={holder} />
    </div>
  );
}
