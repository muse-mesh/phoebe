// ── Conversation History ─────────────────────────────────────────────────────
// Session-aware conversation persistence. Each conversation is identified
// by (chatId, sessionId). Messages are NEVER deleted from disk — we append
// and cap at MAX_DISK_MESSAGES.
// For the model context window we slice the last MAX_CONTEXT_MESSAGES and
// truncate old tool results outside the RECENT_FULL_TOOLS window.

import type { ModelMessage, ToolModelMessage, UserContent, TextPart, FilePart, ToolCallPart, ToolResultPart } from "ai";
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract plain text from a user message (handles string and array content). */
function extractUserText(msg: ModelMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p): p is TextPart => p.type === "text")
      .map((p) => p.text)
      .join(" ");
  }
  return "";
}

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

function migrateMessage(msg: Record<string, unknown>): ModelMessage {
  if (msg.role === "tool" && Array.isArray(msg.content))
    return msg as unknown as ModelMessage;
  if (msg.role === "assistant" && Array.isArray(msg.content))
    return msg as unknown as ModelMessage;

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
  const data = await loadJSON<Record<string, unknown>[]>(convPath(chatId, sessionId));
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
        const name = (part as FilePart).filename ?? "file";
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

  // ── Sanitize message sequence for model compatibility ────────────────────
  // Many models (especially local ones like Qwen via LM Studio) enforce
  // strict message ordering via jinja templates:
  //   1. assistant (with tool-call) must be followed by tool (with results)
  //   2. tool results must be followed by assistant (not user)
  //   3. consecutive user messages are invalid — must alternate user/assistant
  //
  // Corruption happens when the AI stream errors/times out mid-conversation,
  // leaving orphaned tool calls or missing assistant responses, and when
  // users send multiple messages before the bot can reply.

  // Collect all tool-result IDs so we can detect orphaned tool calls
  const toolResultIds = new Set<string>();
  for (const msg of recent) {
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "tool-result" && (part as ToolResultPart).toolCallId) {
          toolResultIds.add((part as ToolResultPart).toolCallId);
        }
      }
    }
  }

  // Pass 1: Fix structural issues (orphaned tool calls, missing assistants)
  const pass1: ModelMessage[] = [];
  for (let i = 0; i < recent.length; i++) {
    const msg = recent[i];
    pass1.push(msg);

    // Fix orphaned tool calls — assistant has tool-call but no tool-result follows
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const orphanedCalls = msg.content.filter(
        (part): part is ToolCallPart =>
          part.type === "tool-call" &&
          !!(part as ToolCallPart).toolCallId &&
          !toolResultIds.has((part as ToolCallPart).toolCallId),
      );
      if (orphanedCalls.length > 0) {
        const next = recent[i + 1];
        if (!next || next.role !== "tool") {
          pass1.push({
            role: "tool",
            content: orphanedCalls.map((call) => ({
              type: "tool-result" as const,
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              result: "(error: tool call failed or timed out)",
              output: [
                {
                  type: "text" as const,
                  value: "(error: tool call failed or timed out)",
                },
              ],
            })),
          } as unknown as ToolModelMessage);
          pass1.push({
            role: "assistant",
            content: "(The previous tool call failed. Continuing...)",
          } as ModelMessage);
          log.warn("persist", "patched orphaned tool calls", {
            chatId,
            count: orphanedCalls.length,
          });
        }
      }
    }

    // Fix missing assistant after tool result
    if (msg.role === "tool") {
      const next = recent[i + 1];
      if (next && next.role !== "assistant") {
        pass1.push({
          role: "assistant",
          content: "(Continuing after tool execution.)",
        } as ModelMessage);
      }
    }
  }

  // Pass 2: Merge consecutive user messages into a single message.
  // Models expect strict user/assistant alternation. When a user sends
  // multiple messages before the bot responds, we concatenate them.
  const sanitized: ModelMessage[] = [];
  for (const msg of pass1) {
    const prev = sanitized[sanitized.length - 1];
    if (msg.role === "user" && prev?.role === "user") {
      // Merge: extract text from both and combine
      const prevText = extractUserText(prev);
      const curText = extractUserText(msg);
      sanitized[sanitized.length - 1] = {
        role: "user",
        content: [{ type: "text" as const, text: `${prevText}\n${curText}` }],
      } as ModelMessage;
    } else {
      sanitized.push(msg);
    }
  }

  // Log if we patched anything
  if (sanitized.length !== recent.length) {
    log.warn("persist", "sanitized conversation for model compat", {
      chatId,
      before: recent.length,
      after: sanitized.length,
    });
  }

  return sanitized;
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
