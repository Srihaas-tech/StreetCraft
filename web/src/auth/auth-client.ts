import type { AuthenticatedSessionState, SessionStore } from './session-store';

export class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'invalid-credentials' | 'rate-limited' | 'request-failed' | 'invalid-response',
  ) {
    super(message);
    this.name = 'AuthRequestError';
  }
}

export interface AuthClient {
  login(password: string): Promise<AuthenticatedSessionState>;
  logout(): Promise<void>;
}

export interface AuthClientOptions {
  store: SessionStore;
  fetch?: typeof fetch;
  now?: () => number;
}

export function createAuthClient(options: AuthClientOptions): AuthClient {
  const fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const send = async (input: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetchRequest(input, init);
    } catch {
      throw new AuthRequestError('Authentication request failed', 0, 'request-failed');
    }
  };

  return {
    login: async (password) => {
      const response = await send('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        throw responseError(response.status);
      }

      const session = await readAuthenticatedSession(response, now);
      options.store.set(session);
      return session;
    },
    logout: async () => {
      try {
        const response = await send('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
        });
        if (!response.ok) {
          throw responseError(response.status);
        }
        const body = await readJson(response);
        if (!isAnonymousResponse(body)) {
          throw new AuthRequestError('Invalid authentication response', response.status, 'invalid-response');
        }
      } finally {
        options.store.clear();
      }
    },
  };
}

async function readAuthenticatedSession(
  response: Response,
  now: () => number,
): Promise<AuthenticatedSessionState> {
  const body = await readJson(response);
  if (
    typeof body !== 'object'
    || body === null
    || (body as { authenticated?: unknown }).authenticated !== true
    || typeof (body as { expiresAt?: unknown }).expiresAt !== 'number'
    || !Number.isFinite((body as { expiresAt: number }).expiresAt)
    || (body as { expiresAt: number }).expiresAt <= now()
  ) {
    throw new AuthRequestError('Invalid authentication response', response.status, 'invalid-response');
  }

  return {
    authenticated: true,
    expiresAt: (body as { expiresAt: number }).expiresAt,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new AuthRequestError('Invalid authentication response', response.status, 'invalid-response');
  }
}

function isAnonymousResponse(body: unknown): boolean {
  return typeof body === 'object'
    && body !== null
    && (body as { authenticated?: unknown }).authenticated === false;
}

function responseError(status: number): AuthRequestError {
  if (status === 401) {
    return new AuthRequestError('Authentication failed', status, 'invalid-credentials');
  }
  if (status === 429) {
    return new AuthRequestError('Too many authentication attempts', status, 'rate-limited');
  }
  return new AuthRequestError('Authentication request failed', status, 'request-failed');
}
