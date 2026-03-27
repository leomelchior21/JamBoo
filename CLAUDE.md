# JamBoo — Developer Notes

## Stack
- Pure HTML/CSS/JS — no bundler, no framework, no npm
- Two pages: `index.html` (setup) + `game.html` (game board)
- Serverless API: `api/generate.js` (Vercel, proxies DeepSeek)
- Deploy: Vercel + GitHub (`leomelchior21/JamBoo`)

## Architecture Rules
- **Single-file approach**: all CSS and JS are inline in each HTML file — no external `.css` or `.js` files
- **No external JS libraries** (no jQuery, no React, no bundler)
- **API key server-side only** — never expose `DEEPSEEK_API_KEY` in frontend code
- **localStorage** bridges config from setup → game (`jamboo_config` key)
- Test setup page by opening `index.html` directly; game page needs `/api/generate` (use Vercel dev)

## Design System
- Fonts: `Press Start 2P` (pixel labels/headers), `Fredoka One` + `Nunito` (game UI)
- Core palette: `--bg:#07071A`, `--b1:#6600FF`, `--b2:#AA00FF`, `--cyan:#00FFFF`, `--pink:#FF00FF`, `--yellow:#FFD700`
- Retro pixel aesthetic: hard `box-shadow: Npx Npx 0 #000`, pixel borders, LED/CRT effects, `image-rendering:pixelated`
- Use `steps()` timing functions on animations for pixel-art feel

## i18n
- All user-facing strings live in `T` (index.html) and `GT` (game.html) objects
- Languages: `en`, `pt`, `es`
- Always add all 3 translations when adding new UI strings

## Game Flow
1. User configures game on `index.html`, clicks Start
2. Config saved to `localStorage` as `jamboo_config`
3. Redirects to `game.html`
4. `game.html` reads config, POSTs to `/api/generate`, renders board
5. Winner screen shown when all cells answered or teacher clicks End

## Adding Features
1. Add CSS to the `<style>` block at top of the relevant file
2. Add HTML in the appropriate section
3. Add JS to the `<script>` block at the bottom
4. If adding new UI text, add to all 3 language objects (`en`, `pt`, `es`)
5. Keep the retro pixel aesthetic consistent — no rounded corners, hard shadows, neon glows
