export const LOGIN_WINDOW_MS = 3 * 60 * 60 * 1000;
const key = "track3d-login-window";

// This is a browser reauthentication policy, never a replacement for Supabase tokens.
export function beginLoginWindow(userId, now = Date.now()) {
  const value = { userId, expiresAt: now + LOGIN_WINDOW_MS };
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  return value.expiresAt;
}

export function loginWindowExpiry(userId) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value?.userId === userId && Number.isFinite(value.expiresAt) ? value.expiresAt : null;
  } catch { return null; }
}

export function clearLoginWindow() {
  try { localStorage.removeItem(key); } catch {}
}