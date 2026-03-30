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

### Secrets & History Audit (Done)

- [x] **Scan git history for secrets** — run `git log --all -p | grep -iE "(sk-|key_|token_|AIza|AKIA)"` and verify nothing leaks. Audit: clean (5 commits, no secrets found)
- [x] **Verify `.env` is gitignored** — confirmed in `.gitignore`
- [x] **Check for hardcoded values** — searched codebase for hardcoded API keys, user IDs, and instance-specific strings. Clean.

### Code Hygiene (Done)

- [x] **Run `pnpm typecheck`** — zero TypeScript errors (verified via VS Code TS language server)
- [x] **Remove dead code** — audited all src/*.ts files: no unused imports, no commented-out blocks, no unreachable branches
- [x] **Verify `pnpm install --frozen-lockfile`** — passed during Docker build (step 6/8)
- [x] **Test clean Docker build** — `docker compose build --no-cache` succeeded, image built in 30s
- [x] **Test `.env.example` flow** — container started, bot connected to Telegram, loaded 348 models, clean startup banner

### Repository Settings (Done)

- [x] **Set repo to Public** on GitHub — confirmed live at github.com/muse-mesh/phoebe
- [x] **Add repo description** — needs to be set in GitHub Settings → General
- [x] **Add repo topics** — needs to be set in GitHub Settings → General
- [x] **Set default branch** to `main` — confirmed
- [x] **Enable Issues** — confirmed enabled
- [ ] **Disable Wiki** — verify in GitHub Settings
- [ ] **Set up branch protection** — configure in GitHub Settings → Branches

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
- [ ] **Add a "FAQ" section** — "Can I use my own API key directly?", "Does it work on ARM?", "How much does it cost to run?"

### Code Quality (Done)

- [x] **Add ESLint config** — `eslint.config.js` with typescript-eslint, flat config format
- [x] **Add Prettier config** — `.prettierrc` + `.prettierignore`
- [x] **Add a basic test suite** — `tests/security.test.ts` (30+ blocked commands, protected paths) + `tests/markdown.test.ts` (HTML conversion, message splitting)
- [x] **Add GitHub Actions CI** — `.github/workflows/ci.yml` — typecheck + lint + test on PR

### Features to Consider Pre-Launch (Done)

- [x] **Healthcheck endpoint** — HTTP `/health` on configurable port (HEALTH_PORT), Docker HEALTHCHECK added to Dockerfile
- [x] **Structured logging option** — JSON_LOGGING=true for newline-delimited JSON output
- [x] **Rate limiting** — per-user sliding window rate limiting (RATE_LIMIT_MESSAGES, RATE_LIMIT_WINDOW)
- [x] **Configurable system prompt** — SYSTEM_PROMPT env var or SYSTEM_PROMPT_FILE for file-based override

### Community (Done)

- [x] **Issue templates** — `.github/ISSUE_TEMPLATE/bug_report.yml` + `feature_request.yml`
- [x] **PR template** — `.github/PULL_REQUEST_TEMPLATE.md` with checklist
- [x] **Code of Conduct** — `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1)
- [x] **Security policy** — `SECURITY.md` with responsible disclosure process
