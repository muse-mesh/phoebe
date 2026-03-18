// ── Tools ────────────────────────────────────────────────────────────────────
// All tools the model can use: bash, readFile, writeFile, and Agent Skills.

import { execFile, execSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import { tool } from "ai";
import { z } from "zod";
import { SKILLS_DIR } from "./config.js";
import log from "./logger.js";
import { validateBashCommand, validateFilePath } from "./security.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface SkillEntry {
  name: string;
  description: string;
  path: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const BASH_TIMEOUT = 20 * 60 * 1000; // 20 minutes per command
const MAX_OUTPUT = 50_000;
const HOME = process.env.HOME ?? "/home/phoebe";
const GLOBAL_SKILLS_DIR = path.join(HOME, ".agents", "skills");

// ── Tool Action Callback ─────────────────────────────────────────────────────
// Called by each tool execute() to notify the user what's happening.
// Set by stream.ts before each request; cleared after.

type ToolActionCallback = (toolName: string, detail: string) => void;
let _onToolAction: ToolActionCallback | null = null;

export function setToolActionCallback(cb: ToolActionCallback | null): void {
  _onToolAction = cb;
}

function notifyToolAction(toolName: string, detail: string): void {
  if (_onToolAction) _onToolAction(toolName, detail);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + `\n... (truncated, ${str.length} total chars)`;
}

function execBash(
  command: string,
  opts: { timeout?: number; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      "bash",
      ["-lc", command],
      {
        timeout: opts.timeout ?? BASH_TIMEOUT,
        maxBuffer: 10 * 1024 * 1024,
        cwd: opts.cwd ?? HOME,
        env: {
          ...process.env,
          TERM: "dumb",
          LANG: "en_US.UTF-8",
          DEBIAN_FRONTEND: "noninteractive",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
      (error, stdout, stderr) => {
        const code = error
          ? typeof error.code === "number"
            ? error.code
            : 1
          : 0;
        resolve({
          stdout: truncate(stdout ?? "", MAX_OUTPUT),
          stderr: truncate(stderr ?? "", MAX_OUTPUT),
          exitCode: code,
        });
      },
    );
  });
}

// ── Skill Registry ───────────────────────────────────────────────────────────

let skillRegistry: SkillEntry[] = [];

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) result[key] = value;
  }
  return result;
}

async function scanSkillDir(
  dir: string,
  registry: SkillEntry[],
  seen: Set<string>,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || seen.has(entry.name)) continue;
    const skillDir = path.join(dir, entry.name);
    try {
      const content = await fs.readFile(
        path.join(skillDir, "SKILL.md"),
        "utf-8",
      );
      const fm = parseFrontmatter(content);
      if (fm?.name && fm?.description) {
        seen.add(entry.name);
        registry.push({
          name: fm.name,
          description: fm.description,
          path: skillDir,
        });
      }
    } catch {}
  }
}

export async function discoverSkills(): Promise<SkillEntry[]> {
  skillRegistry = [];
  try {
    await fs.mkdir(SKILLS_DIR, { recursive: true });
  } catch {}

  const seen = new Set<string>();

  // Project-local skills take priority
  await scanSkillDir(SKILLS_DIR, skillRegistry, seen);
  // Then global ~/.agents/skills
  await scanSkillDir(GLOBAL_SKILLS_DIR, skillRegistry, seen);

  log.info("skills", `discovered ${skillRegistry.length} skills`);
  return skillRegistry;
}

export function getSkillCount(): number {
  return skillRegistry.length;
}

// ── Build All Tools ──────────────────────────────────────────────────────────

