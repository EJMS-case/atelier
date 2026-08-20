// ── BRAND ATLAS — LESSER-KNOWN BRAND DISCOVERY ───────────────────────────────
// Owner request 2026-08-20: "find new, unique and lesser-known brands to
// explore that I would love … most were international and matched my style
// exactly. Can that live in the home page or will it get too heavy?"
//
// The weight answer is the architecture: Home renders ONLY the cached result
// (zero AI calls, zero network); a scouting run happens on an explicit tap in
// BrandDiscoveryView and persists to user_settings (cross-device) so the card
// is instant forever after. Each run uses the Anthropic **web search server
// tool** so the finds are current and genuinely off the beaten path — with a
// graceful fallback to a search-less run if the key's org doesn't have the
// tool enabled.
//
// Taste grounding is deterministic and cheap: her owned-brand census (what she
// demonstrably buys), core palette, and texture profile from
// wardrobe-coverage.js, plus the style fingerprint. Owned + dismissed brands
// are excluded by instruction.

import { anthropicFetch } from "../../lib/ai/toolUse.js";
import { logAiError } from "../../lib/ai/logError.js";
import { MODEL_STRONG } from "../../constants/models.js";
import { sb } from "../../lib/supabase.js";
import { parseLooseJson } from "../../utils/coerce-shapes.js";
import { describeCorePalette, describeTextureCoverage, seasonForDate } from "../../utils/wardrobe-coverage.js";

// Deterministic taste profile from the closet — brands ranked by how much of
// her wardrobe they actually are.
export function tasteProfile(items) {
  const brandCounts = {};
  for (const it of items || []) {
    const b = String(it.brand || "").trim();
    if (!b) continue;
    brandCounts[b] = (brandCounts[b] || 0) + 1;
  }
  const ranked = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]);
  const ownedBrands = ranked.map(([b]) => b);
  const brandLine = ranked.slice(0, 20).map(([b, n]) => `${b}×${n}`).join(", ");
  return {
    ownedBrands,
    lines: [
      brandLine ? `BRANDS SHE ACTUALLY BUYS (by closet share): ${brandLine}` : "",
      describeCorePalette(items),
      describeTextureCoverage(items, seasonForDate()),
    ].filter(Boolean),
  };
}

