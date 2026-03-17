// ── Web Listener ──────────────────────────────────────────────────────────────
// Watches Firestore for user messages from the mume-web interface,
// processes them through the AI pipeline, and writes responses back.

import type { ModelMessage, UserContent } from "ai";
import {
  getDb,
  isFirestoreEnabled,
  instancePath,
  sessionsPath,
  messagesPath,
  statusDocPath,
  Timestamp,
} from "../firestore.js";
import { FIREBASE_UID, PHOEBE_INSTANCE_ID, DEFAULT_MODEL } from "../config.js";
import { FirestoreChannel } from "../ai/firestore-channel.js";
import { runAIStream } from "../ai/stream.js";
import { getSkillCount } from "../tools.js";
import { toolNames } from "../ai/index.js";
import log from "../logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface WebConversation {
  messages: ModelMessage[];
  model: string;
}

// ── State ────────────────────────────────────────────────────────────────────

const conversations = new Map<string, WebConversation>();
const activeListeners: (() => void)[] = [];

// ── Instance Heartbeat ───────────────────────────────────────────────────────

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

async function registerInstance(): Promise<void> {
  const db = getDb();
  await db.doc(instancePath()).set(
    {
      id: PHOEBE_INSTANCE_ID,
      ownerId: FIREBASE_UID,
      name: process.env.PHOEBE_INSTANCE_NAME ?? "Phoebe",
      status: "online",
      lastSeen: Timestamp.now(),
      capabilities: {
        tools: toolNames,
        skillCount: getSkillCount(),
        defaultModel: DEFAULT_MODEL,
      },
      platform: {
        arch: process.arch,
        platform: process.platform,
        nodeVersion: process.version,
      },
    },
    { merge: true },
  );
  log.info("web", `registered instance: ${PHOEBE_INSTANCE_ID}`);
}

async function heartbeat(): Promise<void> {
  try {
    await getDb()
      .doc(instancePath())
      .update({ status: "online", lastSeen: Timestamp.now() });
  } catch (e) {
    log.error("web", "heartbeat error", { err: (e as Error).message });
  }
}

// ── Message Conversion ───────────────────────────────────────────────────────

function firestorePartsToUserContent(
  parts: unknown[],
  fallbackContent: string,
): UserContent {
  if (!parts || parts.length === 0) return fallbackContent || "Hello";

  // Try to extract text from parts
  const textParts: string[] = [];
  for (const part of parts) {
    if (typeof part === "object" && part !== null) {
      const p = part as Record<string, unknown>;
      if (p.type === "text" && typeof p.text === "string") {
        textParts.push(p.text);
      }
    }
  }

  if (textParts.length > 0) return textParts.join("\n");
  return fallbackContent || "Hello";
}

/** Recursively strip undefined values from an object (Firestore rejects them). */
function stripUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined) as unknown as T;
  if (typeof obj === "object") {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v !== undefined) clean[k] = stripUndefined(v);
    }
    return clean as T;
  }
  return obj;
}

