# ✦ Atelier — Personal Wardrobe Stylist

A private wardrobe app that stores your clothes and uses Claude AI to generate styled outfit collages.

## Running it locally

```bash
npm install
npm run dev      # dev server
npm test         # full test suite (offline)
npm run build    # production build
```

Requires Node 20 or newer.

## Deploying

The repo is deployed on Vercel from `main` (framework preset: **Vite**). Pushes
to `main` ship; branches get preview deploys.

## API key

1. Open the app and tap **⚙ Settings** in the top right.
2. Paste your Anthropic API key (get one at [console.anthropic.com](https://console.anthropic.com)).
3. The key is stored on your device only — it is never committed or sent anywhere but Anthropic.

A [Remove.bg](https://remove.bg) key is optional; without one, background
removal falls back to an in-browser model.

## Working on this with Claude

The repo is set up for **Claude Cowork** and **Claude Code on the web**:

- `CLAUDE.md` orients a session — architecture, commands, conventions, and which
  docs to read first.
- `.claude/hooks/session-start.sh` installs dependencies automatically at the
  start of every remote session, so tests and builds work straight away.

To give Cowork access, connect GitHub in Claude's settings and grant it this
repository (`EJMS-case/atelier`). Claude then works on a branch and opens a pull
request; nothing reaches `main` without your review.

## How it works

- **Closet tab** — your wardrobe grid. Tap + to add items (bulk upload supported).
- **Looks tab** — AI-generated outfit collages from your actual wardrobe.
- **Edit** — tap any item to update name, category, color, notes, or photo.
- **Style Me** — pick occasion + weather, add a request, hit Style Me.

## Your data

- Wardrobe data and photos live in Supabase (project `ljcwsrfmojbjdveefoqa`) and sync across devices.
- Photos upload to Supabase Storage bucket `wardrobe-images`; base64 is only used briefly on-device during upload.
- Item names and details are sent to Claude for styling and (on new uploads) for auto-detection.
- Your Anthropic and Remove.bg keys are stored locally, never shared.

## Notes

- The app works best on mobile (add to home screen via Safari → Share → Add to Home Screen).

## Features

Tracking parity with [Fits](https://fits-app.com). Each item below links to the feature spec and current status.

- **F1 — Digital closet with auto-detection** ✨ *(shipped)* — Upload any clothing photo and Claude vision auto-fills category, subcategory, primary/secondary color (hex + name), material, pattern, brand (when a logo is visible), and styling tags. Background removal uses Remove.bg when a key is set, with a free in-browser fallback. Every field is editable inline.
- **F2 — AI Stylist** ✨ *(shipped)* — Streaming looks tuned to weather + occasion (one on first tap, two more per "Style 2 more"). Auto-location weather (Open-Meteo), tri-state garment filters, heart/✕ feedback that re-weights future picks, 24-look combination anti-repeat with item rotation.
- **F3 — Outfit planner calendar** ✨ *(shipped)* — Month grid with mini-collages; trip mode generates ≤20-item packing list.
- **F4 — Look builder** ✨ *(shipped)* — Drag/resize collage canvas with nine slots, searchable picker, layering controls, and save/favorite/schedule. AI "Evaluate look" scores the build and proposes tips; stylist chat suggests completions.
- **F5 — Inspiration** ✨ *(shipped)* — Upload style references; Claude writes one vibe note per image, and those notes (not the images) steer the stylist.
- **F6 — Wear tracking** ✨ *(shipped)* — Persisted `wear_count`, neglected feed (60+ days), top-5 most-worn widget, cost-per-wear when `price_paid` is set.
- **F7 — Home dashboard** ✨ *(shipped)* — Insights landing: today's weather + "Style me for today" CTA, wear stats, neglected pieces, and a look-back recap.
