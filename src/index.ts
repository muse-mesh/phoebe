// ── Phoebe — AI Assistant ─────────────────────────────────────────────────────
// Entry point. Loads env, initialises persistence + skills, starts bot + web.

import "dotenv/config";
import log from "./logger.js";

// Global error handlers — prevent silent crashes
process.on("unhandledRejection", (reason) => {
  log.fatal("FATAL", "unhandled rejection", {}, reason);
});
process.on("uncaughtException", (err) => {
  log.fatal("FATAL", "uncaught exception", {}, err);
});

import {
  DEFAULT_MODEL,
  MUME_BASE_URL,
  ALLOWED_IDS,
  DATA_DIR,
  SKILLS_DIR,
  BOT_TOKEN,
  OLLAMA_BASE_URL,
  isOllamaEnabled,
} from "./config.js";
import {
  ensureDataDir,
  loadUserProfiles,
  loadChatModels,
  loadChatVoices,
  loadChatVoiceReply,
  persistAll,
} from "./persistence/index.js";
import { loadModelCatalog, getCatalogInfo } from "./models.js";
import { discoverSkills } from "./tools.js";
import { bot, notifyOwner } from "./bot/index.js";

async function main(): Promise<void> {
  await ensureDataDir();
  await loadUserProfiles();
  await loadChatModels();
  await loadChatVoices();
  await loadChatVoiceReply();
  await loadModelCatalog();

  // Discover skills
  log.info("phoebe", "discovering skills…");
  await discoverSkills();

  // Start Telegram bot
  if (BOT_TOKEN) {
    await bot.start({
      drop_pending_updates: true,
      onStart: async (botInfo) => {
        const catalogInfo = getCatalogInfo();
        const bannerFields: Record<string, string> = {
          bot: `@${botInfo.username} (${botInfo.id})`,
          model: DEFAULT_MODEL,
          gateway: MUME_BASE_URL,
        };
        if (isOllamaEnabled()) {
          bannerFields.ollama = `${OLLAMA_BASE_URL} (${catalogInfo.ollamaCount} models)`;
        }
        Object.assign(bannerFields, {
          allowlist:
            ALLOWED_IDS.length === 0 ? "everyone" : ALLOWED_IDS.join(", "),
          data: DATA_DIR,
          skills: SKILLS_DIR,
          models: `${catalogInfo.count} (fetched ${catalogInfo.fetchedAt})`,
          node: process.version,
          pid: String(process.pid),
        });
        log.banner(`PHOEBE v2.0.0 — AI Telegram Bot`, bannerFields);
        await notifyOwner();
      },
    });
  } else {
    log.fatal("phoebe", "BOT_TOKEN not set — nothing to do");
    process.exit(1);
  }
}

// Graceful shutdown
const stop = async (): Promise<void> => {
  log.separator("shutdown");
  log.info("phoebe", "shutting down…");
  await persistAll();
  bot.stop();
  log.info("phoebe", "goodbye 👋");
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

main().catch((err) => {
  log.fatal("phoebe", "startup failed", {}, err);
  process.exit(1);
});
