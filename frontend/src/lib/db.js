// Offline-first outbox. Every transition is written here first with a
// client-generated UUID, then flushed to the server. If the device is offline
// the record stays queued and syncs later. The server dedupes on client_uuid,
// so a replayed flush is harmless.
import Dexie from "dexie";
import { api } from "./api.js";

export const db = new Dexie("inventory");
db.version(1).stores({
  // client_uuid is the primary key; synced is 0 or 1 for indexed filtering.
  outbox: "client_uuid, assetId, synced, createdAt",
});

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Queue a transition. `fields` = {action, counterparty, job_ref, note,
// latitude, longitude}. `photoBlob` is an optional captured image.
export async function enqueueTransition(assetId, fields, photoBlob) {
  const client_uuid = uuid();
  await db.outbox.add({
    client_uuid,
    assetId,
    fields,
    photoBlob: photoBlob || null,
    synced: 0,
    createdAt: Date.now(),
  });
  // Try to send immediately; ignore failure (it stays queued).
  flushOutbox().catch(() => {});
  return client_uuid;
}

let flushing = false;

export async function flushOutbox() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const pending = await db.outbox.where("synced").equals(0).sortBy("createdAt");
    for (const item of pending) {
      const fd = new FormData();
      fd.append("action", item.fields.action);
      fd.append("client_uuid", item.client_uuid);
      for (const k of ["counterparty", "job", "job_ref", "due_at", "note", "latitude", "longitude"]) {
        if (item.fields[k] !== undefined && item.fields[k] !== null && item.fields[k] !== "") {
          fd.append(k, item.fields[k]);
        }
      }
      if (item.photoBlob) fd.append("photo", item.photoBlob, "photo.jpg");
      try {
        await api.transition(item.assetId, fd);
        await db.outbox.update(item.client_uuid, { synced: 1 });
      } catch (e) {
        // 4xx means the server rejected it permanently (e.g. illegal
        // transition); mark synced so it stops retrying. Network/5xx: keep.
        if (e.status && e.status >= 400 && e.status < 500) {
          await db.outbox.update(item.client_uuid, { synced: 1, error: e.message });
        } else {
          break; // offline or server down; stop and retry later
        }
      }
    }
  } finally {
    flushing = false;
  }
}

export async function pendingCount() {
  return db.outbox.where("synced").equals(0).count();
}

// Flush whenever connectivity returns.
window.addEventListener("online", () => flushOutbox().catch(() => {}));
