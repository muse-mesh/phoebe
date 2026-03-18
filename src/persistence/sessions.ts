// ── Session Management ────────────────────────────────────────────────────────
// Per-chat multi-session support with persistence across restarts.
// Each chat can have multiple named sessions, each with isolated conversation
// history and skills. Sessions are stored as JSON in data/sessions/.

import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { DATA_DIR, SKILLS_DIR } from "../config.js";
import { saveJSON, loadJSON } from "./store.js";
import log from "../logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionIndex {
  activeId: string;
  sessions: Session[];
}

// ── State ────────────────────────────────────────────────────────────────────

const sessionIndices = new Map<number, SessionIndex>();

// ── Paths ────────────────────────────────────────────────────────────────────

function indexPath(chatId: number): string {
  return path.join(DATA_DIR, "sessions", `${chatId}.json`);
}

function generateId(): string {
  return crypto.randomBytes(4).toString("hex"); // 8-char hex
}

// ── Core API ─────────────────────────────────────────────────────────────────

/**
 * Get or create the session index for a chat.
 * On first access, migrates any legacy conversation file into a "Default" session.
 */
export async function getSessionIndex(chatId: number): Promise<SessionIndex> {
  if (sessionIndices.has(chatId)) return sessionIndices.get(chatId)!;

  // Try loading from disk
  const existing = await loadJSON<SessionIndex>(indexPath(chatId));
  if (existing && existing.activeId && Array.isArray(existing.sessions)) {
    sessionIndices.set(chatId, existing);
    return existing;
  }

  // Check for legacy conversation to migrate
  const legacyPath = path.join(DATA_DIR, "conversations", `${chatId}.json`);
  let hasLegacy = false;
  try {
    await fs.access(legacyPath);
    hasLegacy = true;
  } catch {}

  const defaultId = generateId();
  const now = new Date().toISOString();
  const index: SessionIndex = {
    activeId: defaultId,
    sessions: [
      {
        id: defaultId,
        title: "Default",
        createdAt: now,
        updatedAt: now,
      },
    ],
  };

  // Migrate legacy conversation file → new naming scheme
  if (hasLegacy) {
    const newPath = path.join(
      DATA_DIR,
      "conversations",
      `${chatId}_${defaultId}.json`,
    );
    try {
      await fs.rename(legacyPath, newPath);
      log.info("sessions", "migrated legacy conversation", {
        chatId,
        sessionId: defaultId,
      });
    } catch (e) {
      log.error("sessions", "migration rename failed, copying", {}, e);
      try {
        await fs.copyFile(legacyPath, newPath);
      } catch {}
    }
  }

  sessionIndices.set(chatId, index);
  await saveSessionIndex(chatId);
  return index;
}

export async function saveSessionIndex(chatId: number): Promise<void> {
  const index = sessionIndices.get(chatId);
  if (!index) return;
  await fs.mkdir(path.join(DATA_DIR, "sessions"), { recursive: true });
  await saveJSON(indexPath(chatId), index).catch((e: Error) =>
    log.error("sessions", "save index failed", { chatId, err: e.message }),
  );
}

/** Get the active session for a chat. */
export async function getActiveSession(chatId: number): Promise<Session> {
  const index = await getSessionIndex(chatId);
  return (
    index.sessions.find((s) => s.id === index.activeId) ?? index.sessions[0]
  );
}

/** Get the active session ID for a chat. */
export async function getActiveSessionId(chatId: number): Promise<string> {
  const session = await getActiveSession(chatId);
  return session.id;
}

/** Create a new session and make it active. */
export async function createSession(
  chatId: number,
  title?: string,
): Promise<Session> {
  const index = await getSessionIndex(chatId);
  const id = generateId();
  const now = new Date().toISOString();
  const session: Session = {
    id,
    title: title ?? `Session ${index.sessions.length + 1}`,
    createdAt: now,
    updatedAt: now,
  };
  index.sessions.push(session);
  index.activeId = id;

  // Create session skills dir
  await ensureSessionSkillsDir(id);

  await saveSessionIndex(chatId);
  log.info("sessions", "created", {
    chatId,
    sessionId: id,
    title: session.title,
  });
  return session;
}

