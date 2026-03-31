// ── Security ──────────────────────────────────────────────────────────────────
// Command & path validation to prevent the AI agent from:
//   1. Modifying its own source code or configuration
//   2. Running destructive / dangerous system commands
//   3. Exfiltrating secrets or credentials
//   4. Performing network attacks
//   5. Escaping its intended scope

import path from "path";
import log from "./logger.js";

// ── Constants ────────────────────────────────────────────────────────────────

// The project root directory (one level up from src/)
const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

// Protected paths within the project that the agent must never modify
const PROTECTED_PROJECT_PATHS = [
  "src/",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  ".env",
  "ecosystem.config.cjs",
  "ARCHITECTURE.md",
  "README.md",
  ".git/",
  "node_modules/",
];

// ── Dangerous Command Patterns ───────────────────────────────────────────────
// Each entry: [regex, human-readable reason]

const BLOCKED_COMMANDS: [RegExp, string][] = [
  // Destructive filesystem operations
  [
    /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?(\/|~\/?\s|\.\.\/)/i,
    "recursive delete on system/parent paths",
  ],
  [/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\//i, "rm -rf on root paths"],
  [/\brm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+\//i, "rm -rf on root paths"],
  [/\bmkfs\b/i, "filesystem format"],
  [/\bdd\s+.*\bof=\/dev\//i, "raw disk write"],

  // System control
  [/\bshutdown\b/i, "system shutdown"],
  [/\breboot\b/i, "system reboot"],
  [/\bpoweroff\b/i, "system poweroff"],
  [/\bhalt\b/i, "system halt"],
  [/\binit\s+[06]\b/, "init level change"],
  [/\bsystemctl\s+(poweroff|reboot|halt)\b/i, "systemd power control"],

  // Fork bombs & resource exhaustion
  [/:\(\)\s*\{.*\|.*&\s*\}\s*;/, "fork bomb"],
  [/\bwhile\s+true.*do.*done/i, "infinite loop"],

  // Process manager manipulation (prevent stopping/deleting itself)
  [/\bpm2\s+(delete|kill|stop)\s+(all|phoebe)\b/i, "PM2 self-destruction"],

  // Privilege escalation
  [/\bchmod\s+[0-7]*777\b/, "world-writable permissions"],
  [/\bchmod\s+[u+]*s\b/, "setuid bit modification"],
  [/\bpasswd\b/, "password change"],
  [/\busermod\b/, "user modification"],
  [/\buseradd\b/, "user creation"],
  [/\bvisudo\b/, "sudoers modification"],

  // Network attacks / exfiltration / binding servers
  [/\bnc\s+-[a-zA-Z]*l/i, "netcat listener (reverse shell)"],
  [/\bncat\s+-[a-zA-Z]*l/i, "ncat listener"],
  [/\bsocat\b.*\blisten\b/i, "socat listener"],
  [/\b(curl|wget)\s+.*\|\s*(ba)?sh\b/i, "pipe remote script to shell"],
  [
    /\b(curl|wget)\s+.*--output\s*-\s*\|\s*(ba)?sh\b/i,
    "pipe remote script to shell",
  ],
  // Credential / secret exfiltration
  [/\bcat\s+.*\.env\b/i, "reading env secrets"],
  [/\bcat\s+.*\/etc\/shadow\b/i, "reading shadow file"],
  [/\bcat\s+.*id_rsa\b/i, "reading SSH private key"],

  // Modifying phoebe's source code via shell commands
  [/\b(sed|awk|perl)\s+-i.*\bsrc\//i, "in-place edit of source code"],
  [/\b(vim|nano|vi|emacs)\s+.*\bsrc\//i, "editing source code"],
  [
    /\bgit\s+(push|reset\s+--hard|checkout\s+--)\b/i,
    "destructive git operations",
  ],

  // Cron / persistence
  [/\bcrontab\s+-[re]/i, "crontab modification"],

  // Kernel / module manipulation
  [/\binsmod\b/, "kernel module insertion"],
  [/\brmmod\b/, "kernel module removal"],
  [/\bmodprobe\b/, "kernel module loading"],

  // iptables / firewall
  [/\biptables\s+.*-[ADI]\b/i, "firewall rule modification"],
  [/\bufw\s+(allow|deny|delete|reset)\b/i, "firewall modification"],
];

// ── Validation Functions ─────────────────────────────────────────────────────

export interface SecurityResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Validate a bash command before execution.
 * Returns { allowed: true } or { allowed: false, reason: "..." }
 */
export function validateBashCommand(command: string): SecurityResult {
  // Check against blocked patterns
  for (const [pattern, reason] of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      log.warn("security", `BLOCKED bash command: ${reason}`, {
        command: command.slice(0, 200),
      });
      return { allowed: false, reason: `Blocked: ${reason}` };
    }
  }

  // Check if command attempts to modify protected project files
  if (isCommandTargetingProject(command)) {
    log.warn("security", "BLOCKED: command targets project source", {
      command: command.slice(0, 200),
    });
    return {
      allowed: false,
      reason: "Cannot modify Phoebe's own source code or configuration",
    };
  }

  return { allowed: true };
}

/**
 * Check if a bash command is trying to write/modify files in the project directory.
 * Looks for write-oriented commands targeting the project src/, config files, etc.
 */
function isCommandTargetingProject(command: string): boolean {
  const writeCommands = [
    /\b(echo|cat|tee|printf)\s+.*>\s*.*\b(src\/|package\.json|\.env|tsconfig|ecosystem)/i,
    /\b(cp|mv|rm)\s+.*\b(src\/|package\.json|\.env|tsconfig|ecosystem)/i,
    /\b(sed|awk|perl)\s+-i.*\b(src\/|package\.json|\.env|tsconfig|ecosystem)/i,
    /\bchmod\b.*\b(src\/|package\.json|\.env)/i,
  ];

  for (const pattern of writeCommands) {
    if (pattern.test(command)) return true;
  }

  return false;
}

/**
 * Validate a file path for readFile/writeFile operations.
 * Blocks writes to the project's own source code and sensitive system paths.
 */
export function validateFilePath(
  filePath: string,
  operation: "read" | "write",
): SecurityResult {
  const resolved = path.resolve(filePath);

  // Block writes to project source directory
  if (operation === "write") {
    const relToProject = path.relative(PROJECT_ROOT, resolved);

    // If the resolved path is within the project directory
    if (!relToProject.startsWith("..") && !path.isAbsolute(relToProject)) {
      // Check if it targets a protected path
      for (const protectedPath of PROTECTED_PROJECT_PATHS) {
        if (
          relToProject === protectedPath.replace(/\/$/, "") ||
          relToProject.startsWith(protectedPath)
        ) {
          log.warn("security", `BLOCKED write to project file`, {
            path: resolved,
          });
          return {
            allowed: false,
            reason: `Cannot write to Phoebe's own ${protectedPath.replace(/\/$/, "")}`,
          };
        }
      }
    }

    // Block writes to sensitive system paths
    const blockedSystemPaths = [
      "/etc/",
      "/boot/",
      "/usr/",
      "/sbin/",
      "/bin/",
      "/lib/",
      "/var/log/",
      "/proc/",
      "/sys/",
    ];

    for (const blocked of blockedSystemPaths) {
      if (resolved.startsWith(blocked)) {
        log.warn("security", `BLOCKED write to system path`, {
          path: resolved,
        });
        return {
          allowed: false,
          reason: `Cannot write to system path: ${blocked}`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Get the project root path (useful for logging).
 */
export function getProjectRoot(): string {
  return PROJECT_ROOT;
}
