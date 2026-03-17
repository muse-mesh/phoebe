<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-22-green?logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/AI_SDK-v6-black?logo=vercel&logoColor=white" alt="AI SDK" />
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License" />
</p>

# Phoebe

**A self-hosted AI agent with full tool access — delivered through Telegram and the web.**

Phoebe runs in a Docker container on your own hardware. She connects to any model on [OpenRouter](https://openrouter.ai) (Gemini, Claude, GPT, Llama, etc.), has unrestricted terminal access inside the container, can read and write files, and extends herself with 850+ community [Agent Skills](https://agentskills.io). Conversations stream in real-time to Telegram and to a browser UI via Firestore.

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

Access thousands of AI models through [OpenRouter](https://openrouter.ai). Switch models mid-conversation with `/model <id>`. Browse the full catalog with `/models`, filter by name or free tier, and paginate with inline keyboard navigation. Each model's capabilities (tools, vision, audio, reasoning, etc.) are detected and displayed.

### Dual Interface

- **Telegram** — full-featured bot via [grammY](https://grammy.dev), with streaming typing indicators, inline tool transparency, image/document understanding, and voice messages
- **Web UI** — real-time browser interface via Cloud Firestore as a bidirectional message bus, with pseudo-streaming updates every 300ms

### Agentic Tool Use

Seven built-in tools give the AI full agency inside the container:

| Tool             | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `bash`           | Run any shell command with full PATH (git, curl, python3, jq, etc.) |
| `readFile`       | Read file contents                                                  |
| `writeFile`      | Create or overwrite files, auto-creates parent directories          |
| `list_skills`    | List installed Agent Skills                                         |
| `activate_skill` | Load a skill's instructions into context                            |
| `search_skills`  | Search the [skills.sh](https://skills.sh) registry                  |
| `install_skill`  | Install a skill from the registry                                   |

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
- Conversations, user profiles, model preferences, and voice settings persist across container restarts via Docker volumes

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
- An API key from [Mume AI](https://mume.ai) (OpenRouter-compatible gateway)

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

| Variable             | Default                         | Description                                            |
| -------------------- | ------------------------------- | ------------------------------------------------------ |
| `MUME_BASE_URL`      | `https://mume.ai/api/v1`        | AI gateway endpoint (OpenRouter-compatible)            |
| `OPENROUTER_API_KEY` | —                               | For fetching the model catalog from OpenRouter         |
| `AI_MODEL`           | `google/gemini-3-flash-preview` | Default model (OpenRouter format: `provider/model`)    |
| `MAX_STEPS`          | `25`                            | Max tool-call steps per message                        |
| `ALLOWED_IDS`        | _(empty = everyone)_            | Comma-separated Telegram user IDs for access control   |
| `FAL_KEY`            | —                               | [fal.ai](https://fal.ai) API key for voice (STT + TTS) |

### Web Interface (Optional)

To enable the browser UI via Firestore:

| Variable                       | Description                                   |
| ------------------------------ | --------------------------------------------- |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Firebase service account JSON string          |
| `FIREBASE_UID`                 | Firebase Auth UID for the owner               |
| `PHOEBE_INSTANCE_ID`           | Unique instance identifier (e.g. `phoebe-pi`) |
| `FIRESTORE_ROOT`               | Firestore root path (default: `viper/v1`)     |

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
| `/status`         | Uptime, RAM, current model, skills count, conversation stats |
| `/tools`          | List all available tools                                     |
| `/skills`         | List installed Agent Skills                                  |
| `/models`         | Browse all models (paginated, inline keyboard navigation)    |
| `/models free`    | Show only free-tier models                                   |
| `/models <query>` | Search models by name or ID                                  |
| `/model`          | Show current model with capabilities                         |
| `/model <id>`     | Switch model (e.g. `/model anthropic/claude-sonnet-4.6`)     |
| `/voice`          | Browse and switch TTS voice (21 voices)                      |
| `/voicereply`     | Toggle voice replies on/off for current chat                 |
| `/refreshmodels`  | Re-fetch model catalog from OpenRouter                       |
| `/clear`          | Clear conversation history for current chat                  |
| `/restart`        | Graceful restart — owner only                                |

---

## Built-in Tools

### `bash`

Run any shell command inside the container. Full login shell with `git`, `curl`, `wget`, `jq`, `python3`, `htop`, and more pre-installed. Output is truncated at 50,000 characters. Default timeout: 120 seconds.

### `readFile` / `writeFile`

Direct file I/O. `writeFile` creates parent directories automatically. Both are security-validated against protected paths.

### `list_skills` / `activate_skill`

Browse installed skills and load their SKILL.md instructions into the AI's context on demand. Skills are lazy — they take zero resources until activated.

### `search_skills` / `install_skill`

Search and install from the 850+ skill [skills.sh](https://skills.sh) registry. Skills are installed to a persistent Docker volume and survive container restarts.

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

**Skill directories:**

- `/app/skills/` — container-local skills (Docker volume, persistent)
- `~/.agents/skills/` — global skills (npx default location)

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
                    │  Interface  │◄──── FirestoreChannel
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ runAIStream │   AI SDK v6 streamText()
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  OpenRouter │   @openrouter/ai-sdk-provider
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

The `OutputChannel` interface decouples the AI engine from delivery:

- **TelegramChannel** — sends typing indicators, chunked HTML messages, tool action labels, voice replies
- **FirestoreChannel** — writes streaming state to a Firestore status document (300ms throttle) for real-time web UI updates

For the full architecture with Mermaid diagrams, data models, sequence diagrams, and security details, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Project Structure

```
phoebe/
├── src/
│   ├── index.ts              # Entry point — env, init, graceful shutdown
│   ├── config.ts             # Environment variable resolution
│   ├── logger.ts             # Zero-dep ANSI-colored structured logging
│   ├── models.ts             # OpenRouter catalog — fetch, cache, query
│   ├── tools.ts              # 7 built-in tools + Agent Skills registry
│   ├── security.ts           # Command & path validation
│   ├── stt.ts                # Speech-to-text (ElevenLabs via fal.ai)
│   ├── tts.ts                # Text-to-speech (ElevenLabs via fal.ai)
│   ├── errors.ts             # Error → friendly message formatter
│   ├── firestore.ts          # Firebase Admin SDK init + path helpers
│   ├── ai/
│   │   ├── stream.ts         # Interface-agnostic AI streaming core
│   │   ├── channel.ts        # OutputChannel interface
│   │   ├── telegram-channel.ts
│   │   └── firestore-channel.ts
│   ├── bot/
│   │   ├── instance.ts       # Bot singleton, provider, Markdown→HTML, sendChunked
│   │   ├── commands.ts       # /command handlers + callback query handlers
│   │   ├── handlers.ts       # Text, photo, document, voice message handlers
│   │   └── prompt.ts         # System prompt builder
│   ├── persistence/
│   │   ├── store.ts          # Low-level JSON read/write
│   │   ├── conversations.ts  # Conversation history + context windowing
│   │   ├── settings.ts       # Per-chat model, voice, voice-reply settings
│   │   └── users.ts          # User profiles
│   └── web/
│       └── listener.ts       # Firestore message watcher + instance heartbeat
├── Dockerfile                # Node 22 slim + dev tools
├── docker-compose.yml        # Container orchestration with persistent volumes
├── package.json
├── tsconfig.json
└── ARCHITECTURE.md           # Full system architecture with diagrams
```

### Persistent Data (Docker volume at `/app/data/`)

| File                          | Contents                                              |
| ----------------------------- | ----------------------------------------------------- |
| `users.json`                  | User profiles (id, name, username, first/last seen)   |
| `models.json`                 | Per-chat model overrides                              |
| `voices.json`                 | Per-chat TTS voice preferences                        |
| `voice-reply.json`            | Per-chat voice reply toggle                           |
| `openrouter-models.json`      | Cached OpenRouter model catalog                       |
| `conversations/<chatId>.json` | Full conversation history per chat (max 500 messages) |

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

| Component   | Technology                                                                   |
| ----------- | ---------------------------------------------------------------------------- |
| Runtime     | Node.js 22 + [tsx](https://github.com/privatenumber/tsx)                     |
| Language    | TypeScript (strict, ESM)                                                     |
| AI Engine   | [Vercel AI SDK v6](https://sdk.vercel.ai) (`streamText`)                     |
| AI Provider | [@openrouter/ai-sdk-provider](https://github.com/OpenRouter/ai-sdk-provider) |
| Telegram    | [grammY](https://grammy.dev)                                                 |
| Persistence | JSON files on disk (Docker volume)                                           |
| Web Sync    | Cloud Firestore (firebase-admin)                                             |
| STT/TTS     | ElevenLabs via [fal.ai](https://fal.ai)                                      |
| Container   | Docker + Docker Compose                                                      |

### Dependencies

7 runtime dependencies. Zero native modules.

| Package                       | Purpose                                               |
| ----------------------------- | ----------------------------------------------------- |
| `grammy`                      | Telegram bot framework                                |
| `ai`                          | Vercel AI SDK — `streamText`, `tool()`, message types |
| `@openrouter/ai-sdk-provider` | OpenRouter provider for AI SDK                        |
| `zod`                         | Schema validation for tool parameters                 |
| `firebase-admin`              | Firestore server-side SDK                             |
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