/** Switch to an existing session. Returns the session or null if not found. */
export async function switchSession(
  chatId: number,
  sessionId: string,
): Promise<Session | null> {
  const index = await getSessionIndex(chatId);
  const session = index.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  index.activeId = sessionId;
  await saveSessionIndex(chatId);
  log.info("sessions", "switched", { chatId, sessionId });
  return session;
}

/** Rename a session. */
export async function renameSession(
  chatId: number,
  sessionId: string,
  newTitle: string,
): Promise<boolean> {
  const index = await getSessionIndex(chatId);
  const session = index.sessions.find((s) => s.id === sessionId);
  if (!session) return false;
  session.title = newTitle;
  session.updatedAt = new Date().toISOString();
  await saveSessionIndex(chatId);
  return true;
}

/** Delete a session. Cannot delete the last session. */
export async function deleteSession(
  chatId: number,
  sessionId: string,
): Promise<{ deleted: boolean; reason?: string }> {
  const index = await getSessionIndex(chatId);
  if (index.sessions.length <= 1) {
    return { deleted: false, reason: "Cannot delete the only session." };
  }
  const idx = index.sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return { deleted: false, reason: "Session not found." };

  index.sessions.splice(idx, 1);

  // If we deleted the active session, switch to the latest one
  if (index.activeId === sessionId) {
    index.activeId = index.sessions[index.sessions.length - 1].id;
  }

  // Delete conversation file
  const convFile = path.join(
    DATA_DIR,
    "conversations",
    `${chatId}_${sessionId}.json`,
  );
  await fs.unlink(convFile).catch(() => {});

  // Delete session skills dir
  const skillsDir = sessionSkillsPath(sessionId);
  await fs.rm(skillsDir, { recursive: true, force: true }).catch(() => {});

  await saveSessionIndex(chatId);
  log.info("sessions", "deleted", { chatId, sessionId });
  return { deleted: true };
}

/** List all sessions for a chat. */
export async function listSessions(
  chatId: number,
): Promise<{ sessions: Session[]; activeId: string }> {
  const index = await getSessionIndex(chatId);
  return { sessions: index.sessions, activeId: index.activeId };
}

/**
 * Auto-title a session from the first user message.
 * Only updates sessions that still have a default "Session N" title.
 */
export async function autoTitleSession(
  chatId: number,
  sessionId: string,
  message: string,
): Promise<void> {
  const index = await getSessionIndex(chatId);
  const session = index.sessions.find((s) => s.id === sessionId);
  if (!session) return;

  // Only auto-title if it still has the default name pattern
  if (!/^(Session \d+|Default)$/.test(session.title)) return;

  // Generate title from message: first 50 chars, truncated at word boundary
  let title = message.replace(/\s+/g, " ").trim();
  if (title.length > 50) {
    title = title.slice(0, 50);
    const lastSpace = title.lastIndexOf(" ");
    if (lastSpace > 20) title = title.slice(0, lastSpace);
    title += "…";
  }
  if (!title) return;

  session.title = title;
  session.updatedAt = new Date().toISOString();
  await saveSessionIndex(chatId);
}

/** Touch a session's updatedAt timestamp. */
export async function touchSession(
  chatId: number,
  sessionId: string,
): Promise<void> {
  const index = await getSessionIndex(chatId);
  const session = index.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  session.updatedAt = new Date().toISOString();
  // Saved later by persistAll
}

// ── Skills Paths ─────────────────────────────────────────────────────────────

/** Get the skills directory for a specific session. */
export function sessionSkillsPath(sessionId: string): string {
  return path.join(SKILLS_DIR, "sessions", sessionId);
}

/** Ensure the session skills directory exists. */
export async function ensureSessionSkillsDir(sessionId: string): Promise<void> {
  await fs.mkdir(sessionSkillsPath(sessionId), { recursive: true });
}

// ── Bulk Persistence ─────────────────────────────────────────────────────────

/** Persist all session indices to disk. */
export async function saveAllSessionIndices(): Promise<void> {
  for (const chatId of sessionIndices.keys()) {
    await saveSessionIndex(chatId).catch(() => {});
  }
}
