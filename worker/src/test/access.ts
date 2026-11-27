/**
 * Équipe Cloudflare Access simulée : une paire de clés RSA générée à chaque exécution des tests
 * (aucune clé réelle), ses certificats publics, et des JWT signés comme ceux d'Access.
 */

export const TEAM = 'equipe-test.cloudflareaccess.com';
export const ISSUER = `https://${TEAM}`;
export const AUD = 'aud-de-test-vigie';
export const CERTS_URL = `${ISSUER}/cdn-cgi/access/certs`;

const b64url = (bytes: Uint8Array | string) => {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export interface TestTeam {
  certs: { keys: JsonWebKey[] };
  sign: (payload: Record<string, unknown>, opts?: { kid?: string; alg?: string }) => Promise<string>;
}

export async function makeTeam(kid = 'kid-test-1'): Promise<TestTeam> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return {
    certs: { keys: [{ ...pub, kid, alg: 'RS256', use: 'sig' } as JsonWebKey] },
    sign: async (payload, opts = {}) => {
      const header = b64url(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? kid, typ: 'JWT' }));
      const body = b64url(JSON.stringify(payload));
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${body}`));
      return `${header}.${body}.${b64url(new Uint8Array(sig))}`;
    },
  };
}

/** Charge utile d'un JWT d'Access valide à `nowMs`, pour une personne ou un jeton de service. */
export function claims(nowMs: number, who: { email: string } | { common_name: string }, extra: Record<string, unknown> = {}) {
  const now = Math.floor(nowMs / 1000);
  return { iss: ISSUER, aud: [AUD], iat: now - 10, nbf: now - 10, exp: now + 3600, sub: 'sub-test', ...who, ...extra };
}
