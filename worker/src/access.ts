/**
 * Identité Cloudflare Access (docs/specs/en-attente-de-reponse.md § 4.1).
 * Access place devant le Worker un JWT signé (`Cf-Access-Jwt-Assertion`). On vérifie la signature
 * avec les clés publiques de l'équipe (`https://<équipe>.cloudflareaccess.com/cdn-cgi/access/certs`),
 * l'émetteur, l'audience (`aud` de l'application Access) et les dates. Rien d'autre n'est cru.
 */

export interface AccessEnv {
  /** Domaine de l'équipe Access, ex. `monequipe.cloudflareaccess.com` (variable, pas un secret). */
  ACCESS_TEAM_DOMAIN?: string;
  /** Tag d'audience de l'application Access « Vigie » (variable, pas un secret). */
  ACCESS_AUD?: string;
}

/** Une personne (connexion par e-mail) ou un jeton de service (le pilote). */
export type AccessIdentity = { kind: 'user'; email: string } | { kind: 'service'; clientId: string };

export type AccessResult = { ok: true; identity: AccessIdentity } | { ok: false; reason: string };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

interface Jwk extends JsonWebKey {
  kid?: string;
}

const CERTS_TTL = 3_600_000;
/** Tolérance d'horloge sur `exp`, `nbf` et `iat`. */
const LEEWAY_S = 60;

let cache: { url: string; at: number; keys: Jwk[] } | null = null;

/** Pour les tests : oublie les clés gardées en mémoire. */
export const resetAccessCache = () => {
  cache = null;
};

/** `monequipe.cloudflareaccess.com` ou `https://monequipe.cloudflareaccess.com/` → `https://monequipe.cloudflareaccess.com`. */
export function teamIssuer(domain: string): string | null {
  const host = domain.trim().replace(/^https:\/\//, '').replace(/\/+$/, '');
  return /^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(host) ? `https://${host.toLowerCase()}` : null;
}

const b64urlBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const b64urlJson = (s: string): Record<string, unknown> => {
  const value = JSON.parse(new TextDecoder().decode(b64urlBytes(s))) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
  return value as Record<string, unknown>;
};

async function certs(issuer: string, fetchFn: FetchFn, now: number, force: boolean): Promise<Jwk[]> {
  const url = `${issuer}/cdn-cgi/access/certs`;
  if (!force && cache && cache.url === url && now - cache.at < CERTS_TTL) return cache.keys;
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`certs ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  cache = { url, at: now, keys };
  return keys;
}

/**
 * Vérifie le JWT d'Access. `now` en millisecondes. Ne lève jamais : un échec donne `{ ok: false }`
 * avec une raison courte (jamais le jeton lui-même).
 */
export async function verifyAccess(request: Request, env: AccessEnv, fetchFn: FetchFn, now: number): Promise<AccessResult> {
  const issuer = env.ACCESS_TEAM_DOMAIN ? teamIssuer(env.ACCESS_TEAM_DOMAIN) : null;
  const aud = env.ACCESS_AUD?.trim();
  if (!issuer || !aud) return { ok: false, reason: 'access_not_configured' };
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { ok: false, reason: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return { ok: false, reason: 'bad_alg' };

  let key: Jwk | undefined;
  try {
    key = (await certs(issuer, fetchFn, now, false)).find((k) => k.kid === header.kid);
    // Clé tournée depuis la dernière lecture : on relit une fois.
    if (!key) key = (await certs(issuer, fetchFn, now, true)).find((k) => k.kid === header.kid);
  } catch {
    return { ok: false, reason: 'certs_unavailable' };
  }
  if (!key || key.kty !== 'RSA') return { ok: false, reason: 'unknown_key' };

  let valid = false;
  try {
    const { kid: _kid, ...jwk } = key;
    const cryptoKey = await crypto.subtle.importKey('jwk', { ...jwk, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };

  if (payload.iss !== issuer) return { ok: false, reason: 'bad_issuer' };
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return { ok: false, reason: 'bad_audience' };
  const nowS = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + LEEWAY_S < nowS) return { ok: false, reason: 'expired' };
  if (typeof payload.nbf === 'number' && payload.nbf - LEEWAY_S > nowS) return { ok: false, reason: 'not_yet_valid' };
  if (typeof payload.iat === 'number' && payload.iat - LEEWAY_S > nowS) return { ok: false, reason: 'not_yet_valid' };

  if (typeof payload.email === 'string' && payload.email.includes('@')) return { ok: true, identity: { kind: 'user', email: payload.email } };
  if (typeof payload.common_name === 'string' && payload.common_name) return { ok: true, identity: { kind: 'service', clientId: payload.common_name } };
  return { ok: false, reason: 'no_identity' };
}

/** Comparaison en temps constant de deux chaînes (via leurs empreintes SHA-256, de même longueur). */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const ax = new Uint8Array(x);
  const ay = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i] ^ ay[i];
  return diff === 0;
}
