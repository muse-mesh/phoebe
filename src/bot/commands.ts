// ── Bot Commands ─────────────────────────────────────────────────────────────
// All /command handlers and callback query handlers.

import fs from "fs/promises";
import { exec } from "child_process";
import { InlineKeyboard } from "grammy";
import { DEFAULT_MODEL, MAX_STEPS, OWNER_ID } from "../config.js";
import {
  trackUser,
  getChatModel,
  chatModels,
  saveChatModels,
  getChatVoice,
  resolveVoice,
  chatVoices,
  saveChatVoices,
  TTS_VOICES,
  conversations,
  convPath,
  userProfiles,
  isVoiceReplyEnabled,
  chatVoiceReply,
  saveChatVoiceReply,
} from "../persistence/index.js";
import {
  resolveModelId,
  getModelsPage,
  refreshModelCatalog,
  getCatalogInfo,
  findModel,
  formatPrice,
  formatContextLength,
  getModelCapabilities,
} from "../models.js";
import { getSkillCount, discoverSkills } from "../tools.js";
import { bot, startedAt } from "./instance.js";
import { toolNames } from "./handlers.js";

// ── Model Browsing Helpers ───────────────────────────────────────────────────

function buildModelsMessage(
  chatId: number,
  page: number,
  options?: { filter?: string; freeOnly?: boolean },
): { text: string; keyboard: InlineKeyboard } {
  const current = getChatModel(chatId);
  const result = getModelsPage(page, {
    filter: options?.filter,
    freeOnly: options?.freeOnly,
  });
  const label = options?.freeOnly
    ? "Free Models"
    : options?.filter
      ? `Models matching "${options.filter}"`
      : "Models";

  let text = `${label} (${result.total}) \u00b7 Page ${result.page}/${result.totalPages}\n\n`;

  for (const m of result.models) {
    const active = m.id === current ? " \u2713" : "";
    const price = formatPrice(m.pricing);
    const ctxLen = formatContextLength(m.context_length);
    text += `${m.id}${active}\n  ${m.name} | ${ctxLen} ctx | ${price}\n\n`;
  }

  text += "/model <id> to switch";

  const buildCb = (p: number) => {
    if (options?.freeOnly) return `mf:${p}`;
    if (options?.filter) return `ms:${p}:${options.filter.slice(0, 40)}`;
    return `m:${p}`;
  };

  const kb = new InlineKeyboard();
  if (result.page > 1) kb.text("\u25c0 Prev", buildCb(result.page - 1));
  kb.text(`${result.page}/${result.totalPages}`, "noop");
  if (result.page < result.totalPages)
    kb.text("Next \u25b6", buildCb(result.page + 1));
  if (!options?.freeOnly) {
    kb.row().text("\ud83c\udd93 Free Only", "mf:1");
  } else {
    kb.row().text("\ud83d\udccb All Models", "m:1");
  }

  return { text, keyboard: kb };
}

// ── Register Commands ────────────────────────────────────────────────────────

