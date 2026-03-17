// ── Telegram Channel ──────────────────────────────────────────────────────────
// OutputChannel implementation for Telegram via grammY.

import { InputFile } from "grammy";
import type { Context } from "grammy";
import { sendChunked } from "../bot/instance.js";
import type { OutputChannel } from "./channel.js";
import log from "../logger.js";

export class TelegramChannel implements OutputChannel {
  constructor(private ctx: Context) {}

  async sendTyping(): Promise<void> {
    await this.ctx.replyWithChatAction("typing").catch(() => {});
  }

  async sendText(text: string): Promise<void> {
    await sendChunked(this.ctx, text);
  }

  async sendToolAction(toolName: string, detail: string): Promise<void> {
    // Format tool actions as mono-spaced for visibility
    const formatted =
      toolName === "bash" ? `\`$ ${detail}\`` : `\`${toolName}: ${detail}\``;
    await this.ctx.reply(formatted, { parse_mode: "Markdown" }).catch((e) => {
      // Fallback without markdown if parse fails
      const plain =
        toolName === "bash" ? `$ ${detail}` : `${toolName}: ${detail}`;
      this.ctx.reply(plain).catch(() => {
        log.error("bot", "send tool action failed", {
          err: (e as Error).message,
        });
      });
    });
  }

  onStreamChunk(_chunk: string): void {
    // Telegram doesn't support real-time streaming; we batch at step boundaries
  }

  async onStreamDone(text: string): Promise<void> {
    await sendChunked(this.ctx, text);
  }

  async sendVoice(audio: Buffer): Promise<void> {
    try {
      await this.ctx.replyWithVoice(new InputFile(audio, "reply.ogg"));
    } catch {
      try {
        await this.ctx.replyWithAudio(new InputFile(audio, "phoebe.mp3"));
      } catch (e) {
        log.error("tts", "send failed", { err: (e as Error).message });
      }
    }
  }

  async sendError(message: string): Promise<void> {
    await this.ctx.reply(message).catch((e) => {
      log.error("bot", "send error failed", { err: (e as Error).message });
    });
  }
}
