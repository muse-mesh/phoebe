// ── Config ───────────────────────────────────────────────────────────────────

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Environment ──────────────────────────────────────────────────────────────

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, "..", "data");

export const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
export const MUME_API_KEY = process.env.MUME_API_KEY ?? "";
export const CATALOG_API_KEY =
  process.env.CATALOG_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "";
export const MUME_BASE_URL =
  process.env.MUME_BASE_URL ?? "https://mume.ai/api/v1";
export const FAL_API_KEY = process.env.FAL_KEY ?? "";
export const DEFAULT_MODEL =
  process.env.AI_MODEL ?? "google/gemini-3.1-pro-preview-customtools";
export const MAX_STEPS = parseInt(process.env.MAX_STEPS ?? "25", 25);
export const OWNER_ID = parseInt(process.env.OWNER_ID ?? "0", 10);

export const ALLOWED_IDS: number[] = process.env.ALLOWED_IDS
  ? process.env.ALLOWED_IDS.split(",").map(Number)
  : [];

export const SKILLS_DIR =
  process.env.SKILLS_DIR || path.resolve(DATA_DIR, "..", "skills");

// ── Firebase / Firestore ─────────────────────────────────────────────────────

export const FIREBASE_SERVICE_ACCOUNT_KEY =
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? "";
export const FIREBASE_UID = process.env.FIREBASE_UID ?? "";
export const PHOEBE_INSTANCE_ID = process.env.PHOEBE_INSTANCE_ID ?? "";
export const FIRESTORE_ROOT = process.env.FIRESTORE_ROOT ?? "viper/v1";
