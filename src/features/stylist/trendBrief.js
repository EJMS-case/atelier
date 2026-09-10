// ── WHAT READS CURRENT — the seasonal trend brief ────────────────────────────
// Owner, 2026-09-10: "The evaluator should be very chic and stylish given
// current trends and my general preferences." The app's only trend source was
// a hand-curated colour-pair library; everything else the stylist "knew" about
// what reads current was frozen at whichever month a prompt was written.
//
// This brief is researched, not recalled: one web-search call per season
// (the same server tool Brand Atlas already uses), written TO her in her
// register, cached cross-device in user_settings (`trend_brief`), refreshed
// automatically when the season turns or the brief is over ~5 weeks old, and
// refreshable by hand in Style Profile. Every AI surface reads it as TASTE
// GUIDANCE — her closet and her preferences always win over a trend.
//
// Pure pieces (season maths, staleness, composition, parsing) are exported
// for scripts/stylist-standard.test.mjs; the network call is one function.

import { anthropicFetch } from "../../lib/ai/toolUse.js";
import { logAiError } from "../../lib/ai/logError.js";
import { MODEL_STRONG } from "../../constants/models.js";
import { sb } from "../../lib/supabase.js";
import { seasonForDate } from "../../utils/wardrobe-coverage.js";

export const TREND_BRIEF_KEY = "trend_brief";
const MAX_AGE_DAYS = 35;

export function briefSeasonLabel(date = new Date()) {
  return `${seasonForDate(date)} ${date.getFullYear()}`;
}

// Stale when there is no brief, the season has turned, or it is older than
// MAX_AGE_DAYS — trends inside a season drift too.
export function trendBriefIsStale(brief, now = new Date()) {
  if (!brief || !brief.text) return true;
  if (brief.season !== briefSeasonLabel(now)) return true;
  const at = Date.parse(brief.generated_at || "");
  if (!Number.isFinite(at)) return true;
  return (now.getTime() - at) / 86400000 > MAX_AGE_DAYS;
}

// The prompt block every surface composes in. Guidance, never a rule.
export function composeTrendBlock(brief) {
  if (!brief?.text) return "";
  const when = brief.generated_at ? new Date(brief.generated_at).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : "";
  return `WHAT READS CURRENT — ${brief.season || "this season"}${when ? `, researched ${when}` : ""} (taste guidance written to her; her closet and her own preferences always win over a trend, and nothing here is a reason to buy):\n${brief.text}`;
}

// Pull the "•" lines out of a model reply; drop a trailing Sources line into
// its own field so the prompt never carries URLs.
export function parseTrendReply(text) {
  const lines = String(text || "").split("\n").map(l => l.trim()).filter(Boolean);
  const bullets = lines.filter(l => /^[•\-–*]\s*/.test(l)).map(l => l.replace(/^[•\-–*]\s*/, "• ").replace(/\s+/g, " "));
  const sourcesLine = lines.find(l => /^sources?:/i.test(l)) || "";
  const sources = sourcesLine.replace(/^sources?:\s*/i, "").split(/[,;]\s*/).map(s => s.trim()).filter(Boolean);
  return { text: bullets.slice(0, 10).join("\n"), sources };
}

export async function loadTrendBrief() {
  return sb.getSettingJson(TREND_BRIEF_KEY).catch(() => null);
}

/**
 * Research this season's brief with web search and store it. Returns the
 * stored brief. Throws on a hard failure so the Style Profile button can say
 * so; the App-mount refresh swallows it.
 */
export async function generateTrendBrief({ apiKey, now = new Date() } = {}) {
  if (!apiKey) throw new Error("Add your Anthropic API key in Settings.");
  const season = briefSeasonLabel(now);
  const prompt = `You are the trend editor for one client's personal stylist. Research what is genuinely CURRENT for ${season} — this season, not last year — in the quiet-luxury, editorial register (The Row, Totême, Khaite, Saint Laurent; easy-feminine by way of Sézane), for a woman in NYC who dresses for a business-professional office, client dinners, and polished weekends, with Dark Winter colouring (cool, deep, icy tones near the face; warm browns and warm reds are welcome too).

Use web search to verify against at least two current, credible fashion sources (runway reviews, editors' season guides). Then write the brief TO her — "you", "your" — as 6 to 9 lines, each starting with "•", each ≤ 24 words, covering: silhouette and proportion, how layers are worn (she always wears a blazer open), colour depth and pairings, shoes, bags, textures and fabrics, and one or two things that now read dated. Concrete and wearable, never a shopping list, no brand-dropping beyond the register above. No headers, no prose outside the bullets. End with one line "Sources: " followed by the source domains only.`;

  const TOOLS = [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }];
  const baseBody = { model: MODEL_STRONG, max_tokens: 8000 };
  let messages = [{ role: "user", content: prompt }];
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
  let rounds = 0;
  while (body.stop_reason === "pause_turn" && rounds < 3) {
    messages = [...messages, { role: "assistant", content: body.content }];
    const res = await anthropicFetch({ ...baseBody, ...(usedWeb ? { tools: TOOLS } : {}), messages }, { apiKey });
    body = await res.json();
    rounds++;
  }
  const textOf = (b) => (b.content || []).filter(x => x.type === "text").map(x => x.text || "").join("\n");
  let parsed = parseTrendReply(textOf(body));
  if (!parsed.text && body.stop_reason === "max_tokens") {
    messages = [...messages, { role: "assistant", content: body.content },
      { role: "user", content: "Finish now: output ONLY the 6-9 bullet lines and the Sources line — no searches, no prose." }];
    const res = await anthropicFetch({ model: MODEL_STRONG, max_tokens: 2000, messages }, { apiKey });
    parsed = parseTrendReply(textOf(await res.json()));
  }
  if (!parsed.text) {
    logAiError("trend_brief:parse", { stop_reason: body.stop_reason ?? null, text: textOf(body).slice(0, 2000) }, "unparseable trend brief");
    throw new Error("The trend brief came back empty — try again.");
  }
  const brief = { text: parsed.text, sources: parsed.sources, season, generated_at: now.toISOString(), web: usedWeb };
  await sb.saveSettingJson(TREND_BRIEF_KEY, brief);
  return brief;
}

// Mount-time refresh: best-effort, one call per season (or ~5 weeks). Returns
// the brief in force (fresh or existing) and never throws.
export async function maybeRefreshTrendBrief({ apiKey, now = new Date() } = {}) {
  const existing = await loadTrendBrief();
  if (!trendBriefIsStale(existing, now)) return existing;
  if (!apiKey) return existing;
  try { return await generateTrendBrief({ apiKey, now }); }
  catch { return existing; }
}
