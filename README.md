# ✦ Atelier — Personal Wardrobe Stylist

A private wardrobe app that stores your clothes and uses Claude AI to generate styled outfit collages.

## Setup (GitHub + Vercel)

### Step 1 — GitHub
1. Go to [github.com](https://github.com) → **New repository**
2. Name it `atelier` → **Create repository**
3. Upload all these files (drag the whole folder in, or use GitHub Desktop)

### Step 2 — Vercel
1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your `atelier` GitHub repo
3. Framework preset: **Vite**
4. Click **Deploy** — done!

### Step 3 — API Key
1. Open your deployed app
2. Tap the **⚙ Settings** icon in the top right
3. Paste your Anthropic API key (get one at [console.anthropic.com](https://console.anthropic.com))
4. Your key is stored locally on your device only

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
- **F2 — AI Stylist** — generates 3 looks tuned to weather + occasion + mood. *(core generator exists; auto-location weather + thumbs feedback in progress)*
- **F3 — Outfit planner calendar** — *(not yet built)*
- **F4 — Outfit maker (swipe + silhouette)** — *(manual builder exists; silhouette rebuild in progress)*
- **F5 — Mood boards & collages** — *(not yet built)*
- **F6 — Wear tracking** — per-item `last_worn` + "not worn in 30d" filter are live; dedicated neglected feed + cost-per-wear in progress.
- **F7 — Weekly planner strip on Home** — *(not yet built)*
