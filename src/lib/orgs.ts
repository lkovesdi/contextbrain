import { resolveMx } from "node:dns/promises";

// Free / personal email providers that don't represent an organization.
// Used to enforce the "work email only" rule when creating an org.
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
  "tuta.io",
]);

export type DomainCheck =
  | { ok: true; domain: string }
  | { ok: false; domain: string | null; reason: string };

/** Extract a lowercased domain from an email address, or null if malformed. */
export function parseEmailDomain(email: string): string | null {
  const at = email.trim().toLowerCase();
  const parts = at.split("@");
  if (parts.length !== 2) return null;
  const domain = parts[1];
  // Require at least one dot and no whitespace/empty labels.
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return domain;
}

export function isFreeEmailDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase());
}

/** True if the domain has MX records (i.e. can actually receive mail). */
export async function domainHasMx(domain: string): Promise<boolean> {
  try {
    const records = await resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

/**
 * Verify an email is a real *work* address: well-formed, not a free provider,
 * and its domain resolves to a real mail host (MX records). Runs DNS, so this
 * is server-only (Node runtime).
 */
export async function verifyWorkEmail(email: string): Promise<DomainCheck> {
  const domain = parseEmailDomain(email);
  if (!domain) {
    return { ok: false, domain: null, reason: "Enter a valid email address." };
  }
  if (isFreeEmailDomain(domain)) {
    return {
      ok: false,
      domain,
      reason: "Use your work email — personal email providers aren't supported for organizations.",
    };
  }
  if (!(await domainHasMx(domain))) {
    return {
      ok: false,
      domain,
      reason: `We couldn't verify ${domain}. Double-check your work email address.`,
    };
  }
  return { ok: true, domain };
}

/** Turn a domain into a sensible default org name: "acme-corp.io" → "Acme Corp". */
export function suggestOrgName(domain: string): string {
  const base = domain.split(".")[0] ?? domain;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
