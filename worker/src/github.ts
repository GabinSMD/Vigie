/** Accès GitHub en lecture seule : JWT d'App, jeton d'installation par compte, appels REST. */

export interface GithubEnv {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  /** JSON : { "<compte>": <identifiant d'installation> }. */
  GITHUB_INSTALLATIONS: string;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const API = 'https://api.github.com';

const b64url = (data: ArrayBuffer | string): string => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function importKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.replace(/\\n/g, '\n');
  if (normalized.includes('BEGIN RSA PRIVATE KEY')) {
    throw new Error('Clé au format PKCS#1 : convertis-la en PKCS#8 (voir docs/mise-en-route.md).');
  }
  const body = normalized.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** JWT d'App GitHub (RS256), valable 9 minutes. */
export async function createAppJwt(appId: string, privateKeyPem: string, nowSeconds: number): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: appId }));
  const key = await importKey(privateKeyPem);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(signature)}`;
}

interface CachedToken {
  token: Promise<string>;
  expiresAt: number;
}

export class GithubClient {
  private tokens = new Map<string, CachedToken>();

  constructor(
    private env: GithubEnv,
    private doFetch: FetchFn,
    private now: () => number = () => Date.now(),
  ) {}

  private installationId(owner: string): number {
    let map: Record<string, number>;
    try {
      map = JSON.parse(this.env.GITHUB_INSTALLATIONS) as Record<string, number>;
    } catch {
      throw new Error('GITHUB_INSTALLATIONS n\'est pas un JSON valide.');
    }
    const id = map[owner];
    if (!id) throw new Error(`Aucune installation configurée pour le compte ${owner}.`);
    return id;
  }

  /** Un jeton par compte, partagé entre les appels simultanés (la promesse est mise en cache). */
  private token(owner: string): Promise<string> {
    const cached = this.tokens.get(owner);
    if (cached && cached.expiresAt - 60_000 > this.now()) return cached.token;
    const entry: CachedToken = { token: this.fetchToken(owner), expiresAt: this.now() + 55 * 60_000 };
    this.tokens.set(owner, entry);
    entry.token.catch(() => this.tokens.delete(owner));
    return entry.token;
  }

  private async fetchToken(owner: string): Promise<string> {
    const jwt = await createAppJwt(this.env.GITHUB_APP_ID, this.env.GITHUB_APP_PRIVATE_KEY, Math.floor(this.now() / 1000));
    const response = await this.doFetch(`${API}/app/installations/${this.installationId(owner)}/access_tokens`, {
      method: 'POST',
      headers: this.headers(jwt),
    });
    if (!response.ok) throw new Error(`github_${response.status}`);
    const data = (await response.json()) as { token: string; expires_at: string };
    const entry = this.tokens.get(owner);
    if (entry) entry.expiresAt = Date.parse(data.expires_at);
    return data.token;
  }

  private headers(bearer: string): Record<string, string> {
    return {
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'vigie-worker',
    };
  }

  /** GET en lecture seule. `path` commence par « / ». */
  async get<T>(owner: string, path: string): Promise<T> {
    const token = await this.token(owner);
    const response = await this.doFetch(`${API}${path}`, { headers: this.headers(token) });
    if (!response.ok) throw new Error(`github_${response.status}`);
    return (await response.json()) as T;
  }
}
