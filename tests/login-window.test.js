import test from "node:test";
import assert from "node:assert/strict";
import { beginLoginWindow, clearLoginWindow, LOGIN_WINDOW_MS, loginWindowExpiry } from "../lib/login-window.js";

// The browser's local storage, as the app uses it.
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) },
});
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

test("a device stays signed in for 7 days from signing in", () => {
  assert.equal(LOGIN_WINDOW_MS, 7 * DAY);
  const now = Date.UTC(2026, 9, 6, 8);
  assert.equal(beginLoginWindow("user-1", now), now + 7 * DAY);
  assert.equal(loginWindowExpiry("user-1"), now + 7 * DAY);
  assert.equal(loginWindowExpiry("user-2"), null, "another account's sign-in doesn't count");
  clearLoginWindow();
  assert.equal(loginWindowExpiry("user-1"), null);
});

test("a device signed in before the change gets 7 days from its sign-in", () => {
  const signedIn = Date.now() - 2 * HOUR;
  // Saved under the 3-hour rule: only the end, 3 hours after sign-in.
  store.set("track3d-login-window", JSON.stringify({ userId: "user-1", expiresAt: signedIn + 3 * HOUR }));
  assert.equal(loginWindowExpiry("user-1"), signedIn + 7 * DAY);
  store.set("track3d-login-window", "not json");
  assert.equal(loginWindowExpiry("user-1"), null);
  store.set("track3d-login-window", JSON.stringify({ userId: "user-1" }));
  assert.equal(loginWindowExpiry("user-1"), null);
});
