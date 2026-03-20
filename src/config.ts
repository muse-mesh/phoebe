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
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
export const GATEWAY_URL = process.env.GATEWAY_URL ?? "https://mume.ai/api/v1";
export const FAL_API_KEY = process.env.FAL_KEY ?? "";
export const DEFAULT_MODEL =
  process.env.AI_MODEL ?? "google/gemini-3.1-pro-preview-customtools";
export const MAX_STEPS = parseInt(process.env.MAX_STEPS ?? "25", 25);
export const OWNER_ID = parseInt(process.env.OWNER_ID ?? "0", 10);

// ── Ollama (optional — local model inference) ────────────────────────────────

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "";
export const isOllamaEnabled = (): boolean => OLLAMA_BASE_URL.length > 0;

export const ALLOWED_IDS: number[] = process.env.ALLOWED_IDS
  ? process.env.ALLOWED_IDS.split(",").map(Number)
  : [];

export const SKILLS_DIR =
  process.env.SKILLS_DIR || path.resolve(DATA_DIR, "..", "skills");
