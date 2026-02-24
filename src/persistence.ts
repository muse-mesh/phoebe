// ── Persistence ──────────────────────────────────────────────────────────────
// Stores full ModelMessage objects (including tool-call + tool-result parts).
// Messages are NEVER deleted from disk — we append and cap at MAX_DISK_MESSAGES.
// For the model context window we slice the last MAX_CONTEXT_MESSAGES and
// truncate old tool results outside the RECENT_FULL_TOOLS window.

import fs from "fs/promises";
import path from "path";
import type { ModelMessage, ToolModelMessage } from "ai";
import { DATA_DIR, DEFAULT_MODEL, MODELS } from "./config.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: number;
  firstName: string;
  username: string;
  firstSeen: string;
  lastSeen: string;
}

interface TelegramFrom {
  id: number;
  first_name?: string;
  username?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Max messages kept on disk per conversation. Old ones stay; we just cap. */
const MAX_DISK_MESSAGES = 500;

/** How many recent messages to send to the model as context. */
export const MAX_CONTEXT_MESSAGES = 100;

/**
 * The last N model-messages keep full tool results.
 * Older tool results get their output truncated.
 */
export const RECENT_FULL_TOOLS = 30;

/** Max chars for truncated tool-result output in older messages. */
const MAX_TOOL_RESULT_LENGTH = 10_000;

// ── Low-level helpers ────────────────────────────────────────────────────────

export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(path.join(DATA_DIR, "conversations"), { recursive: true });
}

async function saveJSON(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function loadJSON<T = unknown>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ── User Profiles ────────────────────────────────────────────────────────────

export const userProfiles = new Map<number, UserProfile>();

export async function loadUserProfiles(): Promise<void> {
  const data = await loadJSON<UserProfile[]>(path.join(DATA_DIR, "users.json"));
  if (Array.isArray(data)) {
    for (const u of data) userProfiles.set(u.id, u);
  }
  console.log(`[persist] loaded ${userProfiles.size} user profiles`);
}

async function saveUserProfiles(): Promise<void> {
  await saveJSON(
    path.join(DATA_DIR, "users.json"),
    Array.from(userProfiles.values()),
  );
}

export function trackUser(from: TelegramFrom): void {
  const existing = userProfiles.get(from.id);
  userProfiles.set(from.id, {
    id: from.id,
    firstName: from.first_name ?? "",
    username: from.username ?? "",
    firstSeen: existing?.firstSeen ?? new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  });
  saveUserProfiles().catch(() => {});
}

export function getUserName(from?: TelegramFrom): string {
  if (!from) return "User";
  const profile = userProfiles.get(from.id);
  return profile?.firstName || from.first_name || from.username || "User";
}

// ── Per-Chat Model Overrides ─────────────────────────────────────────────────

export const chatModels = new Map<number, string>();

export async function loadChatModels(): Promise<void> {
  const data = await loadJSON<Record<string, string>>(
    path.join(DATA_DIR, "models.json"),
  );
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) chatModels.set(Number(k), v);
  }
  console.log(`[persist] loaded ${chatModels.size} model overrides`);
}

export async function saveChatModels(): Promise<void> {
  await saveJSON(
    path.join(DATA_DIR, "models.json"),
    Object.fromEntries(chatModels),
  );
}

export function getChatModel(chatId: number): string {
  return chatModels.get(chatId) ?? DEFAULT_MODEL;
}

export function resolveModelId(input: string): string {
  const lower = input.trim().toLowerCase();
  const byAlias = MODELS.find((m) => m.alias === lower);
  if (byAlias) return byAlias.id;
  const byId = MODELS.find((m) => m.id.toLowerCase() === lower);
  if (byId) return byId.id;
  const bySub = MODELS.find((m) => m.id.toLowerCase().includes(lower));
  if (bySub) return bySub.id;
  return input.trim();
}

// ── Conversation History ─────────────────────────────────────────────────────
// Messages are stored as native ModelMessage objects (user | assistant | tool).
// Assistant messages may contain tool-call parts in their content array.
// Tool messages contain tool-result parts with output.
// Old {role, content: string} format is auto-migrated on load.

export const conversations = new Map<number, ModelMessage[]>();

export function convPath(chatId: number): string {
  return path.join(DATA_DIR, "conversations", `${chatId}.json`);
}

