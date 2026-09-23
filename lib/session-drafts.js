import { useEffect, useLayoutEffect, useRef, useState } from "react";

const DAY = 24 * 60 * 60 * 1000;
const DB_NAME = "track3d-session-drafts";
const keyFor = (userId, kind) => userId + ":" + kind;
const mirrorKey = (userId, kind) => DB_NAME + ':' + keyFor(userId, kind);
const queues = new Map();

// A synchronous mirror protects the most recent committed render during reload.
export function mirrorDraft(userId, kind, data) {
  localStorage.setItem(mirrorKey(userId, kind), JSON.stringify({ version: 1, userId, updatedAt: Date.now(), expiresAt: kind === 'fitness' ? null : Date.now() + DAY, data }));
}

async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readDraft(userId, kind) {
  try {
    const mirror = JSON.parse(localStorage.getItem(mirrorKey(userId, kind)));
    if (mirror?.version === 1 && mirror.userId === userId && (mirror.expiresAt === null || mirror.expiresAt > Date.now())) return mirror.data;
  } catch { /* IndexedDB is the fallback when local storage is unavailable. */ }
  await queues.get(keyFor(userId, kind))?.catch(() => {});
  const db = await database();
  try {
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction("drafts").objectStore("drafts").get(keyFor(userId, kind));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return value?.version === 1 && value.userId === userId && (kind === 'fitness' || value.expiresAt > Date.now()) ? value.data : null;
  } finally { db.close(); }
}

async function writeDatabaseDraft(userId, kind, data) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite");
      const store = transaction.objectStore("drafts");
      if (data) store.put({ version: 1, userId, expiresAt: Date.now() + DAY, data }, keyFor(userId, kind));
      else store.delete(keyFor(userId, kind));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export function writeDraft(userId, kind, data) {
  const key = keyFor(userId, kind);
  const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(() => writeDatabaseDraft(userId, kind, data));
  queues.set(key, next);
  return next;
}

// Signing out must not lose an in-progress workout: the fitness draft is
// deliberately left alone here so that logging back in as the same user
// (readDraft is keyed by userId) drops straight back into the active
// workout, mid-set. Only the morning draft is cleared on sign-out.
export async function clearDrafts(userId) {
  try { mirrorDraft(userId, 'morning', null); } catch {}
  await writeDraft(userId, 'morning', null);
}

export function useSessionDraft(userId, kind, snapshot, restore) {
  const [readyUser, setReadyUser] = useState(null);
  const restoreRef = useRef(restore);
  useEffect(() => { restoreRef.current = restore; }, [restore]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    readDraft(userId, kind).then(data => {
      if (!cancelled && data) restoreRef.current(data);
    }).catch(() => {
      // The current session still works when browser storage is unavailable.
    }).finally(() => { if (!cancelled) setReadyUser(userId); });
    return () => { cancelled = true; };
  }, [userId, kind]);

  useLayoutEffect(() => {
    if (!userId || readyUser !== userId) return;
    window.dispatchEvent(new CustomEvent("track3d-active-session", {
      detail: { userId, kind, active: Boolean(snapshot) },
    }));
    let mirrored = false;
    try { mirrorDraft(userId, kind, snapshot); mirrored = true; } catch {
      // Do not leave an older mirror masking a newer IndexedDB snapshot.
      try { localStorage.removeItem(mirrorKey(userId, kind)); } catch {}
    }
    writeDraft(userId, kind, snapshot).catch(() => {
      if (!mirrored) window.dispatchEvent(new CustomEvent("track3d-draft-error", { detail: { userId } }));
    });
  }, [userId, kind, snapshot, readyUser]);
}
