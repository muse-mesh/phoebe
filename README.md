# Phoebe — AI Telegram Bot

> A fast, lightweight AI agent for Telegram — the open-source alternative to OpenClaw.

Phoebe is a self-hosted AI Telegram bot that runs on a Raspberry Pi (or any Linux box). She connects to 26+ language models through the [Mume AI](https://mume.ai) gateway, has full terminal access via built-in tools, and can discover and use 850+ community [Agent Skills](https://agentskills.io). No cloud servers, no monthly bills — just your Pi and an API key.

## Why Phoebe over OpenClaw?

|                          | **Phoebe**                           | **OpenClaw**              |
| ------------------------ | ------------------------------------ | ------------------------- |
| **Startup**              | < 3 seconds                          | 30+ seconds               |
| **Memory**               | ~130 MB RSS                          | 500+ MB                   |
| **Tool calls**           | Inline (AI SDK native)               | MCP stdio overhead        |
| **Conversation history** | Full tool-call replay with windowing | Basic text only           |
| **Models**               | 26 models, switch per-chat           | Limited selection         |
| **Streaming**            | Real-time to Telegram                | Partial/delayed           |
| **Codebase**             | ~1,200 lines TypeScript              | 50K+ lines, complex       |
| **Dependencies**         | 6 packages                           | 100+ packages             |
| **Setup**                | `pnpm install && pnpm start`         | Wizard + config + plugins |

Phoebe does one thing well: be a fast, reliable AI agent on Telegram. No plugin system to debug, no auto-enable magic, no silent failures.

## Features

- **26+ models** — Claude, GPT, Gemini, Grok, DeepSeek, Mistral, Kimi — switchable per-chat with `/model`
- **7 built-in tools** — bash, readFile, writeFile, list_skills, activate_skill, search_skills, install_skill
- **Agent Skills** — 850+ community skills from [skills.sh](https://skills.sh), installed and managed by the bot itself
- **Tool-call history** — full `ModelMessage` objects stored with tool-call + tool-result parts, exactly as they happened
- **Smart windowing** — last 100 messages sent to model, last 30 keep full tool results, older are truncated to 10K chars
- **Persistent memory** — conversations, user profiles, model preferences survive restarts — messages never deleted from disk
- **Real-time streaming** — AI SDK v6 `streamText` with live edits to Telegram
- **Tool transparency** — shows what the bot is doing ("Running command...", "Activating skill...")
- **Per-user identity** — remembers names across conversations
- **Owner controls** — `/restart` to reboot the Pi, allowlist for access control

## Quick Start

```bash
git clone git@github.com:muse-mesh/phoebe.git
cd phoebe
pnpm install
cp .env.example .env   # fill in your secrets
pnpm start
```

### Environment Variables

```env
BOT_TOKEN=            # Telegram bot token from @BotFather
MUME_API_KEY=         # API key from mume.ai
MUME_BASE_URL=https://mume.ai/api/v1
AI_MODEL=google/gemini-3-flash-preview
MAX_STEPS=15
OWNER_ID=             # Your Telegram user ID
ALLOWED_IDS=          # Comma-separated IDs (empty = everyone)
SKILLS_DIR=           # Path to skills directory (default: ../skills)
```

## Deploy to Raspberry Pi

```bash
# SSH into the Pi and create the project directory
ssh phoebe@192.168.1.15 "mkdir -p ~/phoebe"

# Copy files from your machine
scp -r src/ package.json .env phoebe@192.168.1.15:~/phoebe/

# Install dependencies on the Pi
ssh phoebe@192.168.1.15 "cd ~/phoebe && npm install --production"

# Start with PM2
ssh phoebe@192.168.1.15 "cd ~/phoebe && pm2 start 'node --import tsx src/index.ts' --name phoebe && pm2 save"
```

### PM2 Commands

```bash
pm2 logs phoebe        # View logs
pm2 restart phoebe     # Restart
pm2 stop phoebe        # Stop
pm2 status             # Overview
```

## Project Structure

```
phoebe/
├── .env                  # Secrets (not committed)
├── .env.example          # Template
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts          # Entry — loads env, starts bot
    ├── config.ts         # Env config, 26-model catalog
    ├── persistence.ts    # ModelMessage storage, windowing, truncation
    ├── bot.ts            # grammY bot, commands, AI streaming handler
    ├── tools.ts          # 7 built-in tools + Agent Skills registry
    └── errors.ts         # Error → friendly message formatter
```

### Data Directory (auto-created, gitignored)

```
data/
├── users.json            # User profiles
├── models.json           # Per-chat model overrides
└── conversations/        # Full conversation history per chat
    └── <chatId>.json     # Array of ModelMessage objects
```

## Bot Commands

| Command          | Description                          |
| ---------------- | ------------------------------------ |
| `/start`         | Welcome message                      |
| `/status`        | Uptime, RAM, model, skills count     |
| `/tools`         | List available tools                 |
| `/skills`        | List installed Agent Skills          |
| `/models`        | Browse all 26 models                 |
| `/model <alias>` | Switch model (e.g., `/model sonnet`) |
| `/clear`         | Clear conversation history           |
| `/restart`       | Reboot the Pi (owner only)           |

### Model Aliases

| Alias      | Model                  |
| ---------- | ---------------------- |
| `sonnet`   | Claude Sonnet 4.6      |
| `opus`     | Claude Opus 4.6        |
| `haiku`    | Claude Haiku 4.5       |
| `pro`      | Gemini 3.1 Pro         |
| `flash`    | Gemini 2.5 Flash       |
| `gpt5`     | GPT-5.2                |
| `codex`    | GPT-5.1 Codex Max      |
| `deepseek` | DeepSeek V3.2          |
| `grok4`    | Grok 4 Fast            |
| `mistral`  | Mistral Small Creative |
| `kimi`     | Kimi K2.5              |

## Architecture

```
Telegram ←→ grammY (long-polling)
                │
          AI SDK v6 streamText()
                │
     @openrouter/ai-sdk-provider
                │
       Mume AI Gateway (HTTPS)
                │
     OpenRouter → Model Provider
                │
          Tool calls (if any)
           /            \
   Built-in tools      Agent Skills
   (bash, files)       (SKILL.md instructions)
          │
    Tool results → back to model
                │
       Final text streamed to Telegram
```

### How Tool-Call History Works

When the model makes tool calls, Phoebe stores the complete `ModelMessage` chain:

1. **Assistant message** with `ToolCallPart[]` (the model's function calls)
2. **Tool message** with `ToolResultPart[]` (the execution results)

These are stored in exact order in the conversation JSON. On the next turn:

- Last **100 messages** are sent as context
- Last **30 messages** keep full tool results
- Older tool results are truncated to **10,000 chars**
- Messages are **never deleted** from disk (capped at 500)

## Agent Skills

Phoebe supports the [Agent Skills](https://agentskills.io) open standard.

```
User: "find me a skill for deep research"
Phoebe: [uses search_skills] Found 3 matching skills...
User: "install the first one"
Phoebe: [uses install_skill] Done. 855 skills now installed.
User: "research quantum computing advances in 2026"
Phoebe: [uses activate_skill → reads SKILL.md → follows instructions using bash/readFile/writeFile]
```

Skills are on-demand — the model only loads a skill's instructions when it calls `activate_skill`. The 850+ installed skills are just directory names until activated.

## Roadmap

- [ ] **Multi-user conversations** — group chat support with per-user context
- [ ] **Image & document understanding** — vision model support for photos/PDFs sent to the bot
- [ ] **Voice messages** — speech-to-text input, text-to-speech responses
- [ ] **Web search tool** — built-in web search without needing a skill
- [ ] **Scheduled tasks** — "remind me" / cron-style recurring actions
- [ ] **Skill auto-update** — periodic `npx skills check && npx skills update`
- [ ] **Dashboard** — web UI for monitoring conversations, tool usage, and costs
- [ ] **Multi-bot** — run multiple Phoebe instances with different personalities
- [ ] **Plugin API** — custom tool packages beyond the built-in 7
- [ ] **RAG** — index local files for retrieval-augmented generation

## Tech Stack

- **Runtime**: Node.js v22 + [tsx](https://github.com/privatenumber/tsx)
- **Language**: TypeScript 5.9
- **AI**: [Vercel AI SDK v6](https://sdk.vercel.ai) with `streamText`
- **Telegram**: [grammY](https://grammy.dev) v1.40
- **Gateway**: [Mume AI](https://mume.ai) (OpenRouter-compatible)
- **Process Manager**: PM2
- **Hardware**: Raspberry Pi 4 (tested on 1GB RAM)

## License

MIT
