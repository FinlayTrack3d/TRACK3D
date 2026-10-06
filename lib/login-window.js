// How long a device stays signed in after signing in with a password.
export const LOGIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Saved windows from before 7 days held only their end, 3 hours after sign-in.
const EARLIER_WINDOW_MS = 3 * 60 * 60 * 1000;
const key = "track3d-login-window";

// This is a browser reauthentication policy, never a replacement for Supabase tokens.
export function beginLoginWindow(userId, now = Date.now()) {
  const value = { userId, startedAt: now, expiresAt: now + LOGIN_WINDOW_MS };
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  return value.expiresAt;
}

// The window runs from sign-in, so a change to its length also applies to
// devices already signed in.
export function loginWindowExpiry(userId) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (value?.userId !== userId) return null;
    const startedAt = Number.isFinite(value.startedAt) ? value.startedAt : Number.isFinite(value.expiresAt) ? value.expiresAt - EARLIER_WINDOW_MS : null;
    return startedAt === null ? null : startedAt + LOGIN_WINDOW_MS;
  } catch { return null; }
}

export function clearLoginWindow() {
  try { localStorage.removeItem(key); } catch {}
}
