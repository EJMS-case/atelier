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

- All photos and wardrobe data stored in your browser's localStorage
- Photos never leave your device (only item names/details sent to Claude for styling)
- Your API key stored locally, never shared

## Notes

- Images are stored as base64 — for a very large wardrobe (200+ items with photos), consider using smaller/compressed images
- The app works best on mobile (add to home screen via Safari → Share → Add to Home Screen)
