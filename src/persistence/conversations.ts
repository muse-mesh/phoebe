// ── Conversation History ─────────────────────────────────────────────────────
// Session-aware conversation persistence. Each conversation is identified
// by (chatId, sessionId). Messages are NEVER deleted from disk — we append
// and cap at MAX_DISK_MESSAGES.
// For the model context window we slice the last MAX_CONTEXT_MESSAGES and
// truncate old tool results outside the RECENT_FULL_TOOLS window.

import type { ModelMessage, ToolModelMessage, UserContent } from "ai";
import { DATA_DIR } from "../config.js";
import { saveJSON, loadJSON } from "./store.js";
import path from "path";
import log from "../logger.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Max messages kept on disk per conversation. */
const MAX_DISK_MESSAGES = 500;

/** How many recent messages to send to the model as context. */
export const MAX_CONTEXT_MESSAGES = 100;

/** The last N model-messages keep full tool results. */
export const RECENT_FULL_TOOLS = 30;

/** Max chars for truncated tool-result output in older messages. */
const MAX_TOOL_RESULT_LENGTH = 10_000;

// ── State ────────────────────────────────────────────────────────────────────
// Key: "chatId_sessionId"

export const conversations = new Map<string, ModelMessage[]>();

export function convKey(chatId: number, sessionId: string): string {
  return `${chatId}_${sessionId}`;
}

export function convPath(chatId: number, sessionId: string): string {
  return path.join(DATA_DIR, "conversations", `${chatId}_${sessionId}.json`);
}

// ── Migration ────────────────────────────────────────────────────────────────

function migrateMessage(msg: any): ModelMessage {
  if (msg.role === "tool" && Array.isArray(msg.content)) return msg;
  if (msg.role === "assistant" && Array.isArray(msg.content)) return msg;

  const content = typeof msg.content === "string" ? msg.content : "";
  if (msg.role === "system") return { role: "system", content };
  if (msg.role === "assistant") return { role: "assistant", content };
  return { role: "user", content };
}

// ── Load / Save ──────────────────────────────────────────────────────────────

async function loadConversation(
  chatId: number,
  sessionId: string,
): Promise<ModelMessage[]> {
  const key = convKey(chatId, sessionId);
  if (conversations.has(key)) return conversations.get(key)!;
  const data = await loadJSON<unknown[]>(convPath(chatId, sessionId));
  const history = Array.isArray(data) ? data.map(migrateMessage) : [];
  conversations.set(key, history);
  return history;
}

export async function saveConversation(
  chatId: number,
  sessionId: string,
): Promise<void> {
  const key = convKey(chatId, sessionId);
  const history = conversations.get(key);
  if (!history) return;
  const toSave =
    history.length > MAX_DISK_MESSAGES
      ? history.slice(-MAX_DISK_MESSAGES)
      : history;
  const sanitized = toSave.map((msg) => {
    if (msg.role !== "user" || typeof msg.content === "string") return msg;
    if (!Array.isArray(msg.content)) return msg;
    const cleanParts = msg.content.map((part) => {
      if (part.type === "image") {
        return { type: "text" as const, text: "[image]" };
      }
      if (part.type === "file") {
        const name = (part as any).filename ?? "file";
        return { type: "text" as const, text: `[file: ${name}]` };
      }
      return part;
    });
    return { ...msg, content: cleanParts };
  });
  await saveJSON(convPath(chatId, sessionId), sanitized).catch((e: Error) =>
    log.error("persist", "save conv failed", {
      chatId,
      sessionId,
      err: e.message,
    }),
  );
}

// ── Context Window ───────────────────────────────────────────────────────────

export async function getContextMessages(
  chatId: number,
  sessionId: string,
): Promise<ModelMessage[]> {
  const history = await loadConversation(chatId, sessionId);
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

// ── Mutators ─────────────────────────────────────────────────────────────────

export async function addUserMessage(
  chatId: number,
  sessionId: string,
  content: UserContent,
): Promise<void> {
  const history = await loadConversation(chatId, sessionId);
  history.push({ role: "user", content });
  saveConversation(chatId, sessionId).catch(() => {});
}

export async function appendResponseMessages(
  chatId: number,
  sessionId: string,
  messages: ModelMessage[],
): Promise<void> {
  const history = await loadConversation(chatId, sessionId);
  history.push(...messages);
  saveConversation(chatId, sessionId).catch(() => {});
}

export async function addAssistantMessage(
  chatId: number,
  sessionId: string,
  content: string,
): Promise<void> {
  const history = await loadConversation(chatId, sessionId);
  history.push({ role: "assistant", content });
  saveConversation(chatId, sessionId).catch(() => {});
}
