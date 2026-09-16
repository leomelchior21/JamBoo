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
- Actions: `quiz-plan` (topic → columns + slots + routing), `quiz-batch` (question batches), `quiz-validate` (final check, supports `missingSlotIds` for partial boards), `quiz-category` (single locked category)
- Modules: `api/knowledge-router.mjs` (MATH/TIMELESS/HISTORICAL/CURRENT + date/ambiguity normalization), `api/math-questions.mjs` (deterministic arithmetic), `api/search-provider.mjs` (SearchProvider interface, Wikipedia + optional HTTP web search, evidence objects), `api/question-cache.mjs` (verified-question cache with per-route TTL), `api/quiz-planner.mjs` (topic → column planning)
- Failed slots are reported as `failedSlots` (never abort the whole board); `game.html` retries once then renders remaining gaps as disabled cells
- Search API keys stay server-side (`SEARCH_API_URL`, `SEARCH_API_KEY`, `SEARCH_API_RESULTS_PATH`); see `.env.example`

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
4. `game.html` reads config and POSTs to `/api/ai`; the Vercel Function forwards the request to `${OLLAMA_URL}/api/chat`
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
