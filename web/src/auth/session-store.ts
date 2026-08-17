export interface AuthenticatedSessionState {
  authenticated: true;
  expiresAt: number;
}

export interface AnonymousSessionState {
  authenticated: false;
  expiresAt: null;
}

export type PublicSessionState = AuthenticatedSessionState | AnonymousSessionState;

export interface SessionStore {
  get(): PublicSessionState;
  set(session: AuthenticatedSessionState): void;
  clear(): void;
}

const ANONYMOUS_SESSION: AnonymousSessionState = {
  authenticated: false,
  expiresAt: null,
};

export function createSessionStore(now: () => number = Date.now): SessionStore {
  let state: PublicSessionState = ANONYMOUS_SESSION;

  return {
    get: () => {
      if (state.authenticated && state.expiresAt <= now()) {
        state = ANONYMOUS_SESSION;
      }
      return { ...state };
    },
    set: (session) => {
      state = Number.isFinite(session.expiresAt) && session.expiresAt > now()
        ? { authenticated: true, expiresAt: session.expiresAt }
        : ANONYMOUS_SESSION;
    },
    clear: () => {
      state = ANONYMOUS_SESSION;
    },
  };
}
