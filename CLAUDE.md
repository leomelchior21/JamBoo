# JamBoo — Developer Notes

## Stack
- Pure HTML/CSS/JS — no bundler, no framework, no npm
- Two pages: `index.html` (setup) + `game.html` (game board)
- Serverless API: `api/ai.js` plus `api/ai/health.js` (Vercel proxies a private Ollama server through the URL in `OLLAMA_URL`)
- Deploy: Vercel + GitHub (`leomelchior21/JamBoo`)
- Production: `https://jamboo.leomaker.app`

## Architecture Rules
- **Single-file approach**: all CSS and JS are inline in each HTML file — no external `.css` or `.js` files
- **No external JS libraries** (no jQuery, no React, no bundler)
- **Ollama URL server-side only** — never expose `OLLAMA_URL` in frontend code
- **localStorage** bridges config from setup → game (`jamboo_config` key)
- Test setup page by opening `index.html` directly; game page needs `/api/ai` (use Vercel dev)

## Quiz Generation Pipeline (server)
- `game.html` is authoritative for the board: it sends the exact columns/rows/difficulty/question type and the server plans every slot deterministically (`api/quiz-core.mjs`). The AI never decides board dimensions, scoring or question types.
- Actions: `quiz-plan` (topic → categories + slots + voice kind), `quiz-batch` (question batches), `quiz-validate` (final check). Partial boards are never committed: `quiz-validate` fails when any slot is missing.
- Providers (`api/ai-provider.mjs`): DeepSeek is the default generator (`api/deepseek.mjs`, pinned to `deepseek-flash` = DeepSeek-V4.1-Flash, `thinking: {type:"disabled"}`, OpenAI-compatible `/chat/completions`); legacy Flash names are normalized and any other `DEEPSEEK_MODEL` value is ignored and logged. The Ollama integration is preserved as `LocalModelProvider` (`api/ollama.mjs`) behind `QUIZ_AI_PROVIDER=local`. `ALLOW_LOCAL_AI_FALLBACK=true` is the only way DeepSeek failures may fall back to local.
- Modules: `api/quiz-engine.mjs` (orchestration, bounded retries, per-category parallel generation, call budgets), `api/quiz-topics.mjs` (comma/prose topic parsing, planner prompt, deterministic fallbacks), `api/quiz-prompts.mjs` (question rules, board contract, variation hints), `api/quiz-formats.mjs` (JSON schemas; DeepSeek receives the schema as prompt text), `api/quiz-voice.mjs` (topic flavours), `api/math-questions.mjs` (deterministic arithmetic), `api/code-checks.mjs` (deterministic `print()` output checks)
- All AI output is validated in code: schema/shape, exact slot count, duplicates, unstable-fact prompts, answer giveaways, and arithmetic/print answers are recomputed server-side. Multiple choice arrives as `a` + 3 `x` distractors and the server owns the shuffled correct index.
- Every provider request logs `[ai-usage]` JSON with provider, model, stage, category, retry, tokens and duration; API keys are never logged. Transient provider failures (429/5xx, timeouts, invalid responses) are retried inside the bounded repair rounds; fatal errors (401/402/400) fail fast with a clear 502.
- Each `/api/ai` request has a whole-request deadline (`QUIZ_AI_TIMEOUT_MS`, default 140s) with a 5s response margin. The engine stops starting new provider rounds when less than one call fits, reports the remaining slots as `failedSlots` on an HTTP 200 batch, and the client retries them in later rounds; a request only 504s when even the deadline cannot be honored. DeepSeek timeouts cover the entire call, including reading the response body.
- Live smoke test for the default provider only (no Ollama fallback): `npm run test:deepseek` (reads `DEEPSEEK_API_KEY` from env or `.env.local`; options `--topic --columns --rows --lang --difficulty --type`). It runs plan → batches → atomic validate and prints per-question output plus token usage; it does not run as part of `npm test`.
- Generation speed: server runs independent category groups in parallel; `game.html` runs up to `BATCH_CONCURRENCY` batch requests at once and retries duplicates.

## Design System
- Fonts: `Press Start 2P` (pixel labels/headers), `Fredoka One` + `Nunito` (game UI)
- Core palette: `--bg:#07071A`, `--b1:#6600FF`, `--b2:#AA00FF`, `--cyan:#00FFFF`, `--pink:#FF00FF`, `--yellow:#FFD700`
- Retro pixel aesthetic: hard `box-shadow: Npx Npx 0 #000`, pixel borders, LED/CRT effects, `image-rendering:pixelated`
- Use `steps()` for pixel-art UI animations; use `linear` or `ease-in`/`ease-out` for physically realistic motion (pendulums, spinning vortex, etc.)

## i18n
- All user-facing strings live in `T` (index.html) and `GT` (game.html) objects
- Languages: `en`, `pt`, `es`
- Always add all 3 translations when adding new UI strings

## Game Flow
1. User configures game on `index.html`, clicks Start
2. Config saved to `localStorage` as `jamboo_config`
3. Redirects to `game.html`
4. `game.html` reads config and POSTs to `/api/ai`; the Vercel Function generates content through the configured provider (DeepSeek by default, Ollama via `QUIZ_AI_PROVIDER=local`)
5. When all cells answered or teacher clicks End, a 3-second mystery countdown screen appears (`#mystery-screen`), then the winner screen is revealed with confetti

## Same Teams, New Game
- Pressing "Same Teams, New Game" on the winner screen sets `_keepTeams: true` in `jamboo_config` and redirects to `index.html`
- `init()` in `index.html` detects `_keepTeams`, restores all previous settings (team names, grid size, difficulty, question type, language, topic prompt), then clears the flag

## Scorebar
- Each team is rendered as a `.score-chip` (horizontal pill): team name in Nunito Bold (team color) + `(score)` in Press Start 2P
- Chips split left/right of the centered logo; IDs `sc-{i}` (chip) and `sv-{i}` (score span) are used by `applyScore()` and `confirmScoreEdit()`
- Score gain triggers: `💥 +N` burst (fixed, spawned at chip position) + `.bounce-anim` on chip
- Score loss triggers: `💢 -N` slam burst + `.shake-anim` on chip

## Loading Screen
- Three animations selected randomly at the start of `boot()`: Rube Goldberg machine (`anim-rgb`), Newton's Cradle (`anim-cradle`), Vortex (`anim-vortex`)
- Only one is shown at a time (`display:block`/`display:none`); the other two default to `display:none` in HTML
- Newton's Cradle physics: `linear` overall with per-keyframe `ease-in` (swinging down) and `ease-out` (swinging up); symmetric 25/50/75% cycle
- Vortex: `linear` rotation (not `steps()`) for smooth hypnotic spin; alternating `reverse` on even rings

## Adding Features
1. Add CSS to the `<style>` block at top of the relevant file
2. Add HTML in the appropriate section
3. Add JS to the `<script>` block at the bottom
4. If adding new UI text, add to all 3 language objects (`en`, `pt`, `es`)
5. Keep the retro pixel aesthetic consistent — no rounded corners, hard shadows, neon glows
