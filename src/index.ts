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
import { initFirestore, isFirestoreEnabled } from "./firestore.js";
import { startWebListener, stopWebListener } from "./web/index.js";

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

  // Init Firestore (optional — for web interface)
  initFirestore();

  // Start web listener if Firestore is available
  if (isFirestoreEnabled()) {
    await startWebListener();
  }

  // Start Telegram bot (only if BOT_TOKEN is set)
  if (BOT_TOKEN) {
    await bot.start({
      drop_pending_updates: true,
      onStart: async (botInfo) => {
        const catalogInfo = getCatalogInfo();
        log.banner(`PHOEBE v2.0.0 — AI Telegram Bot`, {
          bot: `@${botInfo.username} (${botInfo.id})`,
          model: DEFAULT_MODEL,
          gateway: MUME_BASE_URL,
          allowlist:
            ALLOWED_IDS.length === 0 ? "everyone" : ALLOWED_IDS.join(", "),
          data: DATA_DIR,
          skills: SKILLS_DIR,
          models: `${catalogInfo.count} (fetched ${catalogInfo.fetchedAt})`,
          web: isFirestoreEnabled() ? "enabled" : "disabled",
          node: process.version,
          pid: String(process.pid),
        });
        await notifyOwner();
      },
    });
  } else {
    const catalogInfo = getCatalogInfo();
    log.warn("phoebe", "BOT_TOKEN not set — Telegram bot disabled");
    log.banner(`PHOEBE v2.0.0 — Web-Only Mode`, {
      model: DEFAULT_MODEL,
      gateway: MUME_BASE_URL,
      models: `${catalogInfo.count} (fetched ${catalogInfo.fetchedAt})`,
      web: isFirestoreEnabled() ? "enabled" : "disabled",
      node: process.version,
      pid: String(process.pid),
    });

    // If no bot, keep the process alive for the web listener
    if (isFirestoreEnabled()) {
      log.info("phoebe", "running in web-only mode");
    } else {
      log.fatal("phoebe", "no BOT_TOKEN and no Firestore — nothing to do");
      process.exit(1);
    }
  }
}

// Graceful shutdown
const stop = async (): Promise<void> => {
  log.separator("shutdown");
  log.info("phoebe", "shutting down…");
  await stopWebListener();
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
