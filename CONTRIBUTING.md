# Contributing to Phoebe

Thanks for your interest in contributing! Here's how to get started.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/<your-username>/phoebe.git
   cd phoebe
   ```
3. **Install dependencies**:
   ```bash
   pnpm install
   ```
4. **Configure**:
   ```bash
   cp .env.example .env
   # Fill in your keys
   ```
5. **Run in dev mode**:
   ```bash
   pnpm dev
   ```

## Development

### Prerequisites

- Node.js 22+
- pnpm 10+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A Mume AI API key (from [mume.ai](https://mume.ai))

### Scripts

```bash
pnpm dev         # Start with file watching (tsx --watch)
pnpm start       # Run in production mode
pnpm typecheck   # Type check with tsc --noEmit
```

### Project Layout

The codebase is organised into clear modules:

- `src/ai/` — AI streaming engine and output channel abstraction
- `src/bot/` — Telegram bot commands, handlers, and prompt
- `src/persistence/` — JSON-based state persistence
- `src/web/` — Firestore listener for the web interface
- `src/tools.ts` — Built-in AI tools and Agent Skills registry
- `src/security.ts` — Command and path validation

See [ARCHITECTURE.md](ARCHITECTURE.md) for a full system walkthrough.

## Making Changes

### Branch Naming

Use descriptive branch names:

- `feat/voice-cloning` — new features
- `fix/message-splitting` — bug fixes
- `docs/api-reference` — documentation
- `refactor/tool-registry` — code improvements

### Code Style

- TypeScript strict mode is enabled
- ESM modules (`"type": "module"` in package.json)
- Prefer `const` over `let`
- Use explicit return types on exported functions
- Keep files focused — one module per file

### Commit Messages

Write clear, concise commit messages:

```
feat: add Slack output channel
fix: handle empty tool results in context windowing
docs: add deployment guide for Raspberry Pi
refactor: extract model capability detection
```

## Pull Requests

1. **Keep PRs focused** — one feature or fix per PR
2. **Run type checking** before submitting: `pnpm typecheck`
3. **Update documentation** if you change behaviour or add features
4. **Describe the change** clearly in the PR description
5. **Link related issues** if applicable

## Reporting Issues

When filing an issue, include:

- **What happened** vs. what you expected
- **Steps to reproduce**
- **Environment** — OS, Node version, Docker version
- **Logs** — relevant output from `docker compose logs`

## Adding a New Output Channel

Phoebe is designed for extensibility. To add a new interface (e.g. Slack, Discord):

1. Implement the `OutputChannel` interface from `src/ai/channel.ts`
2. Create a new file (e.g. `src/ai/slack-channel.ts`)
3. Wire it to your input source
4. Call `runAIStream()` with your channel

See `src/ai/telegram-channel.ts` (~60 lines) for a reference implementation.

## Adding a New Tool

1. Add your tool definition in `src/tools.ts` using the AI SDK `tool()` helper
2. Define parameters with Zod schemas
3. Add security validation if the tool accesses the filesystem or network
4. Update the tool count in `src/bot/prompt.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
