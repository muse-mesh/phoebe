// ── Bot Instance & Shared Helpers ─────────────────────────────────────────────
// Separated into its own file to avoid circular dependencies between
// commands.ts / handlers.ts and the main bot/index.ts barrel.

import { Bot } from "grammy";
import type { Context } from "grammy";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import {
  BOT_TOKEN,
  GATEWAY_KEY,
  GATEWAY_URL,
  ALLOWED_IDS,
  OLLAMA_BASE_URL,
  isOllamaEnabled,
} from "../config.js";
import { trackUser } from "../persistence/index.js";
import log from "../logger.js";

// ── AI Provider ──────────────────────────────────────────────────────────────

const OLLAMA_PREFIX = "ollama/";

export const mumeProvider = createOpenAICompatible({
  name: "gateway",
  baseURL: GATEWAY_URL,
  apiKey: GATEWAY_KEY,
  fetch: async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Accept-Encoding", "identity");
    return globalThis.fetch(url, { ...init, headers });
  },
});

export const ollamaProvider = isOllamaEnabled()
  ? createOpenAICompatible({
      name: "ollama",
      baseURL: OLLAMA_BASE_URL.replace(/\/+$/, "") + "/v1",
    })
  : null;

/** Check whether a model ID targets Ollama (prefixed with "ollama/"). */
export function isOllamaModel(modelId: string): boolean {
  return modelId.startsWith(OLLAMA_PREFIX);
}

/** Strip the "ollama/" prefix to get the local Ollama model name. */
export function ollamaModelName(modelId: string): string {
  return modelId.slice(OLLAMA_PREFIX.length);
}

/**
 * Resolve a model ID to the correct AI SDK LanguageModel instance.
 * Ollama models (prefixed "ollama/") route to the local Ollama server.
 * All other models route through Mume AI with provider-ordering hints.
 */
export function resolveProvider(modelId: string): LanguageModel {
  if (isOllamaModel(modelId)) {
    if (!ollamaProvider) {
      throw new Error(
        "Ollama model requested but OLLAMA_BASE_URL is not configured",
      );
    }
    // Use the OpenAI-compatible provider pointing at Ollama's /v1 endpoint
    return ollamaProvider.chatModel(ollamaModelName(modelId));
  }

  // Route via gateway
  return mumeProvider.chatModel(modelId);
}

// ── Bot Instance ─────────────────────────────────────────────────────────────

export const bot = new Bot(BOT_TOKEN);
export const startedAt = Date.now();
const TELEGRAM_LIMIT = 4096;

bot.catch((err) => {
  const ctx = err.ctx;
  const e = err.error;
  log.error(
    "bot",
    "error handling update",
    { updateId: ctx?.update?.update_id },
    e,
  );
  ctx?.reply?.("Something went wrong. Please try again.").catch(() => {});
});

// ── Helpers ──────────────────────────────────────────────────────────────────

// ── Markdown → Telegram HTML ─────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert standard GitHub-flavored Markdown to Telegram-compatible HTML.
 * Handles: code blocks, inline code, bold, italic, strikethrough, links.
 * Falls back gracefully — unrecognized patterns are left as-is.
 */
export function markdownToTelegramHtml(md: string): string {
  // Protect code blocks and inline code from further processing
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  // Replace fenced code blocks
  let result = md.replace(/```(?:\w*)?\n([\s\S]*?)```/g, (_, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(code.trimEnd())}</pre>`);
    return `\x00CB${idx}\x00`;
  });

  // Replace inline code
  result = result.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${idx}\x00`;
  });

  // Escape HTML in remaining text
  result = escapeHtml(result);

  // Bold: **text**
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Italic: *text* (single asterisk, not adjacent to another)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Restore code blocks and inline code
  result = result.replace(
    /\x00CB(\d+)\x00/g,
    (_, idx) => codeBlocks[parseInt(idx)],
  );
  result = result.replace(
    /\x00IC(\d+)\x00/g,
    (_, idx) => inlineCodes[parseInt(idx)],
  );

  return result;
}

export async function sendChunked(
  ctx: {
    reply: (
      text: string,
      options?: Record<string, unknown>,
    ) => Promise<unknown>;
  },
  text: string,
): Promise<void> {
  if (!text) return;

  // Convert markdown to Telegram HTML
  const html = markdownToTelegramHtml(text);

  // Send a single chunk with HTML
  const sendOne = async (chunk: string, htmlChunk: string) => {
    try {
      await ctx.reply(htmlChunk, { parse_mode: "HTML" });
    } catch {
      // Fallback to plain text if HTML parsing fails
      await ctx.reply(chunk).catch((e) => {
        log.error("bot", "send chunk failed", { err: (e as Error).message });
      });
    }
  };

  // If it fits in one message, send directly
  if (text.length <= TELEGRAM_LIMIT && html.length <= TELEGRAM_LIMIT) {
    await sendOne(text, html);
    return;
  }

  // Smart splitting on the plain text, then convert each chunk
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_LIMIT) {
      await sendOne(remaining, markdownToTelegramHtml(remaining));
      break;
    }

    // Find the best split point within the limit
    let splitAt = -1;
    const searchWindow = remaining.slice(0, TELEGRAM_LIMIT);

    // Try double-newline (paragraph break) first
    const paraBreak = searchWindow.lastIndexOf("\n\n");
    if (paraBreak > TELEGRAM_LIMIT * 0.3) {
      splitAt = paraBreak + 2;
    } else {
      // Try single newline
      const lineBreak = searchWindow.lastIndexOf("\n");
      if (lineBreak > TELEGRAM_LIMIT * 0.3) {
        splitAt = lineBreak + 1;
      } else {
        // Try space
        const spaceBreak = searchWindow.lastIndexOf(" ");
        if (spaceBreak > TELEGRAM_LIMIT * 0.5) {
          splitAt = spaceBreak + 1;
        } else {
          splitAt = TELEGRAM_LIMIT;
        }
      }
    }

    const chunk = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt);

    await sendOne(chunk, markdownToTelegramHtml(chunk));
  }
}

export async function downloadTelegramFile(
  ctx: Context,
  fileId: string,
): Promise<Buffer> {
  const file = await ctx.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      log.error("bot", "file download failed", {
        attempt: `${attempt}/${MAX_RETRIES}`,
        err: (err as Error).message,
      });
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error("Download failed after retries"); // unreachable, satisfies TS
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
