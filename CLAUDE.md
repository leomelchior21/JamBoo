# JamBoo — Developer Notes

## Stack
- Pure HTML/CSS/JS — no bundler, no framework, no npm runtime dependencies
- Two pages: `index.html` (builder) + `game.html` (game board)
- Curated question repository: `data/questions.js` (content, not app code) loaded by `index.html`
- Deploy: Vercel + GitHub (`leomelchior21/JamBoo`)
- Production: `https://jamboo.leomaker.app`
- Local dev: `npm run dev` (static server on `http://localhost:4173`) — the normal game flow needs no serverless function
- Tests: `npm test` (Node test runner) and `npm run test:e2e` (Playwright; requires `npm run dev` in another terminal)

## Architecture Rules
- **Single-file approach**: all app CSS and JS are inline in each HTML file — the only external script is `data/questions.js`, which is pure content
- **No external JS libraries** (no jQuery, no React, no bundler)
- **Question data lives in the repository, never in the HTML**: `data/questions.js` defines `globalThis.JAMBOO_QUESTION_REPOSITORY` (works from `file://` and static hosting). The engine index, search, allocation, selection and session building are DOM-free and marked in `index.html` between `/* ═══ ENGINE START ═══ */` and `/* ═══ ENGINE END ═══ */` so `tests/selector.test.mjs` can unit test them
- **No AI in the normal flow**: create/play/select/validate never call an LLM. The legacy `api/` functions are isolated and optional (future admin/content tooling only)
- **`api/` files become serverless functions** and the Vercel Hobby plan allows only 12 per deployment — every shared module under `api/` must be prefixed with `_` (e.g. `api/_quiz-core.mjs`) so Vercel ignores it. Only real endpoints stay unprefixed: `api/ai.js`, `api/generate.js`, `api/ai/health.js`
- **Ollama URL server-side only** — never expose `OLLAMA_URL` in frontend code
- **localStorage** bridges config + frozen session from builder → game (`jamboo_config` key, `session` field); `jamboo_recent_questions` remembers recently played question ids

## Question Repository
- Hierarchy: CATEGORY → SUBJECT → TOPIC → SUBTOPIC → QUESTIONS (`data/questions.js`)
- **Topics AND subtopics are selectable quiz units**: the engine indexes each subtopic as `<topicId>::<subtopicId>` with its own question pool, so a teacher can build a whole-topic board or a specific one (e.g. `video-games::minecraft`, `celebrities::pop-stars`)
- Every question is multiple choice: `id`, `subtopic`, `difficulty` (1 easy / 2 medium / 3 hard), `question`, `choices` (exactly 4, unique), `correctAnswer` (0-3), `tags`
- Optional fields: `language` (defaults to `defaultLanguage`), `active` (false hides it), `reviewStatus` (`approved` or absent), `variantGroup` (never two of the same group in one game)
- Seed repository: 25 topics / 98 subtopics / 849 questions across School (Mathematics, Science, Geography, History, Languages) and General (Entertainment, Technology, World), including Minecraft, Pokémon, Taylor Swift & Pop Stars, Anime & K-Drama, Football Stars, Coding Languages and Geopolitics
- Coding Languages keeps Python, Swift, C# and JavaScript at the same pool size (20 each) and mixes concept questions with code-reading ones: predict the output, name the operator, find the missing token and debug a broken line (`\n` in question text starts a code line; `.q-text` uses `white-space:pre-wrap` so snippets keep their breaks)
- Adding content: append questions to a topic and give each a specific subtopic; keep ids stable and choices unique. `tests/selector.test.mjs` validates the whole repository, including that no curated question is silently dropped by the eligibility check

## Quiz Builder (index.html)
- Flow: TEAMS → BOARD → TOPICS (cards with column allocation) → DIFFICULTY → CREATE JAMBOO
- Board columns are content slots; `sum(topic.columns) === board.columns` is required to create
- Topic cards: column stepper, reorder arrows, change topic, remove. `+ ADD TOPIC` stays available while under 8 topics; adding while the board is full redistributes columns evenly
- Impossible allocations are prevented: the `+` control is disabled at `maxColumnsForTopic = floor(available / rows)` and restored allocations are clamped with a clear message
- Custom picker (`#picker-overlay`): Finder-style Miller columns (subjects → topics → subtopics; the School/General categories stay in the data but the picker flattens all subjects into one column) in a wide panel that grows one column at a time; clicking a container opens the next column, and a subtopic column always starts with a highlighted "Whole topic" row; search over repository metadata (names in 3 languages, aliases, tags, subtopics), Esc closes, Esc/←/→ walk the columns
- Live board preview shows the column titles (`TOPIC I`, `TOPIC II`, …) with the topic accent colour
- Engine: `distributeColumns`, `maxColumnsForTopic`, `difficultyTargets`, `selectQuestions`, `planColumns`, `validateConfiguration`, `buildSession`
- Selection: shuffle first, then per-row difficulty target (progressive for `mixed`), nearest-difficulty fallback, subtopic round-robin, variant-group avoidance, recent-question penalty, Fisher-Yates shuffle of choices per game (repository records are never mutated)
- `buildSession` freezes `{categories, columnTopics, questions[cols][rows], questionIds}` into `jamboo_config.session`; the whole board exists before the first render

