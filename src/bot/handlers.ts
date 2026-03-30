// ── AI Message Handler ───────────────────────────────────────────────────────
// Core streaming handler for all message types (text, photo, document, voice).
// Delegates AI streaming to the shared ai/stream module via TelegramChannel.

import type { Context } from "grammy";
import type { UserContent } from "ai";
import { speechToText } from "../stt.js";
import { textToSpeech } from "../tts.js";
import log from "../logger.js";
import {
  getUserName,
  getChatModel,
  getChatVoice,
  getContextMessages,
  addUserMessage,
  addAssistantMessage,
  appendResponseMessages,
  isVoiceReplyEnabled,
  getActiveSession,
  autoTitleSession,
  touchSession,
  sessionSkillsPath,
} from "../persistence/index.js";
import { buildTools } from "../tools.js";
import { bot, downloadTelegramFile } from "./instance.js";
import {
  TelegramChannel,
  runAIStream,
  toolNames as aiToolNames,
} from "../ai/index.js";
import { RATE_LIMIT_MESSAGES, RATE_LIMIT_WINDOW_MS } from "../config.js";

// ── Tools ────────────────────────────────────────────────────────────────────

// Ensure tools are built so side effects (console.log) run
buildTools();
export const toolNames = aiToolNames;

// ── Core AI Handler ──────────────────────────────────────────────────────────

// Per-chat abort controllers — if a new message arrives while processing,
// the in-flight request is aborted so the bot doesn't get stuck.
const inflightRequests = new Map<number, AbortController>();

// ── Rate Limiting ────────────────────────────────────────────────────────────

const rateLimitBuckets = new Map<number, number[]>();

function isRateLimited(chatId: number): boolean {
  if (RATE_LIMIT_MESSAGES <= 0) return false;
  const now = Date.now();
  const timestamps = rateLimitBuckets.get(chatId) ?? [];
  const window = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (window.length >= RATE_LIMIT_MESSAGES) return true;
  window.push(now);
  rateLimitBuckets.set(chatId, window);
  return false;
}

export async function handleAIMessage(
  ctx: Context,
  userContent: UserContent,
  options?: { replyWithVoice?: boolean },
) {
  const chatId = ctx.chat!.id;
  const userName = getUserName(ctx.from ?? undefined);
  const channel = new TelegramChannel(ctx);

  // Rate limiting
  if (isRateLimited(chatId)) {
    log.warn("bot", "rate limited", { chat: chatId });
    await ctx.reply("You're sending messages too fast. Please wait a moment.");
    return;
  }

  // Abort any in-flight request for this chat
  const existing = inflightRequests.get(chatId);
  if (existing) {
    log.info("bot", "aborting in-flight request", { chat: chatId });
    existing.abort();
  }

  const abortController = new AbortController();
  inflightRequests.set(chatId, abortController);

  try {
    // Resolve active session
    const session = await getActiveSession(chatId);
    const sessionId = session.id;

    // Auto-title session from first user message
    let textPreview = "";
    if (typeof userContent === "string") {
      textPreview = userContent;
    } else if (Array.isArray(userContent)) {
      textPreview = userContent
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ");
    }
    if (textPreview) {
      await autoTitleSession(chatId, sessionId, textPreview);
    }

    await addUserMessage(chatId, sessionId, userContent);

    const result = await runAIStream({
      channel,
      modelId: getChatModel(chatId),
      userName,
      contextMessages: await getContextMessages(chatId, sessionId),
      userContent,
      abortSignal: abortController.signal,
      sessionSkillsDir: sessionSkillsPath(sessionId),
      sessionTitle: session.title,
    });

    // Persist response messages
    if (result.responseMessages.length > 0) {
      await appendResponseMessages(chatId, sessionId, result.responseMessages);
    }
    if (result.timedOut) {
      await addAssistantMessage(
        chatId,
        sessionId,
        "(timed out - task incomplete)",
      );
    }

    // Touch session updatedAt
    await touchSession(chatId, sessionId);

    // Voice reply: only if user enabled it and sent a voice message
    const remainingText = result.fullText.trim();
    if (
      options?.replyWithVoice &&
      isVoiceReplyEnabled(chatId) &&
      remainingText
    ) {
      const voice = getChatVoice(chatId);
      const audioBuffer = await textToSpeech(remainingText, voice);
      if (audioBuffer) {
        await channel.sendVoice(audioBuffer);
      }
    }
  } catch (err) {
    log.error("bot", "message handling failed", {}, err);
    await channel.sendError(err instanceof Error ? err.message : String(err));
  } finally {
    // Clean up in-flight tracking
    if (inflightRequests.get(chatId) === abortController) {
      inflightRequests.delete(chatId);
    }
  }
}