/**
 * Migrate old simplified {role, content: string} messages to ModelMessage format.
 */
function migrateMessage(msg: any): ModelMessage {
  // Already proper ModelMessage (content is array for tool/assistant with parts)
  if (msg.role === "tool" && Array.isArray(msg.content)) return msg;
  if (msg.role === "assistant" && Array.isArray(msg.content)) return msg;

  // Old format: {role, content: string}
  const content = typeof msg.content === "string" ? msg.content : "";
  if (msg.role === "system") return { role: "system", content };
  if (msg.role === "assistant") return { role: "assistant", content };
  // Default to user for unknown roles
  return { role: "user", content };
}

async function loadConversation(chatId: number): Promise<ModelMessage[]> {
  if (conversations.has(chatId)) return conversations.get(chatId)!;
  const data = await loadJSON<unknown[]>(convPath(chatId));
  const history = Array.isArray(data) ? data.map(migrateMessage) : [];
  conversations.set(chatId, history);
  return history;
}

async function saveConversation(chatId: number): Promise<void> {
  const history = conversations.get(chatId);
  if (!history) return;
  // Cap disk storage — keep the most recent messages
  const toSave =
    history.length > MAX_DISK_MESSAGES
      ? history.slice(-MAX_DISK_MESSAGES)
      : history;
  await saveJSON(convPath(chatId), toSave).catch((e: Error) =>
    console.error(`[persist] save conv ${chatId} failed:`, e.message),
  );
}

/**
 * Get the context window to send to the model:
 * - Last MAX_CONTEXT_MESSAGES messages
 * - Tool results older than RECENT_FULL_TOOLS boundary are truncated
 */
export async function getContextMessages(
  chatId: number,
): Promise<ModelMessage[]> {
  const history = await loadConversation(chatId);
  // Clone so truncation doesn't mutate stored data
  const recent = history.slice(-MAX_CONTEXT_MESSAGES);

  const truncationBoundary = Math.max(0, recent.length - RECENT_FULL_TOOLS);

  for (let i = 0; i < truncationBoundary; i++) {
    const msg = recent[i];
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      const toolMsg = msg as ToolModelMessage;
      recent[i] = {
        role: "tool",
        content: toolMsg.content.map((part) => {
          if (part.type === "tool-result" && part.output != null) {
            const output = part.output;
            // Truncate text or json outputs that are too large
            if (
              output.type === "text" &&
              output.value.length > MAX_TOOL_RESULT_LENGTH
            ) {
              return {
                ...part,
                output: {
                  ...output,
                  value:
                    output.value.substring(0, MAX_TOOL_RESULT_LENGTH) +
                    "\n...[truncated]",
                },
              };
            }
            if (output.type === "json") {
              const json = JSON.stringify(output.value);
              if (json.length > MAX_TOOL_RESULT_LENGTH) {
                return {
                  ...part,
                  output: {
                    type: "text" as const,
                    value:
                      json.substring(0, MAX_TOOL_RESULT_LENGTH) +
                      "\n...[truncated]",
                  },
                };
              }
            }
          }
          return part;
        }),
      } satisfies ToolModelMessage;
    }
  }

  return recent;
}

/** Add a single user message. */
export async function addUserMessage(
  chatId: number,
  content: string,
): Promise<void> {
  const history = await loadConversation(chatId);
  history.push({ role: "user", content });
  saveConversation(chatId).catch(() => {});
}

/**
 * Append response messages from streamText (assistant + tool messages with
 * full tool-call and tool-result parts, placed in order they occurred).
 */
export async function appendResponseMessages(
  chatId: number,
  messages: ModelMessage[],
): Promise<void> {
  const history = await loadConversation(chatId);
  history.push(...messages);
  saveConversation(chatId).catch(() => {});
}

/** Add a simple assistant text message (no tool calls). */
export async function addAssistantMessage(
  chatId: number,
  content: string,
): Promise<void> {
  const history = await loadConversation(chatId);
  history.push({ role: "assistant", content });
  saveConversation(chatId).catch(() => {});
}

export async function persistAll(): Promise<void> {
  for (const chatId of conversations.keys()) {
    await saveConversation(chatId).catch(() => {});
  }
  await saveChatModels().catch(() => {});
  await saveUserProfiles().catch(() => {});
}