## Game (game.html)
- `boot()` reads `jamboo_config`, validates the frozen session and renders the board — no network calls, no generation screen
- Loading shell is brief (logo + "Building your Jamboo…" + progress bar, ~450ms minimum) and only appears while the board is built
- Gameplay is unchanged: board, question modal, MC feedback, timers, team picker, scoring, redo, winner screen, confetti, zoom
- The modal still contains the legacy open/drawing UI, but the repository only produces multiple-choice questions, so those branches are dormant

## Legacy AI tooling (isolated, optional)
- `api/ai.js` + `api/ai/health.js` still expose the DeepSeek/Ollama quiz pipeline for future offline/admin use (drafting banks, classification). Nothing in the normal game flow imports or calls them
- DeepSeek remains the default provider (`api/_deepseek.mjs`, pinned to `deepseek-flash`); the Ollama integration is preserved as `LocalModelProvider` (`api/_ollama.mjs`) behind `QUIZ_AI_PROVIDER=local`
- `ALLOW_LOCAL_AI_FALLBACK=true` is the only way DeepSeek failures may fall back to local
- Provider modules: `api/_quiz-engine.mjs`, `_quiz-topics.mjs`, `_quiz-prompts.mjs`, `_quiz-formats.mjs`, `_quiz-voice.mjs`, `_math-questions.mjs`, `_code-checks.mjs`
- Live smoke test for the provider only: `npm run test:deepseek` (reads `DEEPSEEK_API_KEY`; not part of `npm test`)

## Design System
- Fonts: `Press Start 2P` (pixel labels/headers), `Fredoka One` + `Nunito` (game UI)
- Core palette: `--bg:#07071A`, `--b1:#6600FF`, `--b2:#AA00FF`, `--cyan:#00FFFF`, `--pink:#FF00FF`, `--yellow:#FFD700`
- Retro pixel aesthetic: hard `box-shadow: Npx Npx 0 #000`, pixel borders, LED/CRT effects, `image-rendering:pixelated`
- Use `steps()` for pixel-art UI animations; use `linear` or `ease-in`/`ease-out` for physically realistic motion

## i18n
- All user-facing strings live in `T` (index.html) and `GT` (game.html) objects
- Languages: `en`, `pt`, `es`
- Always add all 3 translations when adding new UI strings. Repository names/aliases are localized in `data/questions.js` (`name:{en,pt,es}`); question text is currently English-only

## Game Flow
1. User builds a Jamboo on `index.html` (teams, board size, topics + columns, difficulty)
2. `CREATE JAMBOO` validates the configuration, selects questions and stores `jamboo_config` (with the frozen `session`) in localStorage
3. Redirects to `game.html`
4. `game.html` reads the session and renders the board immediately
5. When all cells are answered or the teacher clicks End, a 3-second mystery countdown appears, then the winner screen with confetti

## Same Teams, New Game
- "Same Teams, New Game" sets `_keepTeams: true` and redirects to `index.html`
- `restoreConfig()` restores teams, board size, difficulty, language and selected topics (with their column allocation), then clears the flag; creating again builds a fresh question sample

## Scorebar
- Each team is a `.score-chip` (horizontal pill): team name in Nunito Bold (team color) + `(score)` in Press Start 2P
- Chips split left/right of the centered logo; IDs `sc-{i}` (chip) and `sv-{i}` (score span) are used by `applyScore()` and `confirmScoreEdit()`
- Score gain triggers: `💥 +N` burst + `.bounce-anim`; score loss triggers: `💢 -N` slam burst + `.shake-anim`

## Adding Features
1. Add CSS to the `<style>` block at top of the relevant file
2. Add HTML in the appropriate section
3. Add JS to the `<script>` block at the bottom
4. If adding new UI text, add to all 3 language objects (`en`, `pt`, `es`)
5. Keep the retro pixel aesthetic consistent — no rounded corners, hard shadows, neon glows
6. Run `npm test` and `npm run test:e2e` before pushing