// ── Media Handlers ───────────────────────────────────────────────────────────

export function registerMessageHandlers() {
  // Text messages
  bot.on("message:text", (ctx) => {
    log.userMessage(
      "bot",
      { from: ctx.from?.id, chat: ctx.chat.id, type: "text" },
      ctx.message.text,
    );
    return handleAIMessage(ctx, ctx.message.text);
  });

  // Photos
  bot.on("message:photo", async (ctx) => {
    try {
      const sizes = ctx.message.photo;
      const largest = sizes[sizes.length - 1];
      const caption = ctx.message.caption ?? "What's in this image?";

      log.info("bot", "photo received", {
        from: ctx.from?.id,
        size: `${largest.width}x${largest.height}`,
        bytes: largest.file_size ?? "?",
        caption: caption.slice(0, 80),
      });

      const buffer = await downloadTelegramFile(ctx, largest.file_id);
      log.info("bot", "downloaded photo", { bytes: buffer.length });

      const content: UserContent = [
        { type: "text", text: caption },
        { type: "image", image: buffer, mediaType: "image/jpeg" },
      ];
      await handleAIMessage(ctx, content);
    } catch (err) {
      log.error("bot", "photo processing failed", {}, err);
      await ctx.reply("Failed to process image. Try again.").catch(() => {});
    }
  });

  // Documents
  bot.on("message:document", async (ctx) => {
    try {
      const doc = ctx.message.document;
      const caption =
        ctx.message.caption ??
        `Analyze this file: ${doc.file_name ?? "document"}`;
      const mime = doc.mime_type ?? "application/octet-stream";
      const name = doc.file_name ?? "document";
      const size = doc.file_size ?? 0;

      if (size > 10 * 1024 * 1024) {
        await ctx.reply("File too large (max 10MB). Try a smaller file.");
        return;
      }

      log.info("bot", "document received", {
        from: ctx.from?.id,
        name,
        mime,
        bytes: size,
      });

      const buffer = await downloadTelegramFile(ctx, doc.file_id);
      log.info("bot", "downloaded document", { bytes: buffer.length });

      if (mime.startsWith("image/")) {
        const content: UserContent = [
          { type: "text", text: caption },
          { type: "image", image: buffer, mediaType: mime },
        ];
        await handleAIMessage(ctx, content);
        return;
      }

      if (
        mime.startsWith("text/") ||
        mime === "application/json" ||
        mime === "application/xml" ||
        mime === "application/javascript" ||
        name.match(
          /\.(ts|js|py|rb|go|rs|c|cpp|h|md|txt|csv|yaml|yml|toml|sh|sql|html|css)$/i,
        )
      ) {
        const text = buffer.toString("utf-8");
        const truncated =
          text.length > 50_000
            ? text.slice(0, 50_000) + "\n...[truncated]"
            : text;
        const content: UserContent = `[File: ${name}]\n\`\`\`\n${truncated}\n\`\`\`\n\n${caption}`;
        await handleAIMessage(ctx, content);
        return;
      }

      const content: UserContent = [
        { type: "text", text: caption },
        { type: "file", data: buffer, mediaType: mime, filename: name },
      ];
      await handleAIMessage(ctx, content);
    } catch (err) {
      log.error("bot", "document processing failed", {}, err);
      await ctx.reply("Failed to process document. Try again.").catch(() => {});
    }
  });

  // Voice messages
  bot.on("message:voice", async (ctx) => {
    try {
      const voice = ctx.message.voice;
      log.info("bot", "voice received", {
        from: ctx.from?.id,
        duration: `${voice.duration}s`,
        mime: voice.mime_type ?? "audio/ogg",
        bytes: voice.file_size ?? "?",
      });

      await ctx.replyWithChatAction("typing");

      const file = await ctx.api.getFile(voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
      log.info("bot", "voice file URL ready", {
        bytes: voice.file_size ?? "?",
      });

      const { text: transcript, language } = await speechToText(fileUrl);

      if (!transcript) {
        await ctx.reply("I couldn't understand that voice message. Try again?");
        return;
      }

      log.info("stt", "transcribed", {
        lang: language ?? "?",
        text: transcript.slice(0, 100) + (transcript.length > 100 ? "…" : ""),
      });

      const textForModel = `[Voice message]: ${transcript}`;
      await handleAIMessage(ctx, textForModel, { replyWithVoice: true });
    } catch (err) {
      log.error("bot", "voice processing failed", {}, err);
      await ctx
        .reply("Failed to process voice message. Try again.")
        .catch(() => {});
    }
  });
}
