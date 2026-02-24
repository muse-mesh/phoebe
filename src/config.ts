// ── Config ───────────────────────────────────────────────────────────────────

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Types ────────────────────────────────────────────────────────────────────

export interface Model {
  id: string;
  alias: string;
  label: string;
}

// ── Environment ──────────────────────────────────────────────────────────────

export const DATA_DIR = path.resolve(__dirname, "..", "data");

export const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
export const MUME_API_KEY = process.env.MUME_API_KEY ?? "";
export const MUME_BASE_URL =
  process.env.MUME_BASE_URL ?? "https://mume.ai/api/v1";
export const DEFAULT_MODEL =
  process.env.AI_MODEL ?? "google/gemini-3-flash-preview";
export const MAX_STEPS = 25;
export const OWNER_ID = parseInt(process.env.OWNER_ID ?? "0", 10);

export const ALLOWED_IDS: number[] = process.env.ALLOWED_IDS
  ? process.env.ALLOWED_IDS.split(",").map(Number)
  : [];

export const SKILLS_DIR =
  process.env.SKILLS_DIR || path.resolve(DATA_DIR, "..", "skills");

// ── Model Catalog ────────────────────────────────────────────────────────────

export const MODELS: Model[] = [
  {
    id: "anthropic/claude-sonnet-4.6",
    alias: "sonnet",
    label: "Claude Sonnet 4.6",
  },
  { id: "anthropic/claude-opus-4.6", alias: "opus", label: "Claude Opus 4.6" },
  {
    id: "anthropic/claude-opus-4.5",
    alias: "opus45",
    label: "Claude Opus 4.5",
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    alias: "sonnet45",
    label: "Claude Sonnet 4.5",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    alias: "haiku",
    label: "Claude Haiku 4.5",
  },
  {
    id: "google/gemini-3.1-pro-preview",
    alias: "pro",
    label: "Gemini 3.1 Pro",
  },
  {
    id: "google/gemini-3-flash-preview",
    alias: "gemini-flash",
    label: "Gemini 3 Flash",
  },
  { id: "google/gemini-2.5-flash", alias: "flash", label: "Gemini 2.5 Flash" },
  {
    id: "google/gemini-2.5-flash-lite",
    alias: "flash-lite",
    label: "Gemini 2.5 Flash Lite",
  },
  { id: "openai/gpt-5.2", alias: "gpt5", label: "GPT-5.2" },
  { id: "openai/gpt-5.1", alias: "gpt51", label: "GPT-5.1" },
  {
    id: "openai/gpt-5.1-codex-max",
    alias: "codex",
    label: "GPT-5.1 Codex Max",
  },
  { id: "openai/gpt-5-mini", alias: "gpt-mini", label: "GPT-5 Mini" },
  { id: "openai/gpt-5-nano", alias: "gpt-nano", label: "GPT-5 Nano" },
  { id: "openai/gpt-oss-120b", alias: "gpt-oss", label: "GPT-OSS 120B" },
  { id: "deepseek/deepseek-v3.2", alias: "deepseek", label: "DeepSeek V3.2" },
  { id: "x-ai/grok-4-fast", alias: "grok4", label: "Grok 4 Fast" },
  { id: "x-ai/grok-code-fast-1", alias: "grok-code", label: "Grok Code Fast" },
  { id: "x-ai/grok-3", alias: "grok3", label: "Grok 3" },
  { id: "x-ai/grok-3-mini", alias: "grok-mini", label: "Grok 3 Mini" },
  {
    id: "mistralai/mistral-small-creative",
    alias: "mistral",
    label: "Mistral Small Creative",
  },
  {
    id: "mistralai/codestral-2508",
    alias: "codestral",
    label: "Codestral 2508",
  },
  { id: "minimax/minimax-m2.5", alias: "minimax", label: "MiniMax M2.5" },
  { id: "z-ai/glm-5", alias: "glm5", label: "GLM 5" },
  { id: "z-ai/glm-4.7-flash", alias: "glm-flash", label: "GLM 4.7 Flash" },
  { id: "moonshotai/kimi-k2.5", alias: "kimi", label: "Kimi K2.5" },
];
