// ── Bot Commands ─────────────────────────────────────────────────────────────
// All /command handlers and callback query handlers.

import fs from "fs/promises";
import { InlineKeyboard } from "grammy";
import {
  DEFAULT_MODEL,
  MAX_STEPS,
  OWNER_ID,
  OR_API_KEY,
} from "../config.js";
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
  convKey,
  convPath,
  userProfiles,
  isVoiceReplyEnabled,
  chatVoiceReply,
  saveChatVoiceReply,
  getActiveSession,
  getActiveSessionId,
  createSession,
  switchSession,
  renameSession,
  deleteSession,
  listSessions,
} from "../persistence/index.js";
import {
  resolveModelId,
  getModelsPage,
  refreshModelCatalog,
  refreshOllamaModels,
  getCatalogInfo,
  findModel,
  formatPrice,
  formatContextLength,
  getModelCapabilities,
} from "../models.js";
import { getSkillCount, discoverSkills } from "../tools.js";
import { bot, startedAt, isOllamaModel } from "./instance.js";
import { toolNames } from "./handlers.js";
import { isOllamaEnabled } from "../config.js";
import log from "../logger.js";

// ── Model Browsing Helpers ───────────────────────────────────────────────────

/** Format a timestamp as a relative age string (e.g. "2h ago", "3d ago"). */
function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function buildModelsMessage(
  chatId: number,
  page: number,
  options?: { filter?: string; ollamaOnly?: boolean },
): { text: string; keyboard: InlineKeyboard } {
  const current = getChatModel(chatId);
  const result = getModelsPage(page, {
    filter: options?.filter,
    ollamaOnly: options?.ollamaOnly,
  });
  const label = options?.ollamaOnly
    ? "\u{1F4BB} Ollama Models (Local)"
    : options?.filter
      ? `Models matching "${options.filter}"`
      : "Models";

  let text = `${label} (${result.total}) \u00b7 Page ${result.page}/${result.totalPages}\n\n`;

  for (const m of result.models) {
    const active = m.id === current ? " \u2713" : "";
    const price = formatPrice(m.pricing);
    const ctxLen = formatContextLength(m.context_length);
    const source = m.id.startsWith("ollama/") ? "\u{1F4BB}" : "\u2601\uFE0F";
    text += `${source} ${m.id}${active}\n  ${m.name} | ${ctxLen} ctx | ${price}\n\n`;
  }

  text += "/model <id> to switch";

  const buildCb = (p: number) => {
    if (options?.ollamaOnly) return `mo:${p}`;
    if (options?.filter) return `ms:${p}:${options.filter.slice(0, 40)}`;
    return `m:${p}`;
  };

  const kb = new InlineKeyboard();
  if (result.page > 1) kb.text("\u25c0 Prev", buildCb(result.page - 1));
  kb.text(`${result.page}/${result.totalPages}`, "noop");
  if (result.page < result.totalPages)
    kb.text("Next \u25b6", buildCb(result.page + 1));
  if (isOllamaEnabled()) {
    if (!options?.ollamaOnly) {
      kb.row().text("\u{1F4BB} Ollama Only", "mo:1");
    } else {
      kb.row().text("\u{1F4CB} All Models", "m:1");
    }
  }

  return { text, keyboard: kb };
}

// ── Register Commands ────────────────────────────────────────────────────────

