import { useEffect } from 'react';

/**
 * Per-route document metadata.
 *
 * This is a client-rendered SPA, so index.html ships one static title for every URL. Google
 * does run JavaScript and will pick these up, but it renders in a second pass that can lag the
 * initial crawl by days — so treat this as the floor, not the ceiling. Prerendering the public
 * routes is what makes the metadata visible on the first pass.
 */

export const SITE_NAME = 'Nirantara IPO';
export const SITE_ORIGIN = 'https://www.nirantara.cloud';

/** Enough of the logo to satisfy link previews; replace with a designed 1200x630 card later. */
const DEFAULT_IMAGE = `${SITE_ORIGIN}/icon-512.png`;

export interface Seo {
  /** Shown in the tab and as the search result headline. Keep under ~60 characters. */
  title: string;
  /** The search snippet. Aim for 140–160 characters; longer gets truncated. */
  description: string;
  /** Path only, e.g. "/gmp". Prevents query strings splitting one page into many. */
  path?: string;
  image?: string;
  type?: 'website' | 'article';
  /** Keeps a page out of the index while still letting links on it be followed. */
  noindex?: boolean;
}

function upsertMeta(selector: string, attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function useSeo({ title, description, path, image, type = 'website', noindex }: Seo) {
  useEffect(() => {
    const url = path ? SITE_ORIGIN + path : undefined;
    const card = image ?? DEFAULT_IMAGE;

    document.title = title;
    upsertMeta('meta[name="description"]', 'name', 'description', description);
    upsertMeta(
      'meta[name="robots"]',
      'name',
      'robots',
      noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large',
    );

    upsertMeta('meta[property="og:title"]', 'property', 'og:title', title);
    upsertMeta('meta[property="og:description"]', 'property', 'og:description', description);
    upsertMeta('meta[property="og:type"]', 'property', 'og:type', type);
    upsertMeta('meta[property="og:site_name"]', 'property', 'og:site_name', SITE_NAME);
    upsertMeta('meta[property="og:image"]', 'property', 'og:image', card);
    if (url) upsertMeta('meta[property="og:url"]', 'property', 'og:url', url);

    upsertMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image');
    upsertMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title);
    upsertMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);
    upsertMeta('meta[name="twitter:image"]', 'name', 'twitter:image', card);

    // A canonical stops ?utm_source=… and ?ref=… being indexed as separate pages.
    if (url) upsertLink('canonical', url);
  }, [title, description, path, image, type, noindex]);
}

/**
 * Injects a JSON-LD block and removes it when the route changes.
 *
 * Structured data is what gets a result the rich treatment in search — a rating, a date, a
 * breadcrumb trail — rather than a plain blue link.
 */
export function useJsonLd(data: object | null) {
  // Depend on the serialised form, not the object: callers build the literal inline, so a new
  // identity every render would tear the script tag down and rebuild it on every paint.
  const json = data ? JSON.stringify(data) : null;

  useEffect(() => {
    if (!json) return;
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.textContent = json;
    document.head.appendChild(el);
    return () => el.remove();
  }, [json]);
}