function modelMessagesToFirestoreMessages(
  messages: ModelMessage[],
): Array<Record<string, unknown>> {
  return messages.map((msg, i) => {
    let content = "";
    let parts: unknown[] = [];

    if (typeof msg.content === "string") {
      content = msg.content;
      parts = [{ type: "text", text: msg.content }];
    } else if (Array.isArray(msg.content)) {
      // Extract text content
      const texts: string[] = [];
      parts = msg.content.map((part) => {
        if (typeof part === "object" && part !== null && "type" in part) {
          if (part.type === "text" && "text" in part) {
            texts.push(String(part.text));
            return { type: "text", text: String(part.text) };
          }
          if (part.type === "tool-call" && "toolName" in part) {
            const tc = part as unknown as Record<string, unknown>;
            // Truncate large tool args for Firestore
            let args: unknown = tc.args ?? {};
            if (typeof args === "object" && args !== null) {
              const json = JSON.stringify(args);
              if (json.length > 20_000) {
                args = { _truncated: true, preview: json.slice(0, 500) };
              }
            }
            return {
              type: "tool-invocation",
              toolInvocationId: tc.toolCallId ?? `tc_${Date.now()}_${i}`,
              toolName: tc.toolName ?? "unknown",
              state: "result",
              args,
            };
          }
          if (part.type === "tool-result") {
            const tr = part as unknown as Record<string, unknown>;
            let resultText = "";
            if (
              tr.output &&
              typeof tr.output === "object" &&
              "value" in (tr.output as Record<string, unknown>)
            ) {
              resultText = String((tr.output as Record<string, unknown>).value);
            } else if (tr.result !== undefined) {
              resultText =
                typeof tr.result === "string"
                  ? tr.result
                  : JSON.stringify(tr.result ?? "");
            }
            if (resultText.length > 10_000) {
              resultText = resultText.slice(0, 10_000) + "\n...[truncated]";
            }
            return {
              type: "tool-result",
              toolInvocationId: tr.toolCallId ?? `tr_${Date.now()}_${i}`,
              result: resultText,
            };
          }
        }
        return part;
      });
      content = texts.join("\n");
    }

    return stripUndefined({
      id: `msg_${Date.now()}_${i}`,
      role: msg.role === "tool" ? "assistant" : msg.role,
      content,
      parts,
      createdAt: Timestamp.now(),
      order: i,
    });
  });
}

// ── Context Window ───────────────────────────────────────────────────────────

const MAX_CONTEXT = 100;

function getConversationContext(key: string): ModelMessage[] {
  const conv = conversations.get(key);
  if (!conv) return [];
  return conv.messages.slice(-MAX_CONTEXT);
}

// ── Process Message ──────────────────────────────────────────────────────────

async function processWebMessage(
  sessionId: string,
  chatId: string,
  messageDoc: Record<string, unknown>,
): Promise<void> {
  const convKey = `${sessionId}:${chatId}`;

  // Convert to UserContent
  const parts = messageDoc.parts as unknown[] | undefined;
  const content = firestorePartsToUserContent(
    parts ?? [],
    String(messageDoc.content ?? ""),
  );

  // Append to local conversation
  if (!conversations.has(convKey)) {
    conversations.set(convKey, { messages: [], model: DEFAULT_MODEL });
  }
  const conv = conversations.get(convKey)!;
  conv.messages.push({ role: "user", content });

  // Check if session has a model override
  try {
    const sessionDoc = await getDb()
      .doc(`${sessionsPath()}/${sessionId}`)
      .get();
    if (sessionDoc.exists) {
      const data = sessionDoc.data();
      if (data?.model) conv.model = data.model;
    }
  } catch {}

  log.info("web", `processing message`, {
    conv: convKey,
    msgs: conv.messages.length,
    model: conv.model,
  });

  const channel = new FirestoreChannel(sessionId, chatId);
  const userName = "User"; // Web users don't have Telegram names

  try {
    const result = await runAIStream({
      channel,
      modelId: conv.model,
      userName,
      contextMessages: getConversationContext(convKey),
      userContent: content,
    });

    // Append response messages to local conversation
    if (result.responseMessages.length > 0) {
      conv.messages.push(...result.responseMessages);
    }

    // Write a single assistant message with the final text to Firestore.
    // Intermediate tool-call/tool-result steps are not persisted as separate
    // messages — the streaming status indicator already shows them in real-time.
    const finalText = result.fullText.trim();
    if (finalText) {
      const db = getDb();
      const messagesRef = db.collection(messagesPath(sessionId, chatId));

      // Determine order: user message order + 1
      const userOrder =
        typeof messageDoc.order === "number" ? messageDoc.order : 0;
      const msgId = `msg_${Date.now()}_resp`;
      await messagesRef.doc(msgId).set(
        stripUndefined({
          id: msgId,
          role: "assistant",
          content: finalText,
          parts: [{ type: "text", text: finalText }],
          createdAt: Timestamp.now(),
          order: userOrder + 1,
        }),
      );

      // Update chat doc with preview
      const chatRef = db.doc(`${sessionsPath()}/${sessionId}/chats/${chatId}`);
      await chatRef.set(
        {
          updatedAt: Timestamp.now(),
          lastMessagePreview: finalText.slice(0, 100),
        },
        { merge: true },
      );
    }

    log.info("web", `completed`, {
      conv: convKey,
      toolSteps: result.toolStepCount,
      chars: result.fullText.length,
    });
  } catch (err) {
    log.error("web", "process error", {}, err);
    await channel.sendError(err instanceof Error ? err.message : String(err));
  }
}

