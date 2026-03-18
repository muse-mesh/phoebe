# Architecture

> Deep dive into Phoebe's internals — how every component connects, communicates, and streams.

This document covers the system design of Phoebe's dual-interface AI agent: **Telegram** (direct bot) and **Web** (browser UI via Firestore). Both interfaces share a single AI streaming core, tool system, and persistence layer.

---

## Table of Contents

- [High-Level Overview](#high-level-overview)
- [Core Concepts](#core-concepts)
- [Module Map](#module-map)
- [AI Streaming Engine](#ai-streaming-engine)
- [OutputChannel Abstraction](#outputchannel-abstraction)
- [Message Flow — Telegram](#message-flow--telegram)
- [Message Flow — Web Interface](#message-flow--web-interface)
- [Firestore Data Model](#firestore-data-model)
- [Pseudo-Streaming Strategy](#pseudo-streaming-strategy)
- [Tool System](#tool-system)
- [Agent Skills Lifecycle](#agent-skills-lifecycle)
- [Conversation Memory & Windowing](#conversation-memory--windowing)
- [Security Architecture](#security-architecture)
- [Model Catalog](#model-catalog)
- [Persistence Layer](#persistence-layer)
- [Error Handling](#error-handling)
- [Deployment Topology](#deployment-topology)
- [Tech Stack Summary](#tech-stack-summary)

---

## High-Level Overview

```mermaid
graph TB
    subgraph "Client Interfaces"
        TG["Telegram<br/>(grammY Bot)"]
        WEB["Web Browser<br/>(Next.js / React)"]
    end

    subgraph "Cloud Services"
        FS[("Cloud Firestore<br/>Message Bus")]
        AUTH["Firebase Auth<br/>(Google / Apple)"]
    end

    subgraph "Phoebe Server (Docker Container)"
        LISTENER["Web Listener<br/>(firebase-admin onSnapshot)"]
        AI["AI Stream Engine<br/>(Vercel AI SDK v6)"]
        TOOLS["Tools & Skills"]
        TGBOT["Telegram Handler<br/>(grammY)"]
        PERSIST["Persistence Layer<br/>(JSON on disk)"]
    end

    subgraph "AI Gateway"
        OR["Mume AI Gateway"]
        MODELS["Gemini / Claude / GPT / Llama / ..."]
    end

    subgraph "Local Inference (Optional)"
        OLLAMA["Ollama Server"]
        LOCAL["Local Models<br/>(llama3.2 / qwen3 / phi4 / ...)"]
    end

    TG <-->|"Bot API"| TGBOT
    WEB <-->|"onSnapshot<br/>(real-time sync)"| FS
    FS <-->|"firebase-admin<br/>(onSnapshot + writes)"| LISTENER
    AUTH -->|"UID verification"| WEB
    LISTENER --> AI
    TGBOT --> AI
    AI <-->|"streamText()"| OR
    OR --> MODELS
    AI <-->|"OpenAI-compatible /v1"| OLLAMA
    OLLAMA --> LOCAL
    AI --> TOOLS
    AI --> PERSIST

    style FS fill:#FFA726,stroke:#E65100,color:#000
    style AI fill:#42A5F5,stroke:#1565C0,color:#000
    style WEB fill:#66BB6A,stroke:#2E7D32,color:#000
    style TG fill:#29B6F6,stroke:#0277BD,color:#000
    style OLLAMA fill:#AB47BC,stroke:#6A1B9A,color:#FFF
```

**Key design principle:** The AI engine knows nothing about Telegram or Firestore. It talks to an `OutputChannel` interface. This lets us add new delivery channels (Slack, Discord, CLI, etc.) without touching the AI core.

---

## Core Concepts

| Concept               | What it means                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **OutputChannel**     | Interface that decouples the AI engine from message delivery. Each interface (Telegram, Web) implements it.                                   |
| **runAIStream**       | The central function. Takes an OutputChannel, model ID, context, and user input. Orchestrates streaming, tool calls, and response collection. |
| **Status Document**   | A Firestore document (`status/current`) that acts as a streaming state machine for the web interface.                                         |
| **Context Windowing** | Smart truncation of conversation history — recent messages keep full detail, older tool results are compressed.                               |
| **Agent Skills**      | Markdown instruction files loaded into context on demand. The AI discovers, installs, and follows them autonomously.                          |

---

## Module Map

```mermaid
graph LR
    subgraph "Entry"
        INDEX["index.ts<br/><i>init, shutdown</i>"]
    end

    subgraph "Interfaces"
        BOT["bot/<br/><i>grammY commands,<br/>handlers, prompt</i>"]
        WEB["web/listener.ts<br/><i>Firestore watcher</i>"]
    end

    subgraph "AI Core"
        STREAM["ai/stream.ts<br/><i>runAIStream</i>"]
        CHAN["ai/channel.ts<br/><i>OutputChannel</i>"]
        TC["ai/telegram-channel.ts"]
        FC["ai/firestore-channel.ts"]
    end

    subgraph "Capabilities"
        TOOLS["tools.ts<br/><i>7 tools + skills</i>"]
        SECURITY["security.ts<br/><i>validation</i>"]
        MODELS["models.ts<br/><i>catalog</i>"]
        STT["stt.ts"]
        TTS["tts.ts"]
    end

    subgraph "Infrastructure"
        CONFIG["config.ts"]
        FS["firestore.ts"]
        PERSIST["persistence/<br/><i>conversations, users,<br/>settings, store</i>"]
        LOGGER["logger.ts"]
        ERRORS["errors.ts"]
    end

    INDEX --> BOT
    INDEX --> WEB
    INDEX --> FS
    INDEX --> PERSIST
    BOT --> TC
    WEB --> FC
    TC --> CHAN
    FC --> CHAN
    BOT --> STREAM
    WEB --> STREAM
    STREAM --> TOOLS
    STREAM --> CHAN
    TOOLS --> SECURITY
    FC --> FS
    WEB --> FS

    style STREAM fill:#42A5F5,stroke:#1565C0,color:#000
    style CHAN fill:#AB47BC,stroke:#6A1B9A,color:#fff
    style INDEX fill:#FFA726,stroke:#E65100,color:#000
```

### File Inventory (~4,000 lines of TypeScript)

| File                               | Lines | Role                                                        |
| ---------------------------------- | ----: | ----------------------------------------------------------- |
| `src/index.ts`                     |   131 | Entry point — env loading, init sequence, graceful shutdown |
| `src/config.ts`                    |    43 | Environment variable resolution with defaults               |
| `src/logger.ts`                    |   331 | Zero-dependency ANSI structured logging                     |
| `src/models.ts`                    |   452 | Model catalog — fetch, cache, search, capabilities          |
| `src/tools.ts`                     |   462 | All 7 AI-callable tools + Agent Skills registry             |
| `src/security.ts`                  |   228 | Bash command validation + file path protection              |
| `src/stt.ts`                       |    88 | Speech-to-text via ElevenLabs Scribe V2 (fal.ai)            |
| `src/tts.ts`                       |    72 | Text-to-speech via ElevenLabs Turbo v2.5 (fal.ai)           |
| `src/errors.ts`                    |    21 | Error pattern → friendly message mapper                     |
| `src/firestore.ts`                 |    80 | Firebase Admin SDK init + Firestore path helpers            |
| `src/ai/stream.ts`                 |   310 | Interface-agnostic AI streaming engine                      |
| `src/ai/channel.ts`                |    27 | OutputChannel interface definition                          |
| `src/ai/telegram-channel.ts`       |    85 | Telegram OutputChannel implementation                       |
| `src/ai/firestore-channel.ts`      |   134 | Firestore OutputChannel implementation                      |
| `src/bot/instance.ts`              |   271 | Bot singleton, AI provider, Markdown→HTML, sendChunked      |
| `src/bot/commands.ts`              |   322 | All `/command` handlers + inline keyboard callbacks         |
| `src/bot/handlers.ts`              |   250 | Text, photo, document, voice message handlers               |
| `src/bot/prompt.ts`                |    37 | System prompt builder                                       |
| `src/persistence/store.ts`         |    25 | Low-level JSON read/write helpers                           |
| `src/persistence/conversations.ts` |   168 | Conversation history with context windowing                 |
| `src/persistence/settings.ts`      |   117 | Per-chat model, voice, voice-reply settings                 |
| `src/persistence/users.ts`         |    55 | User profile tracking                                       |
| `src/web/listener.ts`              |   450 | Firestore onSnapshot watcher + instance heartbeat           |

---

## AI Streaming Engine

The heart of Phoebe lives in `ai/stream.ts`. The `runAIStream()` function is completely interface-agnostic.

### Function Signature

```typescript
async function runAIStream(params: {
  channel: OutputChannel; // Where to deliver output
  modelId: string; // e.g. "anthropic/claude-sonnet-4.6"
  contextMessages: ModelMessage[]; // Conversation history (windowed)
  userContent: UserContent; // Text, images, files from the user
  tools: Record<string, Tool>; // Available tools
  maxSteps: number; // Tool call step limit
  abortSignal?: AbortSignal; // External cancellation
}): Promise<StreamResult>;
```

### Lifecycle

```mermaid
sequenceDiagram
    participant Caller as Interface (Bot/Web)
    participant Engine as runAIStream
    participant SDK as AI SDK streamText()
    participant Model as Mume AI → Model
    participant Tools as Tool Executor

    Caller->>Engine: runAIStream(channel, model, messages, content)
    Engine->>Engine: Build provider with routing hints
    Engine->>SDK: streamText({model, messages, tools, maxSteps})

    loop Streaming
        Model-->>SDK: Text chunk
        SDK-->>Engine: onChunk callback
        Engine->>Caller: channel.onStreamChunk(text)
    end

    alt Tool call detected
        SDK-->>Engine: onStepFinish (tool-call step)
        Engine->>Caller: channel.sendToolAction(name, detail)
        Engine->>Tools: Execute tool
        Tools-->>Engine: Tool result
        Engine->>SDK: Continue with result
        Note over SDK,Model: Model processes result, may call more tools
    end

    SDK-->>Engine: Stream complete
    Engine->>Caller: channel.onStreamDone(fullText)
    Engine-->>Caller: Return StreamResult
```

### Key Behaviours

| Behaviour               | Detail                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| **Timeout**             | 30-minute hard limit per request. AbortController fires, partial text returned.          |
| **Response collection** | 30-second grace period after stream ends to collect final `responseMessages`.            |
| **Per-chat abort**      | New messages from the same chat abort in-flight requests via shared AbortController.     |
| **Provider routing**    | Extracts provider slug from model ID → `order: [slug], allow_fallbacks: true`.           |
| **Step limit**          | Configurable `MAX_STEPS` (default 25). Uses AI SDK's `stepCountIs()` stopping condition. |
| **Error recovery**      | Catches all errors, sends user-friendly message via channel, returns partial result.     |

---

## OutputChannel Abstraction

The interface boundary between the AI engine and message delivery.

```mermaid
classDiagram
    class OutputChannel {
        <<interface>>
        +sendTyping() Promise~void~
        +sendText(text: string) Promise~void~
        +sendToolAction(name: string, detail: string) Promise~void~
        +sendToolResult(toolName: string, result: string) Promise~void~
        +onStreamChunk(text: string) void
        +onStreamDone(fullText: string) Promise~void~
        +sendVoice(audio: Buffer) Promise~void~
        +sendError(message: string) Promise~void~
    }

    class TelegramChannel {
        -ctx: GrammyContext
        -chatId: number
        +sendTyping() → sendChatAction("typing")
        +sendText() → sendChunked(Markdown→HTML)
        +sendToolAction() → monospaced inline msg
        +sendToolResult() → HTML pre block (3.8K limit)
        +onStreamChunk() → no-op
        +onStreamDone() → sendChunked(full text)
        +sendVoice() → sendAudio
    }

    class FirestoreChannel {
        -sessionId: string
        -chatId: string
        -pendingText: string
        -CHUNK_THROTTLE_MS: 300
        +sendTyping() → status{state:"typing"}
        +onStreamChunk() → throttled pendingText write
        +onStreamDone() → status{state:"idle", finalText}
        +sendToolAction() → status{state:"tool", toolLabel}
        +sendToolResult() → append code block to pendingText
    }

    OutputChannel <|.. TelegramChannel : implements
    OutputChannel <|.. FirestoreChannel : implements
```

### Why This Matters

Adding a new interface (e.g. Slack, Discord, CLI) requires only:

1. Implement `OutputChannel` (~70 lines)
2. Wire it to the input source
3. Call `runAIStream()` with your channel

No changes to the AI engine, tools, or security layer.

---

## Message Flow — Telegram

```mermaid
sequenceDiagram
    participant U as User (Telegram)
    participant TG as Telegram API
    participant P as Phoebe Server
    participant AI as Mume AI

    U->>TG: Send message
    TG->>P: grammY long-polling
    P->>P: Validate user (allowlist)
    P->>P: Track user profile
    P->>P: Load conversation history
    P->>P: Apply context windowing (100 msgs)
    P->>TG: sendChatAction("typing")

    P->>AI: streamText({model, messages, tools})
    loop Text streaming
        AI-->>P: Text chunks accumulate
    end

    alt Tool calls
        AI-->>P: tool-call (e.g. bash)
        P->>P: Security validation
        P->>TG: "🔧 $ ls -la /app"
        P->>P: Execute tool        P->>TG: Tool result (pre-formatted output)        P->>AI: Continue with tool result
    end

    AI-->>P: Stream complete
    P->>P: Save assistant messages to history
    P->>TG: sendChunked(fullText, Markdown→HTML)

    opt Voice reply enabled
        P->>P: TTS → audio buffer
        P->>TG: sendAudio(mp3)
    end

    TG->>U: Display response
```

### Telegram-Specific Details

- **No progressive message updates** — Telegram's edit rate limits make real-time streaming impractical. Instead, typing indicators are sent every 4 seconds while the AI works, and the full response is delivered at once.
- **Smart message splitting** — `sendChunked()` splits at paragraph → line → word boundaries, respecting Telegram's 4,096-character limit per message.
- **Markdown → HTML** — Converts AI markdown (bold, italic, code, links) to Telegram-compatible HTML.
- **Tool transparency** — Each tool call is shown as an inline monospaced message (e.g. `$ git status`) so users see exactly what the AI is doing. Tool results are also sent as pre-formatted HTML output.
- **Media handling** — Photos, documents, and voice messages are downloaded (with 3 retries) and forwarded to the AI as multimodal content.

---

## Message Flow — Web Interface

The web interface uses Cloud Firestore as a **bidirectional message bus**. This solves the NAT traversal problem — Phoebe runs behind any network, and the browser communicates through Firestore.

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant W as Web App (Next.js)
    participant F as Cloud Firestore
    participant P as Phoebe Server
    participant AI as Mume AI

    Note over U,AI: 1. User Sends Message
    U->>W: Types message, clicks Send
    W->>W: Disable input (streaming guard)
    W->>F: setDoc(messages/{id}, {role:"user", processed:false, order:N})

    Note over U,AI: 2. Phoebe Picks Up Message
    F-->>P: onSnapshot fires (new unprocessed message)
    P->>F: update({processed: true})
    P->>F: status/current → {state:"typing"}

    Note over U,AI: 3. AI Streaming
    P->>AI: streamText({model, messages, tools})
    loop Every 300ms
        AI-->>P: text chunks
        P->>F: status/current → {state:"streaming", pendingText:"..."}
        F-->>W: onSnapshot (status update)
        W->>U: Render streaming text + indicator
    end

    Note over U,AI: 4. Tool Execution (if needed)
    AI-->>P: tool-call
    P->>F: status/current → {state:"tool", toolLabel:"Running shell..."}
    F-->>W: onSnapshot → show tool label
    P->>P: Execute tool, return result to AI
    P->>AI: Continue with tool result

    Note over U,AI: 5. Response Complete
    AI-->>P: Stream done
    P->>F: status/current → {state:"idle", finalText:"..."}
    P->>F: setDoc(messages/{id}, {role:"assistant", order:N+1})
    F-->>W: onSnapshot (new message doc)
    W->>U: Render final message, re-enable input

    Note over W: finalText in status doc prevents<br/>flash between stream end and message arrival
```

---

## Firestore Data Model

All Phoebe data lives under a user-scoped root. The path structure ensures multi-tenant isolation and supports multiple Phoebe instances per user.

```mermaid
graph TD
    ROOT["viper/v1"] --> PHOEBE["phoebe/"]
    PHOEBE --> INST["🔑 {instanceId}<br/><i>e.g. phoebe-pi</i>"]

    INST -->|"subcollection"| SESSIONS["sessions/"]
    SESSIONS --> SID["🔑 {sessionId}"]

    SID -->|"subcollection"| CHATS["chats/"]
    CHATS --> CID["🔑 {chatId}"]

    CID -->|"subcollection"| MSGS["messages/"]
    CID -->|"doc"| STATUS["status/current"]

    MSGS --> MSG1["🔑 msg_17...01<br/>role: user"]
    MSGS --> MSG2["🔑 msg_17...02<br/>role: assistant"]

    style ROOT fill:#78909C,stroke:#37474F,color:#fff
    style INST fill:#FFA726,stroke:#E65100,color:#000
    style STATUS fill:#EF5350,stroke:#C62828,color:#fff
    style MSG1 fill:#66BB6A,stroke:#2E7D32,color:#000
    style MSG2 fill:#42A5F5,stroke:#1565C0,color:#000
```

### Path Structure

| Resource            | Path                              |
| ------------------- | --------------------------------- |
| Instance doc        | `viper/v1/phoebe/{instanceId}`    |
| Sessions collection | `…/phoebe/{instanceId}/sessions`  |
| Session doc         | `…/sessions/{sessionId}`          |
| Chats collection    | `…/sessions/{sessionId}/chats`    |
| Chat doc            | `…/chats/{chatId}`                |
| Messages collection | `…/chats/{chatId}/messages`       |
| Status doc          | `…/chats/{chatId}/status/current` |

### Document Schemas

**Instance** — server heartbeat every 60 seconds:

```json
{
  "id": "phoebe-pi",
  "ownerId": "uid_...",
  "name": "Phoebe",
  "status": "online",
  "lastSeen": "<Timestamp>",
  "capabilities": {
    "tools": ["bash", "readFile", "writeFile", "..."],
    "skillCount": 864,
    "defaultModel": "google/gemini-3-flash-preview"
  },
  "platform": { "arch": "arm64", "platform": "linux", "nodeVersion": "v22.x" }
}
```

**Message** — written by client (user) or server (assistant):

```json
{
  "id": "msg_17...",
  "role": "user | assistant",
  "content": "Hello!",
  "parts": [{ "type": "text", "text": "Hello!" }],
  "createdAt": "<Timestamp>",
  "order": 0,
  "processed": false
}
```

**Status** — written by server during streaming:

```json
{
  "state": "idle | typing | streaming | tool | error",
  "pendingText": "partial response so far...",
  "finalText": "complete response",
  "toolLabel": "Running shell command...",
  "updatedAt": "<Timestamp>"
}
```

### Message Ordering

Messages use an explicit `order` field rather than timestamps, because network latency can cause out-of-order `createdAt` values:

- **Client** writes `order = messages.length` (count of existing messages)
- **Server** writes `order = userOrder + 1`
- **Input is disabled** during streaming to prevent interleaving
- **Fallback**: If the Firestore compound index isn't ready, automatically falls back to `createdAt` sorting

---

## Pseudo-Streaming Strategy

Firestore doesn't support byte-level streaming. Phoebe uses a **status document state machine** with throttled writes:

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> typing : User message received
    typing --> streaming : First AI chunk arrives
    streaming --> streaming : Chunk received (pendingText updated, 300ms throttle)
    streaming --> tool : Tool call detected
    tool --> streaming : Tool result → AI resumes
    tool --> tool : Chained tool calls
    streaming --> idle : Stream complete (write finalText + message doc)
    typing --> error : Error
    streaming --> error : Error
    tool --> error : Error
    error --> idle : Reset

    note right of streaming
        pendingText flushed to Firestore
        at most once per 300ms
    end note

    note right of idle
        finalText preserved in status doc
        until message document arrives
        — prevents visual flash
    end note
```

### Throttling

The `FirestoreChannel` accumulates text chunks in memory and flushes to Firestore at most once every 300ms. This keeps Firestore write costs manageable while maintaining a responsive UI.

---

## Tool System

All tools are defined in `tools.ts` using the Vercel AI SDK `tool()` helper with Zod schemas.

### Tool Definitions

| #   | Tool             | Parameters                                            | Security                          | Output                                       |
| --- | ---------------- | ----------------------------------------------------- | --------------------------------- | -------------------------------------------- |
| 1   | `bash`           | `command: string`, `timeout?: number`, `cwd?: string` | `validateBashCommand()`           | stdout + stderr + exit code (50K char limit) |
| 2   | `readFile`       | `filePath: string`                                    | `validateFilePath(path, "read")`  | File contents (50K char limit)               |
| 3   | `writeFile`      | `filePath: string`, `content: string`                 | `validateFilePath(path, "write")` | Success/error message                        |
| 4   | `list_skills`    | `filter?: string`                                     | None                              | Skill names + descriptions                   |
| 5   | `activate_skill` | `name: string`                                        | None                              | SKILL.md content (3K char limit)             |
| 6   | `search_skills`  | `query: string`                                       | None                              | Registry search results                      |
| 7   | `install_skill`  | `source: string`                                      | None                              | Install confirmation                         |

### Execution Flow

```mermaid
graph TB
    AI["AI Model"] -->|"tool_call"| DISPATCH["Tool Dispatcher"]
    DISPATCH --> BASH["bash"]
    DISPATCH --> READ["readFile"]
    DISPATCH --> WRITE["writeFile"]
    DISPATCH --> LIST["list_skills"]
    DISPATCH --> ACTIVATE["activate_skill"]
    DISPATCH --> SEARCH["search_skills"]
    DISPATCH --> INSTALL["install_skill"]

    BASH --> SEC["Security Validator"]
    READ --> SEC
    WRITE --> SEC

    SEC -->|"allowed"| EXEC["Execute"]
    SEC -->|"blocked"| DENY["Return denial message"]

    EXEC --> RESULT["Tool Result"]
    DENY --> RESULT
    RESULT -->|"tool_result"| AI

    style SEC fill:#EF5350,stroke:#C62828,color:#fff
    style AI fill:#42A5F5,stroke:#1565C0,color:#000
```

---

## Agent Skills Lifecycle

```mermaid
graph LR
    DISCOVER["discoverSkills()"] -->|"Scan dirs"| REGISTRY["Skills Registry<br/>(in-memory)"]

    subgraph "User Conversation"
        USER["User: find a skill for X"] --> SEARCH["search_skills<br/>npx skills find X"]
        SEARCH --> RESULTS["Registry results"]
        RESULTS --> INSTALL["install_skill<br/>npx skills add owner/repo@skill"]
        INSTALL --> COPY["Copy to /app/skills/"]
        COPY --> ACTIVATE["activate_skill<br/>Read SKILL.md"]
        ACTIVATE --> INJECT["3K chars injected<br/>into AI context"]
        INJECT --> FOLLOW["AI follows instructions<br/>using bash/readFile/writeFile"]
    end

    style INJECT fill:#42A5F5,stroke:#1565C0,color:#000
    style SEARCH fill:#66BB6A,stroke:#2E7D32,color:#000
```

### Skill Discovery

On startup and on each `list_skills` call, Phoebe scans:

1. **Project-local** (`SKILLS_DIR` / `/app/skills/`) — takes priority
2. **Global** (`~/.agents/skills/`) — npx default

Each subdirectory with a `SKILL.md` containing YAML frontmatter (`name`, `description`) is registered.

### Skill Activation

When the AI calls `activate_skill(name)`, the SKILL.md file is read (max 3,000 chars) and returned as a tool result. The model then has instructions in context and follows them using the other tools. Skills are **lazy** — they consume no resources until activated.

---

## Conversation Memory & Windowing

Phoebe stores full `ModelMessage` objects including tool-call and tool-result parts.

### Storage

| Constant                 |  Value | Purpose                                             |
| ------------------------ | -----: | --------------------------------------------------- |
| `MAX_DISK_MESSAGES`      |    500 | Maximum messages persisted to disk per conversation |
| `MAX_CONTEXT_MESSAGES`   |    100 | Maximum messages sent to the model as context       |
| `RECENT_FULL_TOOLS`      |     30 | Last N messages keep full tool result text          |
| `MAX_TOOL_RESULT_LENGTH` | 10,000 | Truncation limit for older tool results             |

### Windowing Logic

```
Full conversation on disk (up to 500 messages)
         │
         ▼
Take last 100 messages for context
         │
         ▼
Messages 1-70:  Tool results truncated to 10K chars
Messages 71-100: Full tool results preserved
         │
         ▼
Send to model with system prompt
```

### Content Sanitisation

When saving to disk, binary content is replaced with text placeholders:

- Images → `[image]`
- Files → `[file: filename.ext]`

This keeps conversation files JSON-serializable and reasonably sized.

---

## Security Architecture

### Two-Layer Validation

```mermaid
graph TB
    subgraph "Layer 1: Bash Command Validation"
        CMD["bash command"] --> PARSE["validateBashCommand()"]
        PARSE --> BLOCKED["Blocked patterns<br/>(30+ categories)"]
        PARSE --> PROJECT["isCommandTargetingProject()<br/>(write ops on src/, .env, etc.)"]
        BLOCKED -->|"match"| DENY1["❌ Blocked + reason"]
        PROJECT -->|"match"| DENY1
        BLOCKED -->|"no match"| ALLOW1["✅ Execute"]
        PROJECT -->|"no match"| ALLOW1
    end

    subgraph "Layer 2: File Path Validation"
        PATH["file path + operation"] --> VPATH["validateFilePath()"]
        VPATH --> PROJ_PATHS["Project files<br/>(src/, .env, package.json, ...)"]
        VPATH --> SYS_PATHS["System paths<br/>(/etc/, /boot/, /proc/, ...)"]
        PROJ_PATHS -->|"write"| DENY2["❌ Protected"]
        SYS_PATHS -->|"write"| DENY2
        PROJ_PATHS -->|"read"| ALLOW2["✅ Allowed"]
        SYS_PATHS -->|"read"| ALLOW2
    end

    style DENY1 fill:#EF5350,stroke:#C62828,color:#fff
    style DENY2 fill:#EF5350,stroke:#C62828,color:#fff
    style ALLOW1 fill:#66BB6A,stroke:#2E7D32,color:#000
    style ALLOW2 fill:#66BB6A,stroke:#2E7D32,color:#000
```

### Blocked Bash Command Categories

| Category               | Patterns                                                                               | Rationale                            |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------ |
| Destructive filesystem | `rm -rf /`, recursive delete on `/`, `~`, `../`                                        | Prevent data loss                    |
| Filesystem format      | `mkfs`                                                                                 | Prevent storage destruction          |
| Raw disk writes        | `dd … of=/dev/`                                                                        | Prevent disk corruption              |
| System control         | `shutdown`, `reboot`, `poweroff`, `halt`, `init 0/6`, `systemctl poweroff/reboot/halt` | Prevent host disruption              |
| Fork bombs             | `:(){ :\|:& };:`                                                                       | Prevent resource exhaustion          |
| Infinite loops         | `while true … do … done`                                                               | Prevent resource exhaustion          |
| Process management     | `pm2 delete/kill/stop all/phoebe`                                                      | Prevent self-destruction             |
| Privilege escalation   | `chmod 777`, `chmod +s`, `passwd`, `usermod`, `useradd`, `visudo`                      | Prevent privilege abuse              |
| Reverse shells         | `nc -l`, `ncat -l`                                                                     | Prevent network exploitation         |
| Remote code exec       | `curl/wget … \| sh/bash`                                                               | Prevent remote code injection        |
| Secret exfiltration    | `cat .env`, `cat /etc/shadow`, `cat id_rsa`                                            | Prevent credential leak              |
| Source code editing    | `sed/awk/perl -i … src/`, `vim/nano/vi/emacs … src/`                                   | Prevent self-modification            |
| Destructive git        | `git push`, `git reset --hard`, `git checkout --`                                      | Prevent repo corruption              |
| Cron persistence       | `crontab -r/-e`                                                                        | Prevent scheduled attack persistence |
| Kernel modules         | `insmod`, `rmmod`, `modprobe`                                                          | Prevent kernel manipulation          |
| Firewall               | `iptables -A/D/I`, `ufw allow/deny/delete/reset`                                       | Prevent network rule changes         |

### Protected File Paths

**Write-protected project files:**
`src/`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `.env`, `ecosystem.config.cjs`, `ARCHITECTURE.md`, `README.md`, `.git/`, `node_modules/`

**Write-protected system paths:**
`/etc/`, `/boot/`, `/usr/`, `/sbin/`, `/bin/`, `/lib/`, `/var/log/`, `/proc/`, `/sys/`

### Firestore Security (Web Interface)

```mermaid
graph TB
    subgraph "Firestore Security Rules"
        R1["Instance docs<br/>read: owner only | write: server only"]
        R2["Sessions / Chats / Messages<br/>read + write: owner only"]
        R3["Status doc<br/>read: owner only | write: server only"]
    end

    subgraph "Auth"
        USER["User"] -->|"Google / Apple"| FAUTH["Firebase Auth"]
        FAUTH -->|"UID"| RULES["Security Rules"]
        RULES -->|"match ownerId"| FS["Firestore"]
    end

    subgraph "Server Auth"
        PI["Phoebe Server"] -->|"Service Account"| ADMIN["firebase-admin"]
        ADMIN -->|"Bypasses rules"| FS
    end

    style R1 fill:#EF5350,stroke:#C62828,color:#fff
    style R3 fill:#EF5350,stroke:#C62828,color:#fff
```

| Concern        | Solution                                                         |
| -------------- | ---------------------------------------------------------------- |
| NAT traversal  | Firestore as intermediary — no port forwarding needed            |
| Client auth    | Firebase Auth (Google/Apple) — UID matched to `ownerId`          |
| Server auth    | Firebase Admin SDK with service account key                      |
| Data isolation | Rules enforce `request.auth.uid == resource.data.ownerId`        |
| Status writes  | Server-only (admin SDK bypasses rules; client rules deny writes) |

---

## Model Catalog

Phoebe supports two model sources: the Mume AI cloud gateway and local Ollama models. Both catalogs are fetched and cached independently.

### Features

- **Dual sources** — cloud models from Mume AI + local models from Ollama (when `OLLAMA_BASE_URL` is set)
- **Fetch & cache** — cloud catalog saved to `openrouter-models.json`, Ollama catalog to `ollama-models.json`
- **Unified catalog** — both sources are merged for queries, browsing, and search
- **Ollama prefix** — local models are namespaced as `ollama/<model>` (e.g. `ollama/llama3.2`)
- **Search** — keyword search across model names and IDs
- **Ollama filter** — `/models ollama` shows only local Ollama models
- **Capabilities** — detects: tools, vision, audio input/output, image output, reasoning, structured output, web search, video input, file input
- **Pagination** — inline keyboard navigation in Telegram (10 models per page)
- **Price formatting** — displays cost per million tokens

### Provider Routing

When the user sends a message, `resolveProvider(modelId)` in `instance.ts` routes to the correct backend:

- Models starting with `ollama/` → local Ollama server via `@ai-sdk/openai-compatible` (OpenAI-compatible `/v1` endpoint)
- All other models → Mume AI gateway via `@openrouter/ai-sdk-provider`

### Capability Detection

Capabilities are inferred from model metadata:

| Capability        | Detection                                             |
| ----------------- | ----------------------------------------------------- |
| Tools             | `supported_parameters` includes `"tools"`             |
| Vision            | `input_modalities` includes `"image"`                 |
| Audio input       | `input_modalities` includes `"audio"`                 |
| Audio output      | `output_modalities` includes `"audio"`                |
| Image output      | `output_modalities` includes `"image"`                |
| Reasoning         | `supported_parameters` includes `"reasoning"`         |
| Structured output | `supported_parameters` includes `"structured_output"` |
| Web search        | `supported_parameters` includes `"web_search"`        |

---

## Persistence Layer

All state is stored as JSON files on disk in `DATA_DIR` (mounted as a Docker volume).

### Files

| File                          | Structure               | Purpose                                  |
| ----------------------------- | ----------------------- | ---------------------------------------- |
| `users.json`                  | `UserProfile[]`         | User ID, name, username, first/last seen |
| `models.json`                 | `{ chatId: modelId }`   | Per-chat model override                  |
| `voices.json`                 | `{ chatId: voiceName }` | Per-chat TTS voice preference            |
| `voice-reply.json`            | `{ chatId: boolean }`   | Per-chat voice reply toggle              |
| `openrouter-models.json`      | `AIModel[]`             | Cached cloud model catalog (Mume AI)     |
| `ollama-models.json`          | `AIModel[]`             | Cached local model catalog (Ollama)      |
| `conversations/{chatId}.json` | `ModelMessage[]`        | Full conversation history (max 500)      |

### Init Sequence

On startup, `index.ts` loads all persistence stores in order:

1. Ensure data directory exists
2. Load users, models, voices, voice-reply settings
3. Fetch/load model catalog
4. Discover installed skills
5. Init Firestore (if configured)
6. Start web listener + Telegram bot

### Graceful Shutdown

On `SIGINT` / `SIGTERM`:

1. Call `persistAll()` — writes all in-memory state to disk
2. Stop Telegram bot
3. Exit process

---

## Error Handling

### User-Friendly Error Messages

`errors.ts` maps common API error patterns to human-readable messages:

| Pattern                 | User sees                |
| ----------------------- | ------------------------ |
| HTTP 429                | Rate limit message       |
| HTTP 401                | Authentication error     |
| Timeout / ETIMEDOUT     | Timeout message          |
| ECONNREFUSED            | Connection error         |
| Context length exceeded | Context too long message |
| HTTP 500                | Server error message     |

### Stream Error Recovery

If an error occurs during streaming:

1. Partial text (if any) is preserved
2. Error is sent via `channel.sendError()`
3. `StreamResult` is returned with whatever was collected
4. Conversation history is still saved (including partial response)

---

## Deployment Topology

```mermaid
graph TB
    subgraph "Your Machine"
        DOCKER["Docker Container<br/>(Node.js 22, Debian slim)"]
        VOL_DATA["Volume: phoebe-data<br/>(/app/data)"]
        VOL_SKILLS["Volume: phoebe-skills<br/>(/app/skills)"]
        DOCKER --> VOL_DATA
        DOCKER --> VOL_SKILLS
    end

    subgraph "Optional: Google Cloud"
        FIRESTORE["Cloud Firestore"]
        FAUTH["Firebase Auth"]
    end

    subgraph "External APIs"
        MUMEAI["Mume AI Gateway"]
        TELEGRAM["Telegram Bot API"]
        FAL["fal.ai (STT/TTS)"]
    end

    DOCKER <-->|"HTTPS"| MUMEAI
    DOCKER <-->|"Bot API (long-polling)"| TELEGRAM
    DOCKER <-->|"HTTPS"| FAL
    DOCKER <-.->|"firebase-admin<br/>(optional)"| FIRESTORE

    style DOCKER fill:#42A5F5,stroke:#1565C0,color:#000
    style FIRESTORE fill:#FFA726,stroke:#E65100,color:#000
```

### Container Contents

The Docker image is built on `node:22-slim` with additional tools:

- `git`, `curl`, `wget`, `jq` — common utilities
- `python3`, `python3-pip` — for Python-based tasks
- `procps`, `htop` — process monitoring

### Resource Footprint

| Metric       | Typical value   |
| ------------ | --------------- |
| Startup time | < 3 seconds     |
| Memory (RSS) | ~130 MB         |
| Image size   | ~350 MB         |
| Disk (data)  | < 10 MB typical |

---

## Tech Stack Summary

| Component         | Technology                            | Version |
| ----------------- | ------------------------------------- | ------- |
| Runtime           | Node.js                               | 22      |
| Language          | TypeScript (strict, ESM)              | 5.8     |
| Execution         | tsx (no build step)                   | 4.19    |
| AI Engine         | Vercel AI SDK                         | 6.0     |
| AI Gateway        | Mume AI (@openrouter/ai-sdk-provider) | 2.2     |
| Local Models      | Ollama (@ai-sdk/openai-compatible)    | 2.0     |
| Telegram          | grammY                                | 1.35    |
| Schema Validation | Zod                                   | 3.25    |
| Firestore         | firebase-admin                        | 13.6    |
| Env Loading       | dotenv                                | 17.3    |
| Container         | Docker + Docker Compose               | —       |
| STT/TTS           | ElevenLabs via fal.ai                 | —       |
