// ── Bot ──────────────────────────────────────────────────────────────────────

import { Bot, InputFile } from "grammy";
import type { Context } from "grammy";
import { streamText, stepCountIs } from "ai";
import type { UserContent } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import fs from "fs/promises";
import { exec } from "child_process";
import { speechToText } from "./stt.js";
import { textToSpeech } from "./tts.js";

import {
  BOT_TOKEN,
  MUME_API_KEY,
  MUME_BASE_URL,
  DEFAULT_MODEL,
  MAX_STEPS,
  OWNER_ID,
  ALLOWED_IDS,
  MODELS,
} from "./config.js";

import {
  trackUser,
  getUserName,
  getChatModel,
  resolveModelId,
  chatModels,
  saveChatModels,
  getChatVoice,
  resolveVoice,
  chatVoices,
  saveChatVoices,
  TTS_VOICES,
  conversations,
  convPath,
  getContextMessages,
  addUserMessage,
  addAssistantMessage,
  appendResponseMessages,
  userProfiles,
} from "./persistence.js";

import { buildTools, toolLabel, getSkillCount, discoverSkills } from "./tools";
import { formatError } from "./errors.js";

// ── AI Provider ──────────────────────────────────────────────────────────────

const provider = createOpenRouter({
  baseURL: MUME_BASE_URL,
  apiKey: MUME_API_KEY,
});

// ── Bot Instance ─────────────────────────────────────────────────────────────

export const bot = new Bot(BOT_TOKEN);
const startedAt = Date.now();
const TELEGRAM_LIMIT = 4096;
const STREAM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per request