// ── Session Watcher ──────────────────────────────────────────────────────────

function watchSession(sessionId: string): void {
  const db = getDb();

  // Watch for chats in this session
  const chatsRef = db.collection(`${sessionsPath()}/${sessionId}/chats`);
  const unsubChats = chatsRef.onSnapshot((snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type === "added") {
        const chatId = change.doc.id;
        if (chatId.startsWith("_")) continue; // skip internal docs
        watchChat(sessionId, chatId);
      }
    }
  });
  activeListeners.push(unsubChats);
}

function watchChat(sessionId: string, chatId: string): void {
  const db = getDb();
  const msgsRef = db
    .collection(messagesPath(sessionId, chatId))
    .where("role", "==", "user")
    .where("processed", "==", false)
    .orderBy("createdAt", "asc");

  const unsubMsgs = msgsRef.onSnapshot(
    (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === "added") {
          const data = change.doc.data();
          // Mark as processed immediately
          change.doc.ref
            .update({ processed: true })
            .catch((e) =>
              log.error("web", "mark processed error", {
                err: (e as Error).message,
              }),
            );

          processWebMessage(sessionId, chatId, data).catch((e) =>
            log.error("web", "message handling error", {
              err: (e as Error).message,
            }),
          );
        }
      }
    },
    (err) => {
      // The query requires an index — fall back to simpler query if needed
      if (err.message?.includes("index")) {
        log.info("web", `index not ready, using fallback`, {
          session: sessionId,
          chat: chatId,
        });
        watchChatFallback(sessionId, chatId);
      } else {
        log.error("web", "watch error", { err: err.message });
      }
    },
  );
  activeListeners.push(unsubMsgs);
}

function watchChatFallback(sessionId: string, chatId: string): void {
  const db = getDb();
  const msgsRef = db
    .collection(messagesPath(sessionId, chatId))
    .orderBy("createdAt", "asc");

  const processedIds = new Set<string>();

  const unsubMsgs = msgsRef.onSnapshot((snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type === "added") {
        const data = change.doc.data();
        if (data.role !== "user") continue;
        if (data.processed === true) continue;
        if (processedIds.has(change.doc.id)) continue;

        processedIds.add(change.doc.id);
        change.doc.ref.update({ processed: true }).catch(() => {});

        processWebMessage(sessionId, chatId, data).catch((e) =>
          log.error("web", "message handling error", {
            err: (e as Error).message,
          }),
        );
      }
    }
  });
  activeListeners.push(unsubMsgs);
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function startWebListener(): Promise<void> {
  if (!isFirestoreEnabled()) {
    log.info("web", "Firestore not enabled, web listener disabled");
    return;
  }

  await registerInstance();

  // Start heartbeat
  heartbeatInterval = setInterval(heartbeat, 60_000);

  // Watch for sessions
  const db = getDb();
  const sessionsRef = db.collection(sessionsPath());
  const unsubSessions = sessionsRef.onSnapshot((snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type === "added") {
        const sessionId = change.doc.id;
        log.info("web", `watching session: ${sessionId}`);
        watchSession(sessionId);
      }
    }
  });
  activeListeners.push(unsubSessions);

  log.info("web", `listening for messages`, { owner: FIREBASE_UID });
}

export async function stopWebListener(): Promise<void> {
  // Unsubscribe all listeners
  for (const unsub of activeListeners) {
    try {
      unsub();
    } catch {}
  }
  activeListeners.length = 0;

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  // Mark instance offline
  if (isFirestoreEnabled()) {
    try {
      await getDb()
        .doc(instancePath())
        .update({ status: "offline", lastSeen: Timestamp.now() });
    } catch {}
  }

  conversations.clear();
  log.info("web", "listener stopped");
}
