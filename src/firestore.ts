// ── Firestore ────────────────────────────────────────────────────────────────
// Firebase Admin SDK initialisation for Phoebe ↔ mume-web sync.
// Only initialised when FIREBASE_SERVICE_ACCOUNT_KEY is set.

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import {
  FIREBASE_SERVICE_ACCOUNT_KEY,
  FIREBASE_UID,
  PHOEBE_INSTANCE_ID,
  FIRESTORE_ROOT,
} from "./config.js";
import log from "./logger.js";

// ── State ────────────────────────────────────────────────────────────────────

let db: Firestore | null = null;

export function isFirestoreEnabled(): boolean {
  return db !== null;
}

export function getDb(): Firestore {
  if (!db) throw new Error("Firestore not initialised");
  return db;
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initFirestore(): boolean {
  if (!FIREBASE_SERVICE_ACCOUNT_KEY || !FIREBASE_UID || !PHOEBE_INSTANCE_ID) {
    log.info(
      "firestore",
      "skipped — missing FIREBASE_SERVICE_ACCOUNT_KEY, FIREBASE_UID, or PHOEBE_INSTANCE_ID",
    );
    return false;
  }

  try {
    const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_KEY);
    if (!getApps().length) {
      initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    }
    db = getFirestore();
    db.settings({ ignoreUndefinedProperties: true });
    log.info("firestore", "connected");
    return true;
  } catch (err) {
    log.error("firestore", "init failed", { err: (err as Error).message });
    return false;
  }
}

// ── Path Helpers ─────────────────────────────────────────────────────────────

export function instancePath(): string {
  return `${FIRESTORE_ROOT}/phoebe/${PHOEBE_INSTANCE_ID}`;
}

export function sessionsPath(): string {
  return `${instancePath()}/sessions`;
}

export function chatsPath(sessionId: string): string {
  return `${sessionsPath()}/${sessionId}/chats`;
}

export function messagesPath(sessionId: string, chatId: string): string {
  return `${chatsPath(sessionId)}/${chatId}/messages`;
}

export function statusDocPath(sessionId: string, chatId: string): string {
  return `${chatsPath(sessionId)}/${chatId}/status/current`;
}

export { Timestamp };
