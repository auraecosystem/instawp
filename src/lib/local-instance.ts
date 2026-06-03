import type { LocalInstance } from '../types.js';

/** Lowercase a name and replace any non `[a-zA-Z0-9_-]` char with `-`. */
export function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

/**
 * Default local-instance name for a cloned cloud site.
 *
 * Prefers the site's name; otherwise the FIRST DNS label of its
 * subdomain/domain — so "client-store-1234.instawp.site" becomes
 * "client-store-1234", NOT "client-store-1234-instawp-site" (the old behavior,
 * which sanitized the whole domain and turned the dots into hyphens). Falls
 * back to "site-<id>".
 */
export function defaultInstanceName(site: { id: number; name?: string; sub_domain?: string }): string {
  const fromName = (site.name || '').trim();
  const fromLabel = (site.sub_domain || '').split('.')[0];
  return sanitizeName(fromName || fromLabel || `site-${site.id}`);
}

/**
 * Which cloud site a `local push` should target, in priority order:
 *   1. an explicit cloud-site argument
 *   2. the cloud site this instance was cloned from (`cloudSiteId`)
 *   3. none — the caller provisions a new site
 *
 * This is why a `local clone` records `cloudSiteId`: so a later `local push`
 * with no argument pushes back to the ORIGIN site instead of creating a new
 * one named after the local instance.
 */
export function pushTargetRef(
  cloudSiteArg: string | undefined,
  instance: Pick<LocalInstance, 'cloudSiteId'>,
): string | undefined {
  if (cloudSiteArg && cloudSiteArg.trim()) return cloudSiteArg.trim();
  if (instance.cloudSiteId) return String(instance.cloudSiteId);
  return undefined;
}