bot.catch((err) => {
  const ctx = err.ctx;
  const e = err.error;
  console.error(`[bot] Error handling update ${ctx?.update?.update_id}:`, e);
  ctx?.reply?.("Something went wrong. Please try again.").catch(() => {});
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendChunked(
  ctx: { reply: (text: string) => Promise<unknown> },
  text: string,
): Promise<void> {
  if (!text) return;
  for (let i = 0; i < text.length; i += TELEGRAM_LIMIT) {
    await ctx.reply(text.slice(i, i + TELEGRAM_LIMIT)).catch((e) => {
      console.error("[bot] send error:", (e as Error).message);
    });
  }
}

// ── Telegram File Download ───────────────────────────────────────────────────

async function downloadTelegramFile(
  ctx: Context,
  fileId: string,
): Promise<Buffer> {
  const file = await ctx.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Tools ────────────────────────────────────────────────────────────────────

const tools = buildTools();
const toolNames = Object.keys(tools);
console.log(`[phoebe] tools ready: ${toolNames.join(", ")}`);

// ── System Prompt ────────────────────────────────────────────────────────────

function buildPrompt(userName: string): string {
  const greeting =
    userName !== "User" ? ` You are chatting with ${userName}.` : "";
  const skillCount = getSkillCount();

  return (
    `You are Phoebe, an AI assistant on a Raspberry Pi (Debian, aarch64).${greeting}\n\n` +
    `Reply in plain text only. No Markdown, no HTML. This is Telegram.\n\n` +
    `TOOLS:\n` +
    `- bash: Run any shell command. Full system access.\n` +
    `- readFile / writeFile: Read and write files directly.\n` +
    `- list_skills / activate_skill: Browse and use ${skillCount} installed Agent Skills.\n` +
    `- search_skills / install_skill: Find and add new skills from skills.sh.\n\n` +
    `RULES (MUST FOLLOW):\n` +
    `- NEVER generate more than 1500 characters in a single writeFile call. Break long content into multiple small files or sections.\n` +
    `- For stories: write ONE short section per step (intro, scene 1, scene 2, etc). Each file max 1500 chars.\n` +
    `- For code/articles: split into small files. One file per step.\n` +
    `- Do NOT output long text in chat. Save to files instead.\n` +
    `- After each tool call, give a 1-2 sentence summary. The user cannot see tool output directly.\n` +
    `- Keep your chat replies under 500 characters.`
  );
}

// ── Middleware ────────────────────────────────────────────────────────────────

bot.use(async (ctx, next) => {
  if (ALLOWED_IDS.length > 0 && ctx.from) {
    if (!ALLOWED_IDS.includes(ctx.from.id)) return;
  }
  await next();
});

bot.use(async (ctx, next) => {
  if (ctx.from) trackUser(ctx.from);
  await next();
});

// ── Commands ─────────────────────────────────────────────────────────────────

bot.command("start", (ctx) =>
  ctx.reply(
    `Hey${ctx.from?.first_name ? " " + ctx.from.first_name : ""}! I'm Phoebe\n\n` +
      "AI assistant on your Raspberry Pi.\n" +
      "Full bash access, file management, 800+ skills.\n\n" +
      "/status - Info\n" +
      "/tools - List tools\n" +
      "/skills - List skills\n" +
      "/models - Available models\n" +
      "/model - Switch model\n" +
      "/voice - Switch TTS voice\n" +
      "/clear - Clear history\n" +
      "/restart - Restart Pi",
  ),
);

bot.command("status", (ctx) => {
  const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = uptimeSec % 60;
  const mem = process.memoryUsage();
  const rss = (mem.rss / 1024 / 1024).toFixed(1);
  const heap = (mem.heapUsed / 1024 / 1024).toFixed(1);
  const currentModel = getChatModel(ctx.chat.id);
  return ctx.reply(
    `Phoebe Status\n` +
      `Uptime: ${h}h ${m}m ${s}s\n` +
      `RAM: ${rss}MB RSS / ${heap}MB heap\n` +
      `Node: ${process.version}\n` +
      `Model: ${currentModel}\n` +
      `Tools: ${toolNames.length}\n` +
      `Skills: ${getSkillCount()}\n` +
      `Max steps: ${MAX_STEPS}\n` +
      `Conversations: ${conversations.size}\n` +
      `Users: ${userProfiles.size}`,
  );
});

bot.command("tools", (ctx) => {
  if (toolNames.length === 0) return ctx.reply("No tools available.");
  return ctx.reply(
    `Tools (${toolNames.length}):\n${toolNames.map((n) => `- ${n}`).join("\n")}`,
  );
});

bot.command("skills", async (ctx) => {
  await discoverSkills();
  const count = getSkillCount();
  if (count === 0)
    return ctx.reply("No skills installed. Ask me to search and install some!");
  return ctx.reply(
    `${count} skills installed. Ask me to list or search for specific skills.`,
  );
});

bot.command("models", (ctx) => {
  const current = getChatModel(ctx.chat.id);
  const lines = MODELS.map((m) => {
    const active = m.id === current ? " *" : "";
    return `- ${m.alias} -> ${m.label}${active}`;
  });
  return ctx.reply(
    `Models (${MODELS.length}):\n${lines.join("\n")}\n\n/model <alias>`,
  );
});

bot.command("model", async (ctx) => {
  const arg = ctx.message!.text.replace(/^\/model(@\w+)?\s*/, "").trim();
  if (!arg)
    return ctx.reply(
      `Model: ${getChatModel(ctx.chat.id)}\n\n/model <alias or id>`,
    );
  const modelId = resolveModelId(arg);
  chatModels.set(ctx.chat.id, modelId);
  await saveChatModels().catch(() => {});
  console.log(`[model] chat ${ctx.chat.id} -> ${modelId}`);
  return ctx.reply(`Model: ${modelId}`);
});

bot.command("voice", async (ctx) => {
  const arg = ctx.message!.text.replace(/^\/voice(@\w+)?\s*/, "").trim();
  if (!arg) {
    const current = getChatVoice(ctx.chat.id);
    const lines = TTS_VOICES.map(
      (v) => `- ${v}${v === current ? " \u2713" : ""}`,
    );
    return ctx.reply(
      `Voice: ${current}\n\n${lines.join("\n")}\n\n/voice <name>`,
    );
  }
  const voice = resolveVoice(arg);
  if (!voice) {
    return ctx.reply(
      `Unknown voice "${arg}".\n\n/voice to see available voices.`,
    );
  }
  chatVoices.set(ctx.chat.id, voice);
  await saveChatVoices().catch(() => {});
  console.log(`[voice] chat ${ctx.chat.id} -> ${voice}`);
  return ctx.reply(`Voice: ${voice}`);
});

bot.command("clear", async (ctx) => {
  conversations.delete(ctx.chat.id);
  await fs.unlink(convPath(ctx.chat.id)).catch(() => {});
  return ctx.reply("History cleared.");
});

bot.command("restart", async (ctx) => {
  if (ctx.from!.id !== OWNER_ID) return ctx.reply("Owner only.");
  await ctx.reply("Saving state and restarting...");
  try {
    const { persistAll } = await import("./persistence.js");
    await persistAll();
    exec("sudo shutdown -r +0", (err) => {
      if (err) console.error("[restart] failed:", err.message);
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Restart failed: ${msg}`);
  }
});

// ── Core AI Handler ──────────────────────────────────────────────────────────

async function handleAIMessage(
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
      // Save whatever response messages we got (includes tool calls up to timeout)
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

    // Save ALL response messages (assistant + tool, with full tool-call parts)
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

    // Voice reply: convert text to speech if the user sent a voice message
    if (options?.replyWithVoice && remainingText) {
      const voice = getChatVoice(ctx.chat!.id);
      const audioBuffer = await textToSpeech(remainingText, voice);
      if (audioBuffer) {
        try {
          await ctx.replyWithVoice(new InputFile(audioBuffer, "reply.ogg"));
          return;
        } catch {
          try {
            await ctx.replyWithAudio(new InputFile(audioBuffer, "phoebe.mp3"));
            return;
          } catch (e) {
            console.error(
              "[tts] send failed, falling back to text:",
              (e as Error).message,
            );
          }
        }
      }
    }

    await sendChunked(ctx, remainingText);
  } catch (err) {
    console.error("[bot] error:", err);
    await ctx.reply(formatError(err)).catch(() => {});
  }
}

// ── Message Handlers ─────────────────────────────────────────────────────────

// Text messages
bot.on("message:text", (ctx) => handleAIMessage(ctx, ctx.message.text));

// Photos — send largest resolution to the model as an image part
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

// Documents — PDFs, text files, images sent as files
bot.on("message:document", async (ctx) => {
  try {
    const doc = ctx.message.document;
    const caption =
      ctx.message.caption ??
      `Analyze this file: ${doc.file_name ?? "document"}`;
    const mime = doc.mime_type ?? "application/octet-stream";
    const name = doc.file_name ?? "document";
    const size = doc.file_size ?? 0;

    // Reject files over 10MB (Telegram's limit is 20MB but let's be safe)
    if (size > 10 * 1024 * 1024) {
      await ctx.reply("File too large (max 10MB). Try a smaller file.");
      return;
    }

    console.log(
      `[bot] document from ${ctx.from?.id}: ${name} (${mime}, ${size}B)`,
    );

    const buffer = await downloadTelegramFile(ctx, doc.file_id);
    console.log(`[bot] downloaded document: ${buffer.length} bytes`);

    // Images sent as documents
    if (mime.startsWith("image/")) {
      const content: UserContent = [
        { type: "text", text: caption },
        { type: "image", image: buffer, mediaType: mime },
      ];
      await handleAIMessage(ctx, content);
      return;
    }

    // Text-based files — read as text and embed inline
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

    // Binary files (PDF, etc) — send as FilePart
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

// Voice messages — speech-to-text, then reply with text-to-speech
bot.on("message:voice", async (ctx) => {
  try {
    const voice = ctx.message.voice;
    console.log(
      `[bot] voice from ${ctx.from?.id}: ${voice.duration}s (${voice.mime_type ?? "audio/ogg"}, ${voice.file_size ?? "?"}B)`,
    );

    await ctx.replyWithChatAction("typing");

    // Get the Telegram file URL (pass directly to fal.ai — no re-encoding)
    const file = await ctx.api.getFile(voice.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
    console.log(`[bot] voice file URL ready (${voice.file_size ?? "?"}B)`);

    // Speech-to-text
    const { text: transcript, language } = await speechToText(fileUrl);

    if (!transcript) {
      await ctx.reply("I couldn't understand that voice message. Try again?");
      return;
    }

    console.log(
      `[bot] STT (${language ?? "?"}): "${transcript.slice(0, 100)}${transcript.length > 100 ? "..." : ""}"`,
    );

    // Send transcript to model (always text — more token-efficient than audio)
    // Append note so the model knows it was a voice message
    const textForModel = `[Voice message]: ${transcript}`;
    await handleAIMessage(ctx, textForModel, { replyWithVoice: true });
  } catch (err) {
    console.error("[bot] voice error:", err);
    await ctx
      .reply("Failed to process voice message. Try again.")
      .catch(() => {});
  }
});

// ── Startup Notification ─────────────────────────────────────────────────────

export async function notifyOwner(): Promise<void> {
  if (!OWNER_ID) return;
  try {
    await bot.api.sendMessage(
      OWNER_ID,
      `Phoebe is online!\n` +
        `Model: ${DEFAULT_MODEL}\n` +
        `Tools: ${toolNames.join(", ")}\n` +
        `Skills: ${getSkillCount()}\n` +
        `Max steps: ${MAX_STEPS}\n` +
        `Node: ${process.version}`,
    );
  } catch (err) {
    console.warn("[phoebe] startup notification failed:", err);
  }
}
