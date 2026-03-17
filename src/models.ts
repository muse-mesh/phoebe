// ── OpenRouter Model Catalog ─────────────────────────────────────────────────
// Fetches, caches, and queries the full OpenRouter model catalog.
// Models are stored on disk and only refreshed when explicitly requested.

import fs from "fs/promises";
import path from "path";
import { DATA_DIR, OPENROUTER_API_KEY } from "./config.js";
import log from "./logger.js";

const MODELS_FILE = path.join(DATA_DIR, "openrouter-models.json");
const OPENROUTER_API = "https://openrouter.ai/api/v1";
const PAGE_SIZE = 15;

// ── Types ────────────────────────────────────────────────────────────────────

export interface OpenRouterModel {
  id: string;
  name: string;
  created: number;
  description?: string;
  context_length: number | null;
  pricing: {
    prompt: string;
    completion: string;
    image?: string;
    request?: string;
  };
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
    tokenizer?: string;
    instruct_type?: string | null;
  };
  supported_parameters: string[];
  top_provider: {
    context_length: number | null;
    max_completion_tokens: number | null;
    is_moderated: boolean;
  };
}

interface ModelCatalog {
  fetchedAt: string;
  count: number;
  models: OpenRouterModel[];
}

// ── State ────────────────────────────────────────────────────────────────────

let catalog: ModelCatalog | null = null;

// ── Load / Refresh ───────────────────────────────────────────────────────────

/** Load catalog from disk, or fetch from OpenRouter if not cached. */
export async function loadModelCatalog(): Promise<void> {
  try {
    const raw = await fs.readFile(MODELS_FILE, "utf-8");
    catalog = JSON.parse(raw) as ModelCatalog;
    log.info("models", `loaded ${catalog.models.length} models from disk`, {
      fetched: catalog.fetchedAt,
    });
  } catch {
    if (!OPENROUTER_API_KEY) {
      log.warn(
        "models",
        "no cached catalog and no OPENROUTER_API_KEY — catalog empty",
      );
      catalog = { fetchedAt: "never", count: 0, models: [] };
      return;
    }
    log.info("models", "no cached catalog, fetching from OpenRouter…");
    await refreshModelCatalog();
  }
}

