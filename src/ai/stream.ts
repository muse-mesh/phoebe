// ── AI Stream ────────────────────────────────────────────────────────────────
// Interface-agnostic AI streaming core. Used by both Telegram and Web channels.

import { streamText, stepCountIs } from "ai";
import type { ModelMessage, UserContent } from "ai";
import {
  buildTools,
  setToolActionCallback,
  setSessionSkillsDir,
} from "../tools.js";
import { formatError } from "../errors.js";
import { buildPrompt } from "../bot/prompt.js";
import { resolveProvider } from "../bot/instance.js";
import { MAX_STEPS } from "../config.js";
import type { OutputChannel } from "./channel.js";
import log from "../logger.js";

// ── Constants ────────────────────────────────────────────────────────────────

const STREAM_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes per request
const RESPONSE_COLLECT_TIMEOUT_MS = 30_000; // 30s max to collect response after stream ends

// ── Tools ────────────────────────────────────────────────────────────────────

const tools = buildTools();
export const toolNames = Object.keys(tools);

// ── Result Type ──────────────────────────────────────────────────────────────

export interface StreamResult {
  fullText: string;
  responseMessages: ModelMessage[];
  timedOut: boolean;
  toolStepCount: number;
}

// ── Core ─────────────────────────────────────────────────────────────────────

