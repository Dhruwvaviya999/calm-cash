// In-memory bridge between the module-level API client and the React authentication state.
//
// The CSRF token lives only in this module's memory: never in localStorage, sessionStorage, or a
// cookie readable by scripts. A page reload forgets it, and the auth provider fetches it again from
// the current-session endpoint (the session itself is an HttpOnly cookie the browser keeps).

export interface SessionHandlers {
  /** The API reported that the session is missing, expired, or revoked. */
  onSessionEnded: () => void;
  /** Re-reads the current session (and its CSRF token). Resolves true when still signed in. */
  refresh: () => Promise<boolean>;
}

let csrfToken: string | undefined;
let handlers: SessionHandlers | undefined;

export function getCsrfToken(): string | undefined {
  return csrfToken;
}

export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

/** Registers the auth provider's callbacks. Returns a function that unregisters them. */
export function registerSessionHandlers(next: SessionHandlers): () => void {
  handlers = next;
  return () => {
    if (handlers === next) {
      handlers = undefined;
    }
  };
}

export function notifySessionEnded(): void {
  csrfToken = undefined;
  handlers?.onSessionEnded();
}

export function refreshSession(): Promise<boolean> {
  return handlers === undefined ? Promise.resolve(false) : handlers.refresh();
}