/** Fetch fresh model list from OpenRouter and save to disk. */
export async function refreshModelCatalog(): Promise<number> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required to fetch models");
  }

  const res = await fetch(`${OPENROUTER_API}/models`, {
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter API error ${res.status}: ${body.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as { data: any[] };

  const models: OpenRouterModel[] = (data.data ?? []).map((m: any) => ({
    id: m.id,
    name: m.name,
    created: m.created ?? 0,
    description: m.description ?? undefined,
    context_length: m.context_length ?? null,
    pricing: {
      prompt: String(m.pricing?.prompt ?? "0"),
      completion: String(m.pricing?.completion ?? "0"),
      image: m.pricing?.image != null ? String(m.pricing.image) : undefined,
      request:
        m.pricing?.request != null ? String(m.pricing.request) : undefined,
    },
    architecture: {
      input_modalities: m.architecture?.input_modalities ?? ["text"],
      output_modalities: m.architecture?.output_modalities ?? ["text"],
      tokenizer: m.architecture?.tokenizer,
      instruct_type: m.architecture?.instruct_type ?? null,
    },
    supported_parameters: m.supported_parameters ?? [],
    top_provider: {
      context_length: m.top_provider?.context_length ?? null,
      max_completion_tokens: m.top_provider?.max_completion_tokens ?? null,
      is_moderated: m.top_provider?.is_moderated ?? false,
    },
  }));

  catalog = {
    fetchedAt: new Date().toISOString(),
    count: models.length,
    models,
  };

  await fs.writeFile(MODELS_FILE, JSON.stringify(catalog, null, 2));
  log.info("models", `fetched and saved ${models.length} models`);
  return models.length;
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** All models in the catalog. */
export function getModels(): OpenRouterModel[] {
  return catalog?.models ?? [];
}

/** When the catalog was last fetched. */
export function getCatalogInfo(): { fetchedAt: string; count: number } {
  return {
    fetchedAt: catalog?.fetchedAt ?? "never",
    count: catalog?.models.length ?? 0,
  };
}

/** Paginated model listing, sorted by created desc (latest first). */
export function getModelsPage(
  page: number,
  options?: { pageSize?: number; filter?: string; freeOnly?: boolean },
): {
  models: OpenRouterModel[];
  page: number;
  totalPages: number;
  total: number;
} {
  const pageSize = options?.pageSize ?? PAGE_SIZE;
  let models = [...(catalog?.models ?? [])];

  if (options?.filter) {
    const lower = options.filter.toLowerCase();
    models = models.filter(
      (m) =>
        m.id.toLowerCase().includes(lower) ||
        m.name.toLowerCase().includes(lower),
    );
  }

  if (options?.freeOnly) {
    models = models.filter(
      (m) =>
        parseFloat(m.pricing.prompt) === 0 &&
        parseFloat(m.pricing.completion) === 0,
    );
  }

  // Sort by created descending (latest first)
  models.sort((a, b) => b.created - a.created);

  const total = models.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * pageSize;

  return {
    models: models.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    total,
  };
}

/** Find model by ID or partial match. */
export function findModel(query: string): OpenRouterModel | undefined {
  const lower = query.trim().toLowerCase();
  const models = catalog?.models ?? [];

  const exact = models.find((m) => m.id.toLowerCase() === lower);
  if (exact) return exact;

  const partial = models.find((m) => m.id.toLowerCase().includes(lower));
  if (partial) return partial;

  return models.find((m) => m.name.toLowerCase().includes(lower));
}

/** Get only free models. */
export function getFreeModels(): OpenRouterModel[] {
  return (catalog?.models ?? []).filter(
    (m) =>
      parseFloat(m.pricing.prompt) === 0 &&
      parseFloat(m.pricing.completion) === 0,
  );
}

/** Resolve a user input to a model ID. */
export function resolveModelId(input: string): string {
  const model = findModel(input);
  return model?.id ?? input.trim();
}

// ── Capability Checks ────────────────────────────────────────────────────────

export type ModelFeature =
  | "tools"
  | "vision"
  | "audio_input"
  | "audio_output"
  | "image_output"
  | "reasoning"
  | "structured_output"
  | "web_search"
  | "video_input"
  | "file_input";

/** Check whether a model supports a given feature. */
export function modelSupports(modelId: string, feature: ModelFeature): boolean {
  const model = (catalog?.models ?? []).find((m) => m.id === modelId);
  if (!model) return false;

  switch (feature) {
    case "tools":
      return model.supported_parameters.includes("tools");
    case "vision":
      return model.architecture.input_modalities.includes("image");
    case "audio_input":
      return model.architecture.input_modalities.includes("audio");
    case "audio_output":
      return model.architecture.output_modalities.includes("audio");
    case "image_output":
      return model.architecture.output_modalities.includes("image");
    case "video_input":
      return model.architecture.input_modalities.includes("video");
    case "file_input":
      return model.architecture.input_modalities.includes("file");
    case "reasoning":
      return model.supported_parameters.includes("reasoning");
    case "structured_output":
      return model.supported_parameters.includes("structured_outputs");
    case "web_search":
      return model.supported_parameters.includes("web_search_options");
    default:
      return false;
  }
}

/** Get a summary of model capabilities as labels. */
export function getModelCapabilities(modelId: string): string[] {
  const model = (catalog?.models ?? []).find((m) => m.id === modelId);
  if (!model) return [];

  const caps: string[] = [];
  if (model.supported_parameters.includes("tools")) caps.push("tools");
  if (model.architecture.input_modalities.includes("image"))
    caps.push("vision");
  if (model.architecture.input_modalities.includes("audio"))
    caps.push("audio-in");
  if (model.architecture.output_modalities.includes("audio"))
    caps.push("audio-out");
  if (model.architecture.output_modalities.includes("image"))
    caps.push("image-gen");
  if (model.architecture.input_modalities.includes("video")) caps.push("video");
  if (model.architecture.input_modalities.includes("file")) caps.push("files");
  if (model.supported_parameters.includes("reasoning")) caps.push("reasoning");
  if (model.supported_parameters.includes("structured_outputs"))
    caps.push("structured");
  if (model.supported_parameters.includes("web_search_options"))
    caps.push("web-search");
  return caps;
}

// ── Formatting Helpers ───────────────────────────────────────────────────────

/** Format pricing as human-readable string (per million tokens). */
export function formatPrice(pricing: {
  prompt: string;
  completion: string;
}): string {
  const pIn = parseFloat(pricing.prompt) * 1_000_000;
  const pOut = parseFloat(pricing.completion) * 1_000_000;
  if (pIn === 0 && pOut === 0) return "free";
  const fmt = (n: number) =>
    n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2);
  return `$${fmt(pIn)}/$${fmt(pOut)}`;
}

/** Format context length as human-readable string. */
export function formatContextLength(length: number | null): string {
  if (length == null) return "?";
  if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(1)}M`;
  if (length >= 1_000) return `${Math.round(length / 1_000)}K`;
  return `${length}`;
}
