# MEMORY_BANK (whoami)

This file captures the development context for the personal website project so it can be continued across chats.

## Project goal

Personal website styled like an IDE (Android Studio / Darcula vibe):
- Left: icon navigation (Main / Tools) + a “file list” (flat, IDE-like).
- Center: “editor” with tabs.
- Right: socials toolbar on desktop.
- Mobile: a drawer panel slides in **to the right of the left icon bar** (left icon bar remains clickable).

Future-proofed for adding more tools later (Node.js + TypeScript backend available).

## Tech stack

- **Next.js (App Router) + TypeScript**
- No build system beyond Next
- Docker-ready: `next.config.ts` uses `output: "standalone"`.

## How to run

- Dev:
  - `npm run dev` (note: it runs `clean` first to avoid `.next` chunk corruption)
- Build:
  - `npm run build`
- Docker:
  - `docker build -t whoami .`
  - `docker run --rm -p 3000:3000 whoami`

## Routing (real URLs per page)

Implemented with App Router dynamic routes:
- `/` redirects to `/main/about.md`
- Main:
  - `/main/about.md`
  - `/main/projects.md`
  - `/main/speeches.md`
- Tools:
  - `/tools/roll`
  - `/tools/json-formatter`
  - `/tools/url-encode-decode`

Mapping is in:
- `src/components/IdeShell/routes.ts` (FileId <-> URL)

## “IDE shell” behavior

Main component:
- `src/components/IdeShell/IdeShell.tsx`

Key behaviors:
- Tabs + editor content stay in sync with URL (back/forward supported).
- **Mobile**: selecting Main/Tools icon changes the **drawer content** (panel) without changing the editor page until a file/tool is clicked.
  - Implemented via two states:
    - `mode`: current editor section (affects tabs/content)
    - `panelMode`: current drawer section (affects tree list)
- Tree highlight: highlight **only the currently opened page/tool** (no “default highlight” when viewing other section’s drawer).

## File model

Main/Tools are represented as “files”:
- `src/components/IdeShell/fileTree.ts`
  - `FileId` union
  - `mainTree`, `toolsTree`
  - `fileSection` (FileId -> main/tools)
  - `pages` metadata (titles, types)

Flat structure (no folders shown):
- Main: `about.md`, `projects.md`, `speeches.md`
- Tools: `JSON Formatter`, `Roll`, `URL encode/decode`

## Pages (designed)

### About (`about.md`)
- Rendered as a designed layout, not “code lines”.
- Component: `src/components/main/AboutPage.tsx`
  - Two-column top section
  - Photo **left**: `public/handsome_devil.jpeg`
  - Right: H1 + bio + link to CV (`/cv.pdf`)
- Styling: `src/app/globals.css` (classes prefixed with `.about*`)

### Projects (`projects.md`)
- Designed list of project cards with links and polished descriptions.
- Component: `src/components/main/ProjectsPage.tsx`
  - Projects included:
    - Yandex.Browser (Google Play)
    - Yandex (Google Play)
    - Discord Drafter (GitHub)
    - APK Comparator (GitHub)
    - W40K Gladius — Adeptus Mod (GitHub)
  - Yandex.Start was removed.

### Speeches (`speeches.md`)
- Designed like Projects, but each card includes an inline YouTube player (privacy-enhanced `youtube-nocookie.com` embed).
- Component: `src/components/main/SpeechesPage.tsx`
  - Talks are sorted by `year` (number) descending.
  - Each talk has: title, event, year, description, link, embed id, optional start time.
  - Note: event names can be edited freely (user updated some events).

## Tools (interactive)

### URL Encode/Decode
- Component: `src/components/tools/UrlCodecTool.tsx`
- Uses `encodeURIComponent` / `decodeURIComponent`.

### JSON Formatter
- Component: `src/components/tools/JsonFormatterTool.tsx`
- `Format` parses JSON and pretty-prints with 2-space indent.

### Roll (dice)
- Component: `src/components/tools/DiceTool.tsx`
- Supported dice: d2, d4, d6, d8, d10, d12, d20, d100.
- Click a die to roll immediately (short animation).
- Dice icons are **static SVG assets** under `public/dice/*.svg` and tinted via CSS.
- Mobile layout improvements:
  - Dice selector becomes a grid (multi-column) on mobile.
  - Result card uses full width with symmetric padding.

## Icons & static assets

### No inline SVG in src
All SVG previously inline were moved to `public/`.
- IDE UI icons: `public/icons/*`
  - `main.svg`, `tools.svg`, `close.svg`, `file.svg`, `tool-terminal.svg`
- Dice icons: `public/dice/*`

### Social icons
Social icons are pulled from jsDelivr Simple Icons v9:
- Example: `https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/telegram.svg`
- Display uses CSS filter for dark theme (`.socialIcon` in `globals.css`).

Configured socials (order):
- Telegram: `https://t.me/arychagov`
- LinkedIn: `https://www.linkedin.com/in/antonrychagov/`
- GitHub: `https://github.com/arychagov`
- Instagram: `https://www.instagram.com/arychagov/`
- Gmail: `mailto:anton.rychagov@gmail.com`

## Mobile UX notes

- Drawer/backdrop is offset: drawer opens to the right of the left icon bar; backdrop doesn’t cover the icon bar.
- Social dock on mobile:
  - Shows only on `about.md`
  - Horizontal layout
  - Hidden when drawer is open
  - z-index lowered so drawer/backdrop is always above it

## Site metadata

- Title: `Anton Rychagov`
- Favicon: `public/favicon.svg`
- Metadata in: `src/app/layout.tsx`

## Common “gotchas” encountered

- Next dev/build chunk errors like `Cannot find module './994.js'` or missing `.nft.json` are typically caused by stale or concurrently-written `.next`.
  - Fix: stop dev servers, run `npm run clean`, then rebuild.
  - Dev script already runs clean first.

## Next likely tasks

- Continue designing remaining pages and refining UI/spacing.
- Optionally add per-project images (there is `public/projects/drafter.png` already in repo).
- Add richer navigation state (e.g., open tabs per route) if desired.