export function registerCommands() {
  bot.command("start", (ctx) =>
    ctx.reply(
      `Hey${ctx.from?.first_name ? " " + ctx.from.first_name : ""}! I'm Phoebe\n\n` +
        "AI assistant on your Raspberry Pi.\n" +
        "Full bash access, file management, 800+ skills.\n\n" +
        "/status - Info\n" +
        "/tools - List tools\n" +
        "/skills - List skills\n" +
        "/models - Browse all models\n" +
        "/model - Switch model\n" +
        "/voice - Switch TTS voice\n" +
        "/voicereply - Toggle voice replies\n" +
        "/refreshmodels - Update model catalog\n" +
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
        `Voice Reply: ${isVoiceReplyEnabled(ctx.chat.id) ? "on" : "off"}\n` +
        `Catalog: ${getCatalogInfo().count} models\n` +
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
      return ctx.reply(
        "No skills installed. Ask me to search and install some!",
      );
    return ctx.reply(
      `${count} skills installed. Ask me to list or search for specific skills.`,
    );
  });

  bot.command("models", (ctx) => {
    const info = getCatalogInfo();
    if (info.count === 0) {
      return ctx.reply(
        "No models in catalog.\n\nSet OPENROUTER_API_KEY and run /refreshmodels to load models.",
      );
    }
    const arg = ctx.message!.text.replace(/^\/models(@\w+)?\s*/, "").trim();
    const freeOnly = arg.toLowerCase() === "free";
    const filter = freeOnly ? undefined : arg || undefined;
    const { text, keyboard } = buildModelsMessage(ctx.chat.id, 1, {
      filter,
      freeOnly,
    });
    return ctx.reply(text, { reply_markup: keyboard });
  });

  bot.command("model", async (ctx) => {
    const arg = ctx.message!.text.replace(/^\/model(@\w+)?\s*/, "").trim();
    if (!arg) {
      const current = getChatModel(ctx.chat.id);
      const model = findModel(current);
      const caps = getModelCapabilities(current);
      const info = model
        ? `Model: ${model.id}\n${model.name}\nContext: ${formatContextLength(model.context_length)}\nPrice: ${formatPrice(model.pricing)}\nCapabilities: ${caps.length ? caps.join(", ") : "unknown"}`
        : `Model: ${current}`;
      return ctx.reply(`${info}\n\n/model <id> to switch`);
    }
    const modelId = resolveModelId(arg);
    chatModels.set(ctx.chat.id, modelId);
    await saveChatModels().catch(() => {});
    const model = findModel(modelId);
    const caps = getModelCapabilities(modelId);
    console.log(`[model] chat ${ctx.chat.id} -> ${modelId}`);
    const info = model
      ? `Switched to: ${model.id}\n${model.name}\nContext: ${formatContextLength(model.context_length)}\nPrice: ${formatPrice(model.pricing)}${caps.length ? `\nCapabilities: ${caps.join(", ")}` : ""}`
      : `Model: ${modelId}`;
    return ctx.reply(info);
  });

  bot.command("voicereply", async (ctx) => {
    const current = isVoiceReplyEnabled(ctx.chat.id);
    const newValue = !current;
    chatVoiceReply.set(ctx.chat.id, newValue);
    await saveChatVoiceReply().catch(() => {});
    console.log(`[voicereply] chat ${ctx.chat.id} -> ${newValue}`);
    return ctx.reply(
      newValue
        ? "Voice replies enabled. I'll reply with audio to voice messages."
        : "Voice replies disabled. I'll reply with text only.",
    );
  });

  bot.command("refreshmodels", async (ctx) => {
    try {
      await ctx.reply("Refreshing model catalog from OpenRouter...");
      const count = await refreshModelCatalog();
      return ctx.reply(`Model catalog updated: ${count} models.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return ctx.reply(`Failed to refresh models: ${msg}`);
    }
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
      const { persistAll } = await import("../persistence/index.js");
      await persistAll();
      exec("sudo shutdown -r +0", (err) => {
        if (err) console.error("[restart] failed:", err.message);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Restart failed: ${msg}`);
    }
  });

  // ── Callback Queries (Model Pagination) ────────────────────────────────

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data === "noop") {
      return ctx.answerCallbackQuery();
    }

    let page: number;
    let options: { filter?: string; freeOnly?: boolean } = {};

    if (data.startsWith("mf:")) {
      page = parseInt(data.slice(3));
      options.freeOnly = true;
    } else if (data.startsWith("ms:")) {
      const rest = data.slice(3);
      const colonIdx = rest.indexOf(":");
      page = parseInt(rest.slice(0, colonIdx));
      options.filter = rest.slice(colonIdx + 1);
    } else if (data.startsWith("m:")) {
      page = parseInt(data.slice(2));
    } else {
      return ctx.answerCallbackQuery();
    }

    const { text, keyboard } = buildModelsMessage(ctx.chat!.id, page, options);
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery();
  });
}
