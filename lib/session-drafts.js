import { useEffect, useRef, useState } from "react";

const DAY = 24 * 60 * 60 * 1000;
const DB_NAME = "track3d-session-drafts";
const keyFor = (userId, kind) => userId + ":" + kind;

async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readDraft(userId, kind) {
  const db = await database();
  try {
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction("drafts").objectStore("drafts").get(keyFor(userId, kind));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return value?.version === 1 && value.userId === userId && value.expiresAt > Date.now() ? value.data : null;
  } finally { db.close(); }
}

export async function writeDraft(userId, kind, data) {
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

export async function clearDrafts(userId) {
  await Promise.all(["morning", "fitness"].map(kind => writeDraft(userId, kind, null)));
}

export function useSessionDraft(userId, kind, snapshot, restore) {
  const [readyUser, setReadyUser] = useState(null);
  const restoreRef = useRef(restore);
  const writeQueue = useRef(Promise.resolve());
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

  useEffect(() => {
    if (!userId || readyUser !== userId) return;
    window.dispatchEvent(new CustomEvent("track3d-active-session", {
      detail: { userId, kind, active: Boolean(snapshot) },
    }));
    writeQueue.current = writeQueue.current.catch(() => {}).then(() => writeDraft(userId, kind, snapshot));
    writeQueue.current.catch(() => {
      window.dispatchEvent(new CustomEvent("track3d-draft-error", { detail: { userId } }));
    });
  }, [userId, kind, snapshot, readyUser]);
}