// Pure, tolerant parse: find the last JSON array of brand objects anywhere in
// the model's final text (prose or fences around it are fine). Returns [] when
// nothing usable parses — the caller decides whether to error.
export function parseBrandDiscovery(text) {
  const src = String(text || "");
  const starts = [];
  for (let i = 0; i < src.length; i++) if (src[i] === "[") starts.push(i);
  for (let s = starts.length - 1; s >= 0; s--) {
    let parsed;
    try { parsed = parseLooseJson(src.slice(starts[s])); } catch { continue; }
    if (!Array.isArray(parsed)) continue;
    const brands = parsed
      .filter(b => b && typeof b === "object" && String(b.name || "").trim())
      .map(b => ({
        name: String(b.name).trim(),
        origin: String(b.origin || "").trim(),
        why: String(b.why || "").trim(),
        priceBand: String(b.priceBand || b.price || "").trim(),
        startWith: String(b.startWith || "").trim(),
        url: /^https?:\/\//i.test(String(b.url || "").trim()) ? String(b.url).trim() : "",
      }));
    // Dedupe by name, first occurrence wins.
    const seen = new Set();
    const deduped = brands.filter(b => {
      const k = b.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (deduped.length > 0) return deduped;
  }
  return [];
}

function buildPrompt({ profileLines, excludeBrands, fingerprint }) {
  return `You are a sharp fashion editor scouting brands for one specific client. Her register is quiet luxury (The Row, Totême, Khaite; easy-feminine by way of Sézane) — but she already knows those houses. Your job is the layer BELOW the radar: newer, independent, and international labels she has likely never heard of and would genuinely love.

HER TASTE, FROM HER ACTUAL CLOSET:
${profileLines.join("\n")}
${fingerprint ? `\nHER STYLE FINGERPRINT (distilled from what she actually wears):\n${fingerprint}\n` : ""}
Use web search to verify each brand is real, currently active, and purchasable (find its official site). Favor international finds — Scandinavian, Korean, French, Australian, anywhere — over US mall brands. NEVER include: brands she already owns, the big luxury houses, or anything mass-market (${excludeBrands.slice(0, 40).join(", ") || "none listed"}).

Return 6-8 brands. For each, tie the "why" to HER closet — name the pieces or palette of hers it rhymes with. "startWith" is the ONE piece to order first. "priceBand" is $, $$, or $$$ with a rough range (e.g. "$$ · tops $120-250").

After any searching, end your reply with ONLY this JSON array (no prose after it):
[{"name":"...","origin":"city/country","why":"...","priceBand":"...","startWith":"...","url":"https://..."}]`;
}

/**
 * One scouting run. Explicit-tap only — never call this on a render path.
 * @returns {Promise<{brands: Array, generated_at: string, web: boolean}>}
 */
export async function generateBrandDiscovery({ items, apiKey, excludeBrands = [] }) {
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings.");
  const profile = tasteProfile(items);
  const fingerprint = await sb.fingerprintTextCached(600).catch(() => "");
  const exclude = [...new Set([...profile.ownedBrands, ...excludeBrands])];
  const prompt = buildPrompt({ profileLines: profile.lines, excludeBrands: exclude, fingerprint });

  // Web-search turns are expensive in OUTPUT tokens: every search call and
  // its results ride the assistant turn, so the budget must cover searching
  // AND the final JSON. The first production run died at max_tokens 3000
  // with only its opening sentence emitted (ai_errors 2026-08-20 06:20) —
  // hence 8000 here, searches capped at 4, and two recovery paths below.
  const TOOLS = [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }];
  const baseBody = { model: MODEL_STRONG, max_tokens: 8000 };
  let messages = [{ role: "user", content: prompt }];

  // Attempt 1: with the web search server tool. Fallback (only if the API
  // rejects the tool — org not enabled): without it, flagged web:false so
  // the UI says the finds weren't verified live.
  let body = null;
  let usedWeb = true;
  try {
    const res = await anthropicFetch({ ...baseBody, tools: TOOLS, messages }, { apiKey });
    body = await res.json();
  } catch (e) {
    if (!/web_search|tool/i.test(e?.message || "")) throw e;
    usedWeb = false;
    const res = await anthropicFetch({ ...baseBody, messages }, { apiKey });
    body = await res.json();
  }

  // Long server-tool turns can pause; continue until the model actually ends
  // its turn (bounded — each round is one more API call).
  let rounds = 0;
  while (body.stop_reason === "pause_turn" && rounds < 3) {
    messages = [...messages, { role: "assistant", content: body.content }];
    const res = await anthropicFetch(
      { ...baseBody, ...(usedWeb ? { tools: TOOLS } : {}), messages }, { apiKey });
    body = await res.json();
    rounds++;
  }

  const textOf = (b) => (b.content || []).filter(x => x.type === "text").map(x => x.text || "").join("\n");
  let text = textOf(body);
  let brands = parseBrandDiscovery(text);

  // Ran out of budget mid-answer? One tool-free continuation: "finish the
  // JSON now" — the research is already in the turn's context.
  if (brands.length === 0 && body.stop_reason === "max_tokens") {
    messages = [...messages, { role: "assistant", content: body.content },
      { role: "user", content: "Finish now: output ONLY the complete JSON array of brands in the agreed format — no prose, no searches." }];
    const res = await anthropicFetch({ model: MODEL_STRONG, max_tokens: 2500, messages }, { apiKey });
    const finishBody = await res.json();
    text = textOf(finishBody) || text;
    brands = parseBrandDiscovery(text);
  }

  if (brands.length === 0) {
    logAiError("brand_discovery:parse", {
      stop_reason: body.stop_reason ?? null,
      web: usedWeb,
      text: text.slice(0, 4000),
    }, "unparseable brand discovery response");
    throw new Error("The scouting run came back garbled — tap again.");
  }
  return { brands, generated_at: new Date().toISOString(), web: usedWeb };
}
