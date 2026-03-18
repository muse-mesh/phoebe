<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-22-green?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/AI_SDK-v6-black?logo=vercel&logoColor=white" alt="AI SDK" />
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License" />
</p>

        ██████╗ ██╗  ██╗ ██████╗ ███████╗██████╗ ███████╗
        ██╔══██╗██║  ██║██╔═══██╗██╔════╝██╔══██╗██╔════╝
        ██████╔╝███████║██║   ██║█████╗  ██████╔╝█████╗
        ██╔═══╝ ██╔══██║██║   ██║██╔══╝  ██╔══██╗██╔══╝
        ██║     ██║  ██║╚██████╔╝███████╗██████╔╝███████╗
        ╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═════╝ ╚══════╝

**A self-hosted AI agent with full tool access — delivered through Telegram.**

Phoebe runs in a Docker container on your own hardware. She connects to any model on [Mume AI](https://mume.ai) (Gemini, Claude, GPT, Llama, etc.) or to your local [Ollama](https://ollama.com) server, has unrestricted terminal access inside the container, can read and write files, and extends herself with 850+ community [Agent Skills](https://agentskills.io).

No vendor lock-in. No cloud dependency. One `docker compose up` and you're running.

---

## Table of Contents

- [Why Self-Host an AI Agent?](#why-self-host-an-ai-agent)
- [Features](#features)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Bot Commands](#bot-commands)
- [Built-in Tools](#built-in-tools)
- [Agent Skills](#agent-skills)
- [Voice](#voice)
- [Security Model](#security-model)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Development](#development)
- [Docker Reference](#docker-reference)
- [Contributing](#contributing)
- [License](#license)

---

## Why Self-Host an AI Agent?

- **Privacy** — your conversations never leave your infrastructure
- **Control** — full bash access inside a sandboxed container, on your terms
- **Cost transparency** — pay only for model API calls, no platform markup
- **Extensibility** — 850+ Agent Skills, or write your own
- **Portability** — runs on a Raspberry Pi, a NAS, a VPS, or your laptop

---

## Features

### Multi-Model Support

Access thousands of AI models through [Mume AI](https://mume.ai), or run models locally with [Ollama](https://ollama.com). Switch models mid-conversation with `/model <id>`. Browse the full catalog with `/models`, filter by name or free tier, and paginate with inline keyboard navigation. Each model's capabilities (tools, vision, audio, reasoning, etc.) are detected and displayed.

**Cloud models** connect through Mume AI — Gemini, Claude, GPT, Llama, and hundreds more.
**Local models** run on your own GPU via Ollama — fully offline, zero API costs. Set `OLLAMA_BASE_URL` and local models appear in the catalog prefixed with `ollama/` (e.g. `ollama/llama3.2`, `ollama/qwen3:8b`).

### Multi-Session Conversations

Organise work into **named sessions** — each with its own conversation history and skills. Sessions persist across container restarts.

- `/session` — list all sessions with inline keyboard for quick switching
- `/session new [title]` — create a new session (auto-titled from first message if no title given)
- `/session rename <title>` — rename the current session
- `/session delete <id>` — delete a session
- `/session <id>` — switch to a session by ID

Legacy single-conversation files migrate automatically on first access.

### Telegram Interface

Full-featured bot via [grammY](https://grammy.dev), with streaming typing indicators, inline tool transparency, tool result output, image/document understanding, and voice messages.

### Agentic Tool Use

Seven built-in tools give the AI full agency inside the container:

| Tool             | What it does                                                                     |
| ---------------- | -------------------------------------------------------------------------------- |
| `bash`           | Run any shell command with full PATH. Background commands (`&`) handled safely.  |
| `readFile`       | Read file contents                                                               |
| `writeFile`      | Create or overwrite files, auto-creates parent directories                       |
| `list_skills`    | List installed Agent Skills (session-scoped + shared + global)                   |
| `activate_skill` | Load a skill's instructions into context                                         |
| `search_skills`  | Search the [skills.sh](https://skills.sh) registry                               |
| `install_skill`  | Install a skill from the registry (into active session's skills dir)             |

Tool calls chain automatically — the model can call tools, inspect results, and call more tools, up to 25 steps per message (configurable).

### Agent Skills

An open plugin system powered by [Agent Skills](https://agentskills.io). Skills are Markdown instruction files the AI loads on demand. The model discovers, installs, and activates skills autonomously:

```
You:    "find me a skill for deep research"
Phoebe: [searches skills.sh] Found 3 matching skills...
You:    "install the first one"
Phoebe: [installs skill] Done. Now at 5 installed skills.
You:    "research quantum computing advances in 2026"
Phoebe: [activates skill → follows SKILL.md instructions using bash/readFile/writeFile]
```

### Voice

- **Speech-to-text** — send a voice message, Phoebe transcribes it (ElevenLabs Scribe V2 via fal.ai)
- **Text-to-speech** — toggle `/voicereply` to get audio responses. 21 ElevenLabs voices, switchable with `/voice`

### Conversation Memory

- Full `ModelMessage` objects stored with tool-call and tool-result parts, exactly as they happened
- Last 100 messages sent as context, last 30 keep full tool results, older results truncated to 10K chars
- Each session has its own isolated conversation history
- Conversations, user profiles, model preferences, voice settings, and session indices persist across container restarts via Docker volumes

### Security

A layered defense system runs inside the container:

- Blocked commands: `rm -rf /`, fork bombs, reverse shells, privilege escalation, secret exfiltration, and more
- Protected paths: source code, `.env`, `package.json`, system directories are write-protected
- All validations enforced at the tool level — the AI cannot bypass them through prompt injection

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An API key from [Mume AI](https://mume.ai)

### 1. Clone and configure

```bash
git clone https://github.com/muse-mesh/phoebe.git
cd phoebe
cp .env.example .env
```

Edit `.env` with your keys (see [Configuration](#configuration)).

### 2. Start

```bash
docker compose up -d
```

That's it. Phoebe is live. Open your bot in Telegram and send a message.

### 3. Verify

```bash
docker compose logs -f    # Watch startup logs
```

You should see Phoebe connect to Telegram and report her status to the owner.

---

## Configuration

### Required

| Variable       | Description                                                      |
| -------------- | ---------------------------------------------------------------- |
| `BOT_TOKEN`    | Telegram bot token from [@BotFather](https://t.me/BotFather)     |
| `MUME_API_KEY` | API key from [mume.ai](https://mume.ai)                          |
| `OWNER_ID`     | Your Telegram user ID (for startup notifications and `/restart`) |

### Optional

| Variable          | Default                         | Description                                            |
| ----------------- | ------------------------------- | ------------------------------------------------------ |
| `MUME_BASE_URL`   | `https://mume.ai/api/v1`        | Mume AI gateway endpoint                               |
| `CATALOG_API_KEY` | —                               | For fetching the model catalog                         |
| `AI_MODEL`        | `google/gemini-3-flash-preview` | Default model (`provider/model` format)                |
| `MAX_STEPS`       | `25`                            | Max tool-call steps per message                        |
| `ALLOWED_IDS`     | _(empty = everyone)_            | Comma-separated Telegram user IDs for access control   |
| `FAL_KEY`         | —                               | [fal.ai](https://fal.ai) API key for voice (STT + TTS) |

### Ollama (Optional — Local Models)

Run models locally with zero API costs. Install [Ollama](https://ollama.com), pull models, and set the base URL:

| Variable          | Default | Description                                                             |
| ----------------- | ------- | ----------------------------------------------------------------------- |
| `OLLAMA_BASE_URL` | —       | Ollama server URL (e.g. `http://host.docker.internal:11434` for Docker) |

When set, Phoebe fetches your local model list and adds them to the catalog prefixed with `ollama/`. Switch to a local model with `/model ollama/llama3.2`.

> **Docker networking:**
>
> - **Same machine:** Use `http://host.docker.internal:11434` to reach Ollama on the Docker host (macOS/Windows). On Linux, add `--add-host=host.docker.internal:host-gateway` to `docker-compose.yml`.
> - **Remote GPU machine:** Point to the LAN IP directly (e.g. `http://192.168.1.100:11434`). On the Ollama machine, set `OLLAMA_HOST=0.0.0.0` so it listens on all interfaces, then no Docker DNS tricks are needed.

### Paths

| Variable     | Default                | Description               |
| ------------ | ---------------------- | ------------------------- |
| `DATA_DIR`   | `/app/data` (Docker)   | Persistent data directory |
| `SKILLS_DIR` | `/app/skills` (Docker) | Agent Skills directory    |

---

## Bot Commands

| Command           | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| `/start`          | Welcome message with feature overview                        |
| `/status`         | Uptime, RAM, current model, session, skills count            |
| `/tools`          | List all available tools                                     |
| `/skills`         | List installed Agent Skills                                  |
| `/models`         | Browse all models (paginated, inline keyboard navigation)    |
| `/models ollama`  | Show only local Ollama models                                |
| `/models <query>` | Search models by name or ID                                  |
| `/model`          | Show current model with capabilities                         |
| `/model <id>`     | Switch model (e.g. `/model anthropic/claude-sonnet-4.6`)     |
| `/session`        | List sessions with inline keyboard for switching             |
| `/session new`    | Create a new session (optional title)                        |
| `/session rename` | Rename the current session                                   |
| `/session delete` | Delete a session by ID                                       |
| `/voice`          | Browse and switch TTS voice (21 voices)                      |
| `/voicereply`     | Toggle voice replies on/off for current chat                 |
| `/refreshmodels`  | Re-fetch model catalog from Mume AI                          |
| `/clear`          | Clear conversation history for current session               |
| `/restart`        | Graceful restart — owner only                                |

---

## Built-in Tools

### `bash`

Run any shell command inside the container. Full login shell with `git`, `curl`, `wget`, `jq`, `python3`, `htop`, and more pre-installed. Output is truncated at 50,000 characters. Default timeout: 20 minutes.

**Background commands:** Commands ending with `&` are detected and handled specially — the process is detached with proper FD management, and the tool returns the PID + a log file path immediately. The model can then check status (`ps -p PID`) or read output (`cat /tmp/phoebe_bg_*.log`) without the tool call hanging.

### `readFile` / `writeFile`

Direct file I/O. `writeFile` creates parent directories automatically. Both are security-validated against protected paths.

### `list_skills` / `activate_skill`

Browse installed skills and load their SKILL.md instructions into the AI's context on demand. Skills are lazy — they take zero resources until activated.

### `search_skills` / `install_skill`

Search and install from the 850+ skill [skills.sh](https://skills.sh) registry. Skills are installed to the active session's skills directory and survive container restarts. Each session has isolated skills — installing a skill in one session doesn't affect others.

---

## Agent Skills

Phoebe implements the [Agent Skills](https://agentskills.io) open standard. Each skill is a directory containing a `SKILL.md` file:

```yaml
---
name: deep-research
description: Multi-step research with source verification
---
# Instructions
1. Break the query into sub-questions...
2. Use bash to search the web...
3. Synthesize findings into a report...
```

When the AI calls `activate_skill`, the Markdown instructions (up to 3,000 chars) are injected into context. The model then follows them using the built-in tools. Skills compose naturally — a research skill can use bash to run curl, write results to files, and iterate.

**Skill directories (priority order):**

1. `/app/skills/sessions/<sessionId>/` — session-specific skills (highest priority)
2. `/app/skills/` — shared skills (Docker volume, persistent)
3. `~/.agents/skills/` — global skills (npx default location)

---

## Voice

### Speech-to-Text

Send a voice message in Telegram. Phoebe transcribes it using ElevenLabs Scribe V2 (via fal.ai) and processes the text as a normal message.

### Text-to-Speech

Enable with `/voicereply`. Phoebe will reply with audio using ElevenLabs TTS Turbo v2.5. Choose from 21 voices with `/voice`:

> Aria · Roger · Sarah · Laura · Charlie · George · Callum · River · Liam · Charlotte · Alice · Matilda · Will · Jessica · Eric · Chris · Brian · Daniel · Lily · Bill · Rachel

Requires a `FAL_KEY` in your `.env`.

---

## Security Model

Phoebe runs with full bash access inside her container — but a layered security system prevents dangerous operations. All validations are enforced at the tool execution level and cannot be overridden by prompt injection.

### Blocked Commands

| Category                 | Examples                                     |
| ------------------------ | -------------------------------------------- |
| Destructive filesystem   | `rm -rf /`, recursive delete on system paths |
| System control           | `shutdown`, `reboot`, `poweroff`, `halt`     |
| Fork bombs               | `:(){ :\|:& };:`                             |
| Privilege escalation     | `chmod 777`, `passwd`, `usermod`, `chmod +s` |
| Reverse shells           | `nc -l`, `ncat -l`                           |
| Remote code execution    | `curl ... \| sh`, `wget ... \| bash`         |
| Secret exfiltration      | `cat .env`, `cat /etc/shadow`, `cat id_rsa`  |
| Source code modification | `sed -i ... src/`, editing project files     |
| Destructive git          | `git push`, `git reset --hard`               |
| Process management       | `pm2 delete/kill/stop`                       |
| Kernel / firewall        | `insmod`, `rmmod`, `iptables`, `ufw`         |

### Protected Paths (Write-Blocked)

**Project files:** `src/`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `.env`, `.git/`, `node_modules/`

**System paths:** `/etc/`, `/boot/`, `/usr/`, `/sbin/`, `/bin/`, `/lib/`, `/var/log/`, `/proc/`, `/sys/`

Read access is unrestricted for non-secret files.

---

## Architecture Overview

Phoebe has two interfaces that share a single AI streaming core:

```
                    ┌─────────────┐
                    │  Telegram   │
                    │  (grammY)   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  OutputChan │◄──── TelegramChannel
                    │  Interface  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ runAIStream │   AI SDK v6 streamText()
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   Mume AI   │   mume.ai gateway
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │    Model    │   Gemini / Claude / GPT / ...
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │    Tools    │   bash, readFile, writeFile,
                    │  & Skills   │   list_skills, activate_skill, ...
                    └─────────────┘
```

The `OutputChannel` interface decouples the AI engine from delivery. Adding new channels (WhatsApp, Discord, Slack) requires only implementing this interface (~70 lines) — no changes to the AI core.

- **TelegramChannel** — sends typing indicators, chunked HTML messages, tool action labels, tool result output, voice replies

For the full architecture with Mermaid diagrams, data models, sequence diagrams, and security details, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Project Structure

```
phoebe/
├── src/
│   ├── index.ts              # Entry point — env, init, graceful shutdown
│   ├── config.ts             # Environment variable resolution
│   ├── logger.ts             # Zero-dep ANSI-colored structured logging
│   ├── models.ts             # Model catalog — fetch, cache, query
│   ├── tools.ts              # 7 built-in tools + Agent Skills registry
│   ├── security.ts           # Command & path validation
│   ├── stt.ts                # Speech-to-text (ElevenLabs via fal.ai)
│   ├── tts.ts                # Text-to-speech (ElevenLabs via fal.ai)
│   ├── errors.ts             # Error → friendly message formatter
│   ├── ai/
│   │   ├── stream.ts         # Interface-agnostic AI streaming core
│   │   ├── channel.ts        # OutputChannel interface
│   │   └── telegram-channel.ts
│   ├── bot/
│   │   ├── instance.ts       # Bot singleton, provider, Markdown→HTML, sendChunked
│   │   ├── commands.ts       # /command handlers + session management + callbacks
│   │   ├── handlers.ts       # Text, photo, document, voice message handlers
│   │   └── prompt.ts         # System prompt builder (session-aware)
│   ├── persistence/
│   │   ├── store.ts          # Low-level JSON read/write
│   │   ├── conversations.ts  # Session-scoped conversation history + context windowing
│   │   ├── sessions.ts       # Multi-session management (CRUD, auto-title, migration)
│   │   ├── settings.ts       # Per-chat model, voice, voice-reply settings
│   │   └── users.ts          # User profiles
├── Dockerfile                # Node 22 slim + dev tools
├── docker-compose.yml        # Container orchestration with persistent volumes
├── package.json
├── tsconfig.json
└── ARCHITECTURE.md           # Full system architecture with diagrams
```

### Persistent Data (Docker volume at `/app/data/`)

| File                                          | Contents                                              |
| --------------------------------------------- | ----------------------------------------------------- |
| `users.json`                                   | User profiles (id, name, username, first/last seen)   |
| `models.json`                                  | Per-chat model overrides                              |
| `voices.json`                                  | Per-chat TTS voice preferences                        |
| `voice-reply.json`                             | Per-chat voice reply toggle                           |
| `openrouter-models.json`                       | Cached cloud model catalog (Mume AI)                  |
| `ollama-models.json`                           | Cached local model catalog (Ollama)                   |
| `sessions/<chatId>.json`                       | Session index per chat (active session, session list) |
| `conversations/<chatId>_<sessionId>.json`      | Full conversation history per session (max 500 msgs)  |

---

## Development

### Without Docker

```bash
pnpm install
cp .env.example .env    # Fill in your keys
pnpm dev                # Start with file watching (tsx --watch)
```

### Type Checking

```bash
pnpm typecheck          # tsc --noEmit
```

### Tech Stack

| Component   | Technology                                               |
| ----------- | -------------------------------------------------------- |
| Runtime     | Node.js 22 + [tsx](https://github.com/privatenumber/tsx) |
| Language    | TypeScript (strict, ESM)                                 |
| AI Engine   | [Vercel AI SDK v6](https://sdk.vercel.ai) (`streamText`) |
| AI Gateway  | [Mume AI](https://mume.ai)                               |
| Telegram    | [grammY](https://grammy.dev)                             |
| Persistence | JSON files on disk (Docker volume)                       |
| STT/TTS     | ElevenLabs via [fal.ai](https://fal.ai)                  |
| Container   | Docker + Docker Compose                                  |

### Dependencies

6 runtime dependencies. Zero native modules.

| Package                       | Purpose                                               |
| ----------------------------- | ----------------------------------------------------- |
| `grammy`                      | Telegram bot framework                                |
| `ai`                          | Vercel AI SDK — `streamText`, `tool()`, message types |
| `@openrouter/ai-sdk-provider` | AI provider SDK (Mume AI gateway)                     |
| `@ai-sdk/openai-compatible`   | OpenAI-compatible provider (Ollama local models)      |
| `zod`                         | Schema validation for tool parameters                 |
| `dotenv`                      | Environment variable loading                          |
| `tsx`                         | TypeScript execution without build step               |

---

## Docker Reference

### Lifecycle

```bash
docker compose up -d                # Start (builds if needed)
docker compose up --build -d        # Rebuild after code changes
docker compose restart              # Restart container
docker compose down                 # Stop and remove container
docker compose down -v              # Stop + remove volumes (⚠️ deletes all data)
```

### Logs

```bash
docker compose logs -f              # Tail logs live
docker compose logs --tail 50       # Last 50 lines
docker compose logs --since 1h      # Last hour of logs
```

### Shell Access

```bash
docker exec -it phoebe bash                   # Shell into container
docker exec phoebe ls /app/skills             # List installed skills
docker exec phoebe cat /app/data/users.json   # View user profiles
```

### Backup & Restore

```bash
# Backup data volume
docker run --rm -v phoebe_phoebe-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/phoebe-data-backup.tar.gz -C /data .

# Restore data volume
docker run --rm -v phoebe_phoebe-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/phoebe-data-backup.tar.gz -C /data
```

### Volumes

| Volume          | Mount         | Contents                                            |
| --------------- | ------------- | --------------------------------------------------- |
| `phoebe-data`   | `/app/data`   | User profiles, settings, conversations, model cache |
| `phoebe-skills` | `/app/skills` | Installed Agent Skills                              |

---

## Contributing

Contributions are welcome. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT — see [LICENSE](LICENSE).