export async function runAIStream(opts: {
  channel: OutputChannel;
  modelId: string;
  userName: string;
  contextMessages: ModelMessage[];
  userContent: UserContent;
  abortSignal?: AbortSignal;
  sessionSkillsDir?: string;
  sessionTitle?: string;
}): Promise<StreamResult> {
  const { channel, modelId, userName, contextMessages } = opts;

  // ── Log incoming request ───────────────────────────────────────────────
  const contentPreview =
    typeof opts.userContent === "string"
      ? opts.userContent
      : Array.isArray(opts.userContent)
        ? opts.userContent
            .map((p) => (p.type === "text" ? p.text : `[${p.type}]`))
            .join(" ")
        : "[content]";
  log.separator(`request → ${modelId}`);
  log.userMessage(
    "ai",
    { user: userName, model: modelId, contextMsgs: contextMessages.length },
    contentPreview,
  );

  const requestStart = Date.now();

  await channel.sendTyping();

  const typingInterval = setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, 4000);

  let toolStepCount = 0;

  const systemPrompt = buildPrompt(userName, opts.sessionTitle);
  let sentTextLength = 0;

  // Wire up tool action notifications — tools.ts execute() calls this callback
  // when a tool starts, so the user sees what's happening in real time.
  setToolActionCallback((toolName, detail) => {
    channel.sendToolAction(toolName, detail).catch(() => {});
  });

  // Set session skills directory so skill tools operate on the active session
  if (opts.sessionSkillsDir) {
    setSessionSkillsDir(opts.sessionSkillsDir);
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    log.warn("ai", "timeout fired — aborting stream", {
      after: `${STREAM_TIMEOUT_MS / 1000}s`,
    });
    abortController.abort();
  }, STREAM_TIMEOUT_MS);

  // Chain external abort signal (e.g. from per-chat cancellation)
  if (opts.abortSignal) {
    if (opts.abortSignal.aborted) {
      abortController.abort();
    } else {
      opts.abortSignal.addEventListener(
        "abort",
        () => {
          log.info("ai", "externally aborted (new message or cancel)");
          abortController.abort();
        },
        { once: true },
      );
    }
  }

  let result;
  try {
    result = streamText({
      model: resolveProvider(modelId),
      system: systemPrompt,
      messages: contextMessages,
      tools,
      abortSignal: abortController.signal,
      stopWhen: stepCountIs(MAX_STEPS),
      onStepFinish: (step) => {
        try {
          const toolCalls = step.toolCalls ?? [];
          const stepText = (step.text ?? "").trim();

          // Log any reasoning / thinking text the model produced this step
          if (stepText && toolCalls.length === 0) {
            log.block("ai", "reasoning", stepText, 600);
          }

          if (toolCalls.length > 0) {
            toolStepCount++;

            // Also send any reasoning text that came with tool calls
            if (stepText) {
              log.block("ai", "thinking (with tools)", stepText, 400);
              channel.sendText(stepText).catch((e: unknown) => {
                log.error("ai", "sendText (thinking) failed", {}, e);
              });
              sentTextLength += (step.text ?? "").length;
            }

            const names = toolCalls.map((tc) => tc.toolName).join(", ");
            log.info("agent", `step ${toolStepCount}`, {
              tools: names,
              reason: step.finishReason,
              ...(stepText ? { textLen: `${stepText.length}ch` } : {}),
            });

            // Log each tool call
            for (const tc of toolCalls) {
              log.toolCall(tc.toolName, (tc as any).args ?? {});
            }

            // Send tool results to user so they see output even if
            // the model responds with a lazy "Executed command".
            const toolResults: any[] = step.toolResults ?? [];

            for (const tr of toolResults) {
              const toolName: string = tr.toolName ?? "tool";
              const res = tr.output ?? tr.result;
              const resultStr =
                res === undefined || res === null
                  ? "(no result)"
                  : typeof res === "string"
                    ? res
                    : (JSON.stringify(res, null, 2) ?? "(unserializable)");
              log.toolResult(toolName, "ok", resultStr, 0);

              channel
                .sendToolResult(toolName, resultStr)
                .catch((e: unknown) => {
                  log.error("ai", "sendToolResult failed", { toolName }, e);
                });
            }
          }
        } catch (stepErr) {
          log.error("ai", "onStepFinish error", {}, stepErr);
        }
      },
    });
  } catch (initErr) {
    clearTimeout(timeoutId);
    clearInterval(typingInterval);
    setToolActionCallback(null);
    setSessionSkillsDir(null);
    await channel.sendError(formatError(initErr));
    return {
      fullText: "",
      responseMessages: [],
      timedOut: false,
      toolStepCount: 0,
    };
  }

  // Collect streamed text — log every chunk in real time
  let fullText = "";
  let timedOut = false;
  let streamStarted = false;
  try {
    for await (const chunk of result.textStream) {
      if (!streamStarted) {
        // Print header before first chunk so we know streaming has begun
        log.info("ai", "streaming response…");
        streamStarted = true;
      }
      fullText += chunk;
      log.streamChunk(chunk);
      channel.onStreamChunk(chunk);
    }
    if (streamStarted) log.streamEnd();
  } catch (err) {
    if (abortController.signal.aborted) {
      timedOut = true;
      log.warn("ai", "request timed out", {
        after: `${STREAM_TIMEOUT_MS / 1000}s`,
        steps: toolStepCount,
      });
    } else {
      log.error("ai", "stream error", {}, err);
      clearTimeout(timeoutId);
      clearInterval(typingInterval);
      setToolActionCallback(null);
      setSessionSkillsDir(null);
      await channel.sendError(formatError(err));
      return { fullText, responseMessages: [], timedOut: false, toolStepCount };
    }
  }

  clearTimeout(timeoutId);
  clearInterval(typingInterval);
  setToolActionCallback(null);
  setSessionSkillsDir(null);

  // Collect response messages (with timeout to prevent hanging after abort)
  let responseMessages: ModelMessage[] = [];
  try {
    const resp = await Promise.race([
      result.response,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("response collect timeout")),
          RESPONSE_COLLECT_TIMEOUT_MS,
        ),
      ),
    ]);
    responseMessages = resp.messages ?? [];
  } catch (e) {
    log.warn("ai", "could not collect response messages", {
      reason: e instanceof Error ? e.message : "unknown",
    });
  }

  // Handle timeout
  if (timedOut) {
    const partial = fullText.trim();
    if (partial) await channel.sendText(partial);
    await channel.sendError(
      "Request timed out. Try a simpler request, or /clear to reset.",
    );
    return { fullText, responseMessages, timedOut: true, toolStepCount };
  }

  // Handle empty response
  if (!fullText.trim()) {
    try {
      const finishReason = await result.finishReason;
      log.info("ai", "empty response", { finishReason, model: modelId });
      if (finishReason === "error" || finishReason === "other") {
        await channel.sendError(
          `Model error (${modelId}). Try switching models.`,
        );
        return {
          fullText: "",
          responseMessages,
          timedOut: false,
          toolStepCount,
        };
      }
    } catch (err) {
      await channel.sendError(formatError(err));
      return { fullText: "", responseMessages, timedOut: false, toolStepCount };
    }

    if (toolStepCount > 0) {
      if (sentTextLength > 0) {
        fullText = fullText || "Executed command";
      } else {
        fullText = "Executed command";
      }
      // Reset sentTextLength so the synthetic "Executed command" isn't sliced away
      sentTextLength = 0;
    } else {
      await channel.sendError(
        `Empty response from ${modelId}. Try switching models or clearing context.`,
      );
      return { fullText: "", responseMessages, timedOut: false, toolStepCount };
    }
  }

  const remainingText =
    sentTextLength > 0
      ? fullText.slice(sentTextLength).trim()
      : fullText.trim();

  await channel.onStreamDone(remainingText);

  // ── Log final response ──────────────────────────────────────────────────
  const elapsed = Date.now() - requestStart;
  log.aiResponse(modelId, fullText, {
    steps: toolStepCount,
    chars: fullText.length,
    elapsed: `${(elapsed / 1000).toFixed(1)}s`,
  });
  log.separator();

  return { fullText, responseMessages, timedOut, toolStepCount };
}
