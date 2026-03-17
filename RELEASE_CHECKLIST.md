# Open-Source Release Checklist

Pre-release punch list for `muse-mesh/phoebe`. Work through each item before making the repo public.

---

## Documentation (Done)

- [x] **README.md** — rewritten with badges, ToC, features, quick start, full config reference, security model, project structure, Docker reference
- [x] **ARCHITECTURE.md** — rewritten with Mermaid diagrams, module map, streaming strategy, tool system, memory windowing, security architecture, deployment topology
- [x] **CONTRIBUTING.md** — created with dev setup, code style, branch naming, PR guidelines, extension guides
- [x] **LICENSE** — MIT license file created
- [x] **.env.example** — updated with all variables, grouped by required/optional/web/paths, commented defaults
- [x] **package.json** — added `license`, `repository`, `homepage`, `keywords` fields

---

## Must-Do Before Public Push

### Secrets & History Audit

- [ ] **Scan git history for secrets** — run `git log --all -p | grep -iE "(sk-|key_|token_|AIza|AKIA)"` and verify nothing leaks. Current audit: clean (10 commits, no secrets found)
- [ ] **Verify `.env` is gitignored** — confirmed in `.gitignore`
- [ ] **Check for hardcoded values** — search codebase for any hardcoded API keys, user IDs, or instance-specific strings (e.g. `LRL1pk6y...` Firebase UID in ARCHITECTURE.md was in the old version — now removed)

### Code Hygiene

- [ ] **Run `pnpm typecheck`** — ensure zero TypeScript errors before tagging
- [ ] **Remove dead code** — check for unused imports, unreachable branches, commented-out blocks
- [ ] **Verify `pnpm install --frozen-lockfile`** — ensure lockfile is in sync with `package.json`
- [ ] **Test clean Docker build** — `docker compose build --no-cache && docker compose up -d` from scratch
- [ ] **Test `.env.example` flow** — clone fresh, `cp .env.example .env`, fill only required vars, `docker compose up -d`, verify bot responds

### Repository Settings

- [ ] **Set repo to Public** on GitHub
- [ ] **Add repo description** — "Self-hosted AI agent with full tool access — delivered through Telegram and the web"
- [ ] **Add repo topics** — `ai`, `telegram-bot`, `agent`, `self-hosted`, `openrouter`, `ai-sdk`, `typescript`, `docker`, `agent-skills`
- [ ] **Set default branch** to `main`
- [ ] **Enable Issues** — for bug reports and feature requests
- [ ] **Disable Wiki** — docs live in the repo
- [ ] **Set up branch protection** — require PR reviews for `main`

### Release

- [ ] **Create a git tag** — `git tag v2.0.0 && git push --tags`
- [ ] **Create GitHub Release** — attach changelog, link to README quick start
- [ ] **Write release notes** — summarise key features: dual interface, 7 tools, Agent Skills, voice, security model

---

## Polish (Nice-to-Have)

### Documentation

- [ ] **Add screenshots** — Telegram conversation showing tool use, model switching, voice reply
- [ ] **Add a demo GIF** — 30-second screen recording of a full conversation loop
- [ ] **Add a "Troubleshooting" section** to README — common issues (bot not responding, Docker build fails, model errors)
- [ ] **Add a "FAQ" section** — "Can I use my own OpenRouter key directly?", "Does it work on ARM?", "How much does it cost to run?"

### Code Quality

- [ ] **Add ESLint config** — enforce consistent style across contributions
- [ ] **Add Prettier config** — auto-format on save
- [ ] **Add a basic test suite** — at minimum: security validation tests (blocked commands, protected paths), message splitting, Markdown→HTML conversion
- [ ] **Add GitHub Actions CI** — type checking + lint on PR

### Features to Consider Pre-Launch

- [ ] **Healthcheck endpoint** — add a simple HTTP `/health` for Docker healthchecks and monitoring
- [ ] **Structured logging option** — JSON log format for production (alongside the current ANSI format)
- [ ] **Rate limiting** — per-user message rate limiting to prevent abuse in open-access mode
- [ ] **Configurable system prompt** — allow users to customise the system prompt via env var or file

### Community

- [ ] **Issue templates** — bug report and feature request templates in `.github/ISSUE_TEMPLATE/`
- [ ] **PR template** — checklist in `.github/PULL_REQUEST_TEMPLATE.md`
- [ ] **Code of Conduct** — `CODE_OF_CONDUCT.md` (Contributor Covenant)
- [ ] **Security policy** — `SECURITY.md` for responsible disclosure
