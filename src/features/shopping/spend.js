// ── WHAT SHE PAYS, AND WHO SHE BUYS FROM ────────────────────────────────────
// The gap analysis used to carry no price information at all and a persona of
// "the styling director at Khaite" — so it shopped at Khaite. Her closet says
// otherwise: 380 priced pieces with a median of $90 for a top and $350 for a
// bag, from FP Movement, Favorite Daughter, Theory, Quince, Mango, Mansur
// Gavriel. Owner, 2026-09-17: "the price points are way high!"
//
// Both readers are pure and derive ONLY from her rows (price_paid, brand) —
// nothing is assumed. A category with fewer than three priced pieces gets no
// band; the prompt then says so instead of inventing one.

const MIN_PRICED = 3;

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Per-category price bands from what she actually paid. */
export function spendBands(wardrobe) {
  const byCat = new Map();
  for (const it of wardrobe || []) {
    const p = Number(it?.price_paid);
    if (!it?.category || it.category === "Misc" || !(p > 0)) continue;
    if (!byCat.has(it.category)) byCat.set(it.category, []);
    byCat.get(it.category).push(p);
  }
  const bands = {};
  for (const [cat, prices] of byCat) {
    if (prices.length < MIN_PRICED) continue;
    const sorted = prices.slice().sort((a, b) => a - b);
    bands[cat] = {
      n: sorted.length,
      median: Math.round(quantile(sorted, 0.5)),
      low: Math.round(quantile(sorted, 0.25)),
      high: Math.round(quantile(sorted, 0.75)),
      max: sorted[sorted.length - 1],
    };
  }
  return bands;
}

/** The brands she keeps coming back to: count ≥ min, with the average paid. */
export function brandTier(wardrobe, { min = 3, max = 14 } = {}) {
  const byBrand = new Map();
  for (const it of wardrobe || []) {
    const b = String(it?.brand || "").trim();
    if (!b || it.category === "Misc") continue;
    if (!byBrand.has(b)) byBrand.set(b, { name: b, n: 0, paid: [] });
    const rec = byBrand.get(b);
    rec.n += 1;
    const p = Number(it.price_paid);
    if (p > 0) rec.paid.push(p);
  }
  return [...byBrand.values()]
    .filter(b => b.n >= min)
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .slice(0, max)
    .map(b => ({ name: b.name, n: b.n, avg: b.paid.length ? Math.round(b.paid.reduce((s, x) => s + x, 0) / b.paid.length) : null }));
}

const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

export function describeSpend(wardrobe) {
  const bands = spendBands(wardrobe);
  const cats = Object.keys(bands).sort((a, b) => bands[b].n - bands[a].n);
  if (!cats.length) return "";
  const lines = cats.map(cat => {
    const b = bands[cat];
    const top = b.max > b.high * 1.8 ? ` (she has gone to ${money(b.max)} once for the right piece)` : "";
    return `• ${cat}: typically ${money(b.low)}–${money(b.high)}, median ${money(b.median)}${top} — from ${b.n} priced pieces`;
  });
  return `WHAT SHE PAYS (from her own purchase records — these are facts, not a budget she set):\n${lines.join("\n")}\nPrice every suggestion inside her typical band for that category and say the price as a range in that band. At most ONE pick per run may sit above the band as a deliberate investment — mark it "investment" in the description and say why it earns the stretch. Never price a category she has no band for above the highest band she does have.`;
}

export function describeBrandTier(wardrobe) {
  const tier = brandTier(wardrobe);
  if (!tier.length) return "";
  return `BRANDS SHE BUYS (from her closet, most-owned first): ${tier.map(b => `${b.name}×${b.n}${b.avg ? ` (~${money(b.avg)})` : ""}`).join(", ")}.\nThis is her tier: contemporary, considered, occasionally an investment piece. Name a brand only when it is genuinely the right make for the piece, and reach for her tier or a peer of it — not a luxury house she does not shop.`;
}