export function registerCommands() {
  bot.command("start", (ctx) =>
    ctx.reply(
      `Hey${ctx.from?.first_name ? " " + ctx.from.first_name : ""}! I'm Phoebe\n\n` +
        "Self-hosted AI assistant.\n" +
        "Full bash access, file management, 800+ skills.\n\n" +
        "/status - Info\n" +
        "/tools - List tools\n" +
        "/skills - List skills\n" +
        "/models - Browse all models\n" +
        "/model - Switch model\n" +
        "/session - List & switch sessions\n" +
        "/session new [title] - New session\n" +
        "/session rename <title> - Rename current\n" +
        "/session delete <id> - Delete session\n" +
        "/clear - Clear session history\n" +
        "/voice - Switch TTS voice\n" +
        "/voicereply - Toggle voice replies\n" +
        "/refreshmodels - Update model catalog\n" +
        "/restart - Restart bot",
    ),
  );

  bot.command("status", async (ctx) => {
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
    const h = Math.floor(uptimeSec / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    const s = uptimeSec % 60;
    const mem = process.memoryUsage();
    const rss = (mem.rss / 1024 / 1024).toFixed(1);
    const heap = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const currentModel = getChatModel(ctx.chat.id);
    const catalogInfo = getCatalogInfo();
    const ollamaLine = isOllamaEnabled()
      ? `\nOllama: ${catalogInfo.ollamaCount} local models`
      : "";
    const session = await getActiveSession(ctx.chat.id);
    const { sessions } = await listSessions(ctx.chat.id);
    return ctx.reply(
      `Phoebe Status\n` +
        `Uptime: ${h}h ${m}m ${s}s\n` +
        `RAM: ${rss}MB RSS / ${heap}MB heap\n` +
        `Node: ${process.version}\n` +
        `Model: ${currentModel}${isOllamaModel(currentModel) ? " (local)" : ""}\n` +
        `Session: ${session.title} (${sessions.length} total)\n` +
        `Voice Reply: ${isVoiceReplyEnabled(ctx.chat.id) ? "on" : "off"}\n` +
        `Catalog: ${catalogInfo.count} models${ollamaLine}\n` +
        `Tools: ${toolNames.length}\n` +
        `Skills: ${getSkillCount()}\n` +
        `Max steps: ${MAX_STEPS}\n` +
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
        "No models in catalog.\n\nSet OR_API_KEY and run /refreshmodels to load models.",
      );
    }
    const arg = ctx.message!.text.replace(/^\/models(@\w+)?\s*/, "").trim();
    const ollamaOnly = arg.toLowerCase() === "ollama";
    const filter = ollamaOnly ? undefined : arg || undefined;
    const { text, keyboard } = buildModelsMessage(ctx.chat.id, 1, {
      filter,
      ollamaOnly,
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
    log.info("model", `switched`, { chat: ctx.chat.id, model: modelId });
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
    log.info("voicereply", `toggled`, { chat: ctx.chat.id, enabled: newValue });
    return ctx.reply(
      newValue
        ? "Voice replies enabled. I'll reply with audio to voice messages."
        : "Voice replies disabled. I'll reply with text only.",
    );
  });

  bot.command("refreshmodels", async (ctx) => {
    try {
      const parts: string[] = [];

      // Refresh cloud catalog
      if (OR_API_KEY) {
        await ctx.reply("Refreshing model catalog from Mume AI...");
        const count = await refreshModelCatalog();
        parts.push(`Cloud: ${count} models`);
      }

      // Refresh Ollama models
      if (isOllamaEnabled()) {
        await ctx.reply("Refreshing local models from Ollama...");
        const count = await refreshOllamaModels();
        parts.push(`Ollama: ${count} local models`);
      }

      if (parts.length === 0) {
        return ctx.reply(
          "No model sources configured.\nSet GATEWAY_KEY for cloud models or OLLAMA_BASE_URL for local models.",
        );
      }

      return ctx.reply(`Model catalog updated.\n${parts.join("\n")}`);
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
    log.info("voice", `switched`, { chat: ctx.chat.id, voice });
    return ctx.reply(`Voice: ${voice}`);
  });

  bot.command("clear", async (ctx) => {
    const sessionId = await getActiveSessionId(ctx.chat.id);
    const key = convKey(ctx.chat.id, sessionId);
    conversations.delete(key);
    await fs.unlink(convPath(ctx.chat.id, sessionId)).catch(() => {});
    return ctx.reply("Session history cleared.");
  });

  bot.command("restart", async (ctx) => {
    if (ctx.from!.id !== OWNER_ID) return ctx.reply("Owner only.");
    await ctx.reply("Saving state and restarting...");
    try {
      const { persistAll } = await import("../persistence/index.js");
      await persistAll();
      // Graceful exit — Docker restart policy or PM2 will bring us back
      setTimeout(() => process.exit(0), 500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Restart failed: ${msg}`);
    }
  });

  // ── Session Management ──────────────────────────────────────────────────

  bot.command("session", async (ctx) => {
    const arg = ctx.message!.text.replace(/^\/session(@\w+)?\s*/, "").trim();

    // No args — show current session + list all
    if (!arg) {
      const { sessions, activeId } = await listSessions(ctx.chat.id);
      const current = sessions.find((s) => s.id === activeId)!;
      let text = `\u{1F4CB} Current: ${current.title} (${current.id})\n\n`;
      text += `Sessions (${sessions.length}):\n`;
      for (const s of sessions) {
        const icon = s.id === activeId ? "\u2705" : "\u2B1C";
        const age = formatAge(s.updatedAt);
        text += `${icon} ${s.title} \u00b7 ${age}\n`;
      }

      // Build inline keyboard for switching
      const kb = new InlineKeyboard();
      const nonActive = sessions.filter((s) => s.id !== activeId);
      for (const s of nonActive.slice(0, 6)) {
        kb.text(s.title.slice(0, 20), `ss:${s.id}`);
        if (nonActive.indexOf(s) % 2 === 1) kb.row();
      }
      kb.row().text("+ New Session", "sn");

      return ctx.reply(text, { reply_markup: kb });
    }

    // Subcommands
    const spaceIdx = arg.indexOf(" ");
    const sub = (spaceIdx === -1 ? arg : arg.slice(0, spaceIdx)).toLowerCase();
    const rest = spaceIdx === -1 ? "" : arg.slice(spaceIdx + 1).trim();

    if (sub === "new") {
      const session = await createSession(ctx.chat.id, rest || undefined);
      return ctx.reply(
        `\u2728 Created: ${session.title} (${session.id})\nSwitched to new session.`,
      );
    }

    if (sub === "rename") {
      if (!rest) return ctx.reply("Usage: /session rename <new title>");
      const session = await getActiveSession(ctx.chat.id);
      await renameSession(ctx.chat.id, session.id, rest);
      return ctx.reply(`Session renamed to: ${rest}`);
    }

    if (sub === "delete" || sub === "del") {
      if (!rest) return ctx.reply("Usage: /session delete <id>");
      const result = await deleteSession(ctx.chat.id, rest);
      if (!result.deleted) return ctx.reply(result.reason ?? "Failed.");
      const newActive = await getActiveSession(ctx.chat.id);
      return ctx.reply(`Session ${rest} deleted. Active: ${newActive.title}`);
    }

    // Try switching to a session by ID
    const session = await switchSession(ctx.chat.id, sub);
    if (session) {
      return ctx.reply(
        `\u{1F504} Switched to: ${session.title} (${session.id})`,
      );
    }

    return ctx.reply(
      "Session commands:\n" +
        "/session \u2014 list all\n" +
        "/session new [title] \u2014 create\n" +
        "/session rename <title> \u2014 rename current\n" +
        "/session delete <id> \u2014 delete\n" +
        "/session <id> \u2014 switch",
    );
  });

  // ── Callback Queries (Model Pagination) ────────────────────────────────

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data === "noop") {
      return ctx.answerCallbackQuery();
    }

    // Session switch
    if (data.startsWith("ss:")) {
      const sessionId = data.slice(3);
      const session = await switchSession(ctx.chat!.id, sessionId);
      if (session) {
        await ctx
          .editMessageText(
            `\u{1F504} Switched to: ${session.title} (${session.id})`,
          )
          .catch(() => {});
      }
      return ctx.answerCallbackQuery({
        text: session ? `Switched to ${session.title}` : "Session not found",
      });
    }

    // New session from button
    if (data === "sn") {
      const session = await createSession(ctx.chat!.id);
      await ctx
        .editMessageText(
          `\u2728 Created: ${session.title} (${session.id})\nSwitched to new session.`,
        )
        .catch(() => {});
      return ctx.answerCallbackQuery({ text: `Created ${session.title}` });
    }

    let page: number;
    let options: { filter?: string; ollamaOnly?: boolean } = {};

    if (data.startsWith("mo:")) {
      page = parseInt(data.slice(3));
      options.ollamaOnly = true;
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
