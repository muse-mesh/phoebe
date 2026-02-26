// ── AI Message Handler ───────────────────────────────────────────────────────
// Core streaming handler for all message types (text, photo, document, voice).

import { InputFile } from "grammy";
import type { Context } from "grammy";
import { streamText, stepCountIs } from "ai";
import type { UserContent } from "ai";
import { speechToText } from "../stt.js";
import { textToSpeech } from "../tts.js";
import {
  getUserName,
  getChatModel,
  getChatVoice,
  getContextMessages,
  addUserMessage,
  addAssistantMessage,
  appendResponseMessages,
  isVoiceReplyEnabled,
} from "../persistence/index.js";
import { buildTools, toolLabel } from "../tools.js";
import { formatError } from "../errors.js";
import { buildPrompt } from "./prompt.js";
import {
  provider,
  bot,
  sendChunked,
  downloadTelegramFile,
} from "./instance.js";
import { MAX_STEPS } from "../config.js";

// ── Constants ────────────────────────────────────────────────────────────────

const STREAM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per request

// ── Tools ────────────────────────────────────────────────────────────────────

const tools = buildTools();
export const toolNames = Object.keys(tools);
console.log(`[phoebe] tools ready: ${toolNames.join(", ")}`);

// ── Core AI Handler ──────────────────────────────────────────────────────────

export async function handleAIMessage(
  ctx: Context,
  userContent: UserContent,
  options?: { replyWithVoice?: boolean },
) {
  const userName = getUserName(ctx.from ?? undefined);

  try {
    await ctx.replyWithChatAction("typing");
    await addUserMessage(ctx.chat!.id, userContent);

    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {});
    }, 4000);

    let stillWorkingTimer: ReturnType<typeof setTimeout> | null = null;
    let toolStepCount = 0;
    stillWorkingTimer = setTimeout(() => {
      ctx.reply("Still working on it...").catch(() => {});
    }, 20000);

    const systemPrompt = buildPrompt(userName);
    const sentToolMessages = new Set<string>();
    let sentTextLength = 0;

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(
        `[bot] timeout fired after ${STREAM_TIMEOUT_MS / 1000}s, aborting...`,
      );
      abortController.abort();
    }, STREAM_TIMEOUT_MS);

    const currentModel = getChatModel(ctx.chat!.id);
    let result;
    try {
      result = streamText({
        model: provider(currentModel),
        system: systemPrompt,
        messages: await getContextMessages(ctx.chat!.id),
        tools,
        abortSignal: abortController.signal,
        stopWhen: stepCountIs(MAX_STEPS),
        onStepFinish: (step) => {
          try {
            const toolCalls = step.toolCalls ?? [];
            const stepText = (step.text ?? "").trim();

            if (toolCalls.length > 0) {
              toolStepCount++;

              if (stepText) {
                sendChunked(ctx, stepText).catch(() => {});
                sentTextLength += (step.text ?? "").length;
              } else {
                for (const tc of toolCalls) {
                  const label = toolLabel(tc.toolName);
                  if (!sentToolMessages.has(label)) {
                    sentToolMessages.add(label);
                    ctx.reply(`${label}...`).catch(() => {});
                  }
                }
              }

              const names = toolCalls.map((tc) => tc.toolName).join(", ");
              console.log(
                `[agent] step ${toolStepCount}: ${names} (${step.finishReason})${stepText ? ` [${stepText.length}ch]` : ""}`,
              );

              if (stillWorkingTimer) clearTimeout(stillWorkingTimer);
              if (step.finishReason !== "stop") {
                stillWorkingTimer = setTimeout(() => {
                  ctx.reply("Still working...").catch(() => {});
                }, 25000);
              }
            }
          } catch (stepErr) {
            console.error("[bot] onStepFinish error:", stepErr);
          }
        },
      });
    } catch (initErr) {
      console.error("[bot] streamText init error:", initErr);
      clearTimeout(timeoutId);
      clearInterval(typingInterval);
      if (stillWorkingTimer) clearTimeout(stillWorkingTimer);
      await ctx.reply(formatError(initErr)).catch(() => {});
      return;
    }

    // Collect streamed text
    let fullText = "";
    let timedOut = false;
    try {
      for await (const chunk of result.textStream) {
        fullText += chunk;
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        timedOut = true;
        console.log(
          `[bot] request timed out after ${STREAM_TIMEOUT_MS / 1000}s, steps: ${toolStepCount}`,
        );
      } else {
        console.error("[bot] stream error:", err);
        clearTimeout(timeoutId);
        clearInterval(typingInterval);
        if (stillWorkingTimer) clearTimeout(stillWorkingTimer);
        await ctx.reply(formatError(err)).catch(() => {});
        return;
      }
    }

    clearTimeout(timeoutId);
    clearInterval(typingInterval);
    if (stillWorkingTimer) clearTimeout(stillWorkingTimer);

    if (timedOut) {
      try {
        const resp = await result.response;
        if (resp.messages.length > 0) {
          await appendResponseMessages(ctx.chat!.id, resp.messages);
        }
      } catch {
        /* response may not be available on abort */
      }

      const partial = fullText.trim();
      if (partial) await sendChunked(ctx, partial);
      await addAssistantMessage(ctx.chat!.id, "(timed out - task incomplete)");
      await ctx.reply(
        "Request timed out. Try a simpler request, or /clear to reset.",
      );
      return;
    }

    // Save ALL response messages
    try {
      const resp = await result.response;
      if (resp.messages.length > 0) {
        await appendResponseMessages(ctx.chat!.id, resp.messages);
      }
    } catch (err) {
      console.error("[bot] failed to save response messages:", err);
    }

    // Handle empty response
    if (!fullText.trim()) {
      try {
        const finishReason = await result.finishReason;
        console.log(
          `[bot] empty response — finishReason: ${finishReason}, model: ${currentModel}`,
        );
        if (finishReason === "error" || finishReason === "other") {
          await ctx.reply(
            `Model error (${currentModel}). Try /model to switch.`,
          );
          return;
        }
      } catch (err) {
        console.error("[bot] response check error:", err);
        await ctx.reply(formatError(err)).catch(() => {});
        return;
      }

      if (toolStepCount > 0) {
        if (sentTextLength > 0) return;
        fullText = "(task completed)";
      } else {
        await ctx.reply(
          `Empty response from ${currentModel}. Try /model or /clear.`,
        );
        return;
      }
    }

    const remainingText =
      sentTextLength > 0
        ? fullText.slice(sentTextLength).trim()
        : fullText.trim();

    // Always send the text reply
    await sendChunked(ctx, remainingText);

    // Voice reply: only if user enabled it and sent a voice message
    if (
      options?.replyWithVoice &&
      isVoiceReplyEnabled(ctx.chat!.id) &&
      remainingText
    ) {
      const voice = getChatVoice(ctx.chat!.id);
      const audioBuffer = await textToSpeech(remainingText, voice);
      if (audioBuffer) {
        try {
          await ctx.replyWithVoice(new InputFile(audioBuffer, "reply.ogg"));
        } catch {
          try {
            await ctx.replyWithAudio(new InputFile(audioBuffer, "phoebe.mp3"));
          } catch (e) {
            console.error("[tts] send failed:", (e as Error).message);
          }
        }
      }
    }
  } catch (err) {
    console.error("[bot] error:", err);
    await ctx.reply(formatError(err)).catch(() => {});
  }
}