export function buildTools() {
  const bash = tool({
    description:
      "Run a bash command. Returns stdout, stderr, exit code. " +
      "Login shell with full PATH. Background with & for long tasks.",
    inputSchema: z.object({
      command: z.string().describe("Bash command to execute."),
      timeout: z
        .number()
        .optional()
        .describe("Timeout in ms (default: 1200000 / 20 min)."),
      cwd: z.string().optional().describe("Working directory (default: home)."),
    }),
    execute: async ({ command, timeout, cwd }) => {
      if (!command) return "Error: no command provided";

      // Security check
      const check = validateBashCommand(command);
      if (!check.allowed) {
        log.warn("security", `bash command blocked`, {
          reason: check.reason,
          command: command.slice(0, 200),
        });
        return `⛔ Security: ${check.reason}. This command is not allowed.`;
      }

      notifyToolAction("bash", command);
      log.toolCall("bash", {
        command,
        ...(timeout ? { timeout } : {}),
        ...(cwd ? { cwd } : {}),
      });
      const t0 = Date.now();
      const result = await execBash(command, {
        timeout: timeout ?? BASH_TIMEOUT,
        cwd,
      });
      let output = result.stdout;
      if (result.stderr)
        output += (output ? "\n" : "") + `STDERR:\n${result.stderr}`;
      if (result.exitCode !== 0) output += `\n(exit code: ${result.exitCode})`;
      log.toolResult(
        "bash",
        result.exitCode === 0 ? "ok" : "error",
        output || "(no output)",
        Date.now() - t0,
      );
      return output || "(no output)";
    },
  });

  const readFile = tool({
    description:
      "Read a file's contents. Use instead of cat for cleaner output.",
    inputSchema: z.object({
      filePath: z
        .string()
        .describe("File path (absolute or relative to home)."),
    }),
    execute: async ({ filePath }) => {
      if (!filePath) return "Error: no path provided";
      const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(HOME, filePath);

      // Security check
      const check = validateFilePath(resolved, "read");
      if (!check.allowed) {
        log.warn("security", `readFile blocked`, {
          reason: check.reason,
          path: resolved,
        });
        return `⛔ Security: ${check.reason}`;
      }

      notifyToolAction("readFile", resolved);
      log.toolCall("readFile", { filePath: resolved });
      try {
        const t0 = Date.now();
        const content = await fs.readFile(resolved, "utf-8");
        log.toolResult("readFile", "ok", content, Date.now() - t0);
        return truncate(content, MAX_OUTPUT);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error reading ${resolved}: ${msg}`;
      }
    },
  });

  const writeFile = tool({
    description:
      "Write content to a file. Creates parent directories if needed.",
    inputSchema: z.object({
      filePath: z
        .string()
        .describe("File path (absolute or relative to home)."),
      content: z.string().describe("Content to write."),
    }),
    execute: async ({ filePath, content }) => {
      if (!filePath) return "Error: no path provided";
      const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(HOME, filePath);

      // Security check
      const check = validateFilePath(resolved, "write");
      if (!check.allowed) {
        log.warn("security", `writeFile blocked`, {
          reason: check.reason,
          path: resolved,
        });
        return `⛔ Security: ${check.reason}`;
      }

      notifyToolAction("writeFile", `${resolved} (${content.length} chars)`);
      log.toolCall("writeFile", { filePath: resolved, chars: content.length });
      try {
        const t0 = Date.now();
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, content, "utf-8");
        log.toolResult(
          "writeFile",
          "ok",
          `Wrote ${content.length} chars to ${resolved}`,
          Date.now() - t0,
        );
        return `Wrote ${content.length} chars to ${resolved}`;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error writing ${resolved}: ${msg}`;
      }
    },
  });

  const list_skills = tool({
    description: "List installed Agent Skills. Optionally filter by keyword.",
    inputSchema: z.object({
      filter: z.string().optional().describe("Optional keyword to filter by."),
    }),
    execute: async ({ filter: rawFilter }) => {
      await discoverSkills();
      if (skillRegistry.length === 0)
        return "No skills installed. Use search_skills + install_skill to add some.";
      const filter = (rawFilter ?? "").toLowerCase().trim();
      let skills = skillRegistry;
      if (filter) {
        skills = skillRegistry.filter(
          (s) =>
            s.name.toLowerCase().includes(filter) ||
            s.description.toLowerCase().includes(filter),
        );
        if (skills.length === 0)
          return `No skills match "${filter}". Try search_skills.`;
      }
      if (filter || skills.length <= 50) {
        return (
          `${skills.length} skills:\n` +
          skills
            .map((s) => `- ${s.name}: ${s.description.slice(0, 100)}`)
            .join("\n")
        );
      }
      return `${skills.length} skills installed. Use filter to narrow down.\n\n${skills.map((s) => s.name).join(", ")}`;
    },
  });

  const activate_skill = tool({
    description:
      "Load a skill's full SKILL.md instructions. Call before using a skill.",
    inputSchema: z.object({
      name: z.string().describe("Skill name (from list_skills)."),
    }),
    execute: async ({ name }) => {
      if (!name) return "Error: name required.";
      let skill =
        skillRegistry.find((s) => s.name === name) ??
        skillRegistry.find((s) =>
          s.name.toLowerCase().includes(name.toLowerCase()),
        );
      if (!skill) {
        await discoverSkills();
        skill =
          skillRegistry.find((s) => s.name === name) ??
          skillRegistry.find((s) =>
            s.name.toLowerCase().includes(name.toLowerCase()),
          );
      }
      if (!skill)
        return `Skill "${name}" not found. Use list_skills to browse.`;
      try {
        let content = await fs.readFile(
          path.join(skill.path, "SKILL.md"),
          "utf-8",
        );
        log.info("skills", `activated: ${skill.name}`, {
          chars: content.length,
        });
        // Cap skill content to avoid overwhelming the context with huge instructions
        if (content.length > 3000) {
          content =
            content.slice(0, 3000) +
            "\n... (truncated — follow the pattern above, work in small increments)";
        }
        return `=== SKILL: ${skill.name} ===\n\n${content}\n\n=== END ===\nSkill dir: ${skill.path}`;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: ${msg}`;
      }
    },
  });

  const search_skills = tool({
    description: "Search for skills on skills.sh by keyword.",
    inputSchema: z.object({
      query: z.string().describe("Search keyword."),
    }),
    execute: async ({ query }) => {
      if (!query) return "Error: query required.";
      try {
        notifyToolAction("search_skills", query);
        log.toolCall("search_skills", { query });
        const result = execSync(
          `npx -y skills find "${query}" 2>/dev/null || echo "Search completed"`,
          {
            timeout: 30000,
            encoding: "utf-8",
            env: { ...process.env, CI: "1" },
          },
        );
        return result.trim() || "No results. Browse https://skills.sh";
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Search failed: ${msg}`;
      }
    },
  });

  const install_skill = tool({
    description:
      "Install a skill from skills.sh. Use owner/repo@skill format from search results (e.g. 'steipete/clawdis@weather').",
    inputSchema: z.object({
      source: z
        .string()
        .describe(
          "Skill source in owner/repo@skill format (from search_skills results).",
        ),
    }),
    execute: async ({ source }) => {
      if (!source) return "Error: source required.";

      // Normalise source: convert "owner/repo/skill" → "owner/repo@skill"
      // The skills CLI requires @ to separate skill name from repo
      const parts = source.split("/");
      let normalised = source;
      if (parts.length === 3 && !source.includes("@")) {
        normalised = `${parts[0]}/${parts[1]}@${parts[2]}`;
      }

      try {
        const cmd = `npx -y skills add "${normalised}" --copy -y -g`;
        notifyToolAction("install_skill", normalised);
        log.toolCall("install_skill", { source: normalised, cmd });
        const result = execSync(cmd, {
          timeout: 120000,
          encoding: "utf-8",
          cwd: SKILLS_DIR,
          env: { ...process.env, CI: "1" },
        });
        log.info("skills", `install output: ${result.trim().slice(0, 500)}`);
        // Copy newly installed skills from global agents dir into our skills dir
        try {
          execSync(
            `cp -rn ~/.agents/skills/* "${SKILLS_DIR}/" 2>/dev/null || true`,
            { encoding: "utf-8", timeout: 5000 },
          );
        } catch {}
        await discoverSkills();
        return `Done.\n${result.trim()}\n\n${skillRegistry.length} skills now installed.`;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("skills", `install error: ${msg.slice(0, 500)}`);
        // execSync throws on non-zero exit; try the copy fallback anyway
        try {
          execSync(
            `cp -rn ~/.agents/skills/* "${SKILLS_DIR}/" 2>/dev/null || true`,
            { encoding: "utf-8", timeout: 5000 },
          );
        } catch {}
        await discoverSkills();
        return `Install failed: ${msg}\n\n${skillRegistry.length} skills currently available.`;
      }
    },
  });

  return {
    bash,
    readFile,
    writeFile,
    list_skills,
    activate_skill,
    search_skills,
    install_skill,
  };
}
