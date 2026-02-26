// ── Bot Instance & Shared Helpers ─────────────────────────────────────────────
// Separated into its own file to avoid circular dependencies between
// commands.ts / handlers.ts and the main bot/index.ts barrel.

import { Bot } from "grammy";
import type { Context } from "grammy";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  BOT_TOKEN,
  MUME_API_KEY,
  MUME_BASE_URL,
  ALLOWED_IDS,
} from "../config.js";
import { trackUser } from "../persistence/index.js";

// ── AI Provider ──────────────────────────────────────────────────────────────

export const provider = createOpenRouter({
  baseURL: MUME_BASE_URL,
  apiKey: MUME_API_KEY,
});

// ── Bot Instance ─────────────────────────────────────────────────────────────

export const bot = new Bot(BOT_TOKEN);
export const startedAt = Date.now();
const TELEGRAM_LIMIT = 4096;

bot.catch((err) => {
  const ctx = err.ctx;
  const e = err.error;
  console.error(`[bot] Error handling update ${ctx?.update?.update_id}:`, e);
  ctx?.reply?.("Something went wrong. Please try again.").catch(() => {});
});

// ── Helpers ──────────────────────────────────────────────────────────────────

export async function sendChunked(
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
      console.error(
        `[bot] file download attempt ${attempt}/${MAX_RETRIES} failed:`,
        (err as Error).message,
      );
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