// ── Media Handlers ───────────────────────────────────────────────────────────

export function registerMessageHandlers() {
  // Text messages
  bot.on("message:text", (ctx) => handleAIMessage(ctx, ctx.message.text));

  // Photos
  bot.on("message:photo", async (ctx) => {
    try {
      const sizes = ctx.message.photo;
      const largest = sizes[sizes.length - 1];
      const caption = ctx.message.caption ?? "What's in this image?";

      console.log(
        `[bot] photo from ${ctx.from?.id}: ${largest.width}x${largest.height} (${largest.file_size ?? "?"}B) caption="${caption.slice(0, 80)}"`,
      );

      const buffer = await downloadTelegramFile(ctx, largest.file_id);
      console.log(`[bot] downloaded photo: ${buffer.length} bytes`);

      const content: UserContent = [
        { type: "text", text: caption },
        { type: "image", image: buffer, mediaType: "image/jpeg" },
      ];
      await handleAIMessage(ctx, content);
    } catch (err) {
      console.error("[bot] photo error:", err);
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

      console.log(
        `[bot] document from ${ctx.from?.id}: ${name} (${mime}, ${size}B)`,
      );

      const buffer = await downloadTelegramFile(ctx, doc.file_id);
      console.log(`[bot] downloaded document: ${buffer.length} bytes`);

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
      console.error("[bot] document error:", err);
      await ctx.reply("Failed to process document. Try again.").catch(() => {});
    }
  });

  // Voice messages
  bot.on("message:voice", async (ctx) => {
    try {
      const voice = ctx.message.voice;
      console.log(
        `[bot] voice from ${ctx.from?.id}: ${voice.duration}s (${voice.mime_type ?? "audio/ogg"}, ${voice.file_size ?? "?"}B)`,
      );

      await ctx.replyWithChatAction("typing");

      const file = await ctx.api.getFile(voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
      console.log(`[bot] voice file URL ready (${voice.file_size ?? "?"}B)`);

      const { text: transcript, language } = await speechToText(fileUrl);

      if (!transcript) {
        await ctx.reply("I couldn't understand that voice message. Try again?");
        return;
      }

      console.log(
        `[bot] STT (${language ?? "?"}): "${transcript.slice(0, 100)}${transcript.length > 100 ? "..." : ""}"`,
      );

      const textForModel = `[Voice message]: ${transcript}`;
      await handleAIMessage(ctx, textForModel, { replyWithVoice: true });
    } catch (err) {
      console.error("[bot] voice error:", err);
      await ctx
        .reply("Failed to process voice message. Try again.")
        .catch(() => {});
    }
  });
}
