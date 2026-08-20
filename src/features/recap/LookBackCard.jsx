// ── LOOK-BACK — HOME CARD (MONTH / QUARTER / YEAR IN REVIEW) ─────────────────
// A self-contained recap over a selectable window: the period at a glance +
// where she went, an AI "most stylish" pick (on demand, judged against her
// fingerprint), period stats (closet utilization, color story, top pieces),
// the garments she leaned on (with "try instead" nudges), and two forward
// looks (rediscover + a small challenge).
//
// judgeMostStylish is DYNAMICALLY imported inside the tap handler — its
// anthropicFetch → toolUse → coerce-shapes chain (~640 lines) has no business
// in the cold-start chunk for a button she may never tap.

import { useMemo, useState } from "react";
import { buildRecap, monthWindow } from "./recapData.js";
import { nyToday, friendlyDate } from "../../lib/time.js";
import { PALETTE } from "../../constants/palette.js";
import { resolveItemIds } from "../../utils/item-helpers.js";

const PERIODS = {
  month:   { days: 30,  chip: "Month",   judgeLabel: "month",   topN: 4 },
  quarter: { days: 90,  chip: "Quarter", judgeLabel: "quarter", topN: 5 },
  year:    { days: 365, chip: "Year",    judgeLabel: "year",    topN: 6 },
};


const card = { background: PALETTE.cream, border: `1px solid ${PALETTE.line}`, borderRadius: 10, padding: 14, marginBottom: 14 };
const label = { fontSize: 9, letterSpacing: "0.2em", color: PALETTE.muted, marginBottom: 8 };
const thumb = { flexShrink: 0, background: "#fff", border: `1px solid ${PALETTE.soft_line}`, borderRadius: 4, overflow: "hidden" };
const Img = ({ it, size }) => (
  <div style={{ ...thumb, width: size, height: size }}>
    {it?.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
  </div>
);

// Short "Mar 4"-style label, noon-anchored so the date can't roll a day.
const shortDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

function monthLabel(startIso, endIso) {
  try {
    return `${shortDate(startIso)} – ${shortDate(endIso)}`;
  } catch { return "last 30 days"; }
}

export default function LookBackCard({ items, favorites = [], apiKey, plans: allPlans, onEditItem, onStyleItem }) {
  const todayIso = nyToday();
  const [period, setPeriod] = useState("month");
  const [stylish, setStylish] = useState(null);
  const [judging, setJudging] = useState(false);
  const [judgeErr, setJudgeErr] = useState("");
  const { days, judgeLabel, topN } = PERIODS[period];

  const pickPeriod = (p) => {
    setPeriod(p);
    setStylish(null);
    setJudgeErr("");
  };

  // The recap's window comes out of the shared planner rows App fetched
  // (null while that fetch is still in flight — same "stay quiet" gate as when
  // this card fetched its own window). fetchPlansBetween applied the same
  // date-ascending order and gte/lte bounds, so the client-side filter matches.
  const plans = useMemo(() => {
    if (!Array.isArray(allPlans)) return null;
    const { startIso } = monthWindow(todayIso, days);
    return allPlans.filter(r => r.date >= startIso && r.date <= todayIso);
  }, [allPlans, todayIso, days]);

  const favLogIds = useMemo(() => new Set(favorites.filter(f => f.type === "outfit").map(f => f.reference_id)), [favorites]);
  const favPieceIds = useMemo(() => new Set(favorites.filter(f => f.type === "piece").map(f => f.reference_id)), [favorites]);

  const recap = useMemo(() => {
    if (!plans) return null;
    return buildRecap({ plans, items, favoriteLogIds: favLogIds, favoritePieceIds: favPieceIds, todayIso, days });
  }, [plans, items, favLogIds, favPieceIds, todayIso, days]);

  if (!recap) return null; // still loading plans — stay quiet

  const periodChips = (
    <div style={{ display: "flex", gap: 4 }}>
      {Object.entries(PERIODS).map(([key, p]) => (
        <button key={key} onClick={() => pickPeriod(key)}
          style={{
            fontSize: 9, letterSpacing: "0.08em", padding: "3px 8px", borderRadius: 10,
            border: `1px solid ${period === key ? PALETTE.ink : PALETTE.soft_line}`,
            background: period === key ? PALETTE.ink : "transparent",
            color: period === key ? PALETTE.cream : PALETTE.muted,
            cursor: "pointer",
          }}>
          {p.chip}
        </button>
      ))}
    </div>
  );

  if (recap.empty) {
    return (
      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={label}>IN REVIEW · {monthLabel(recap.window.startIso, recap.window.endIso)}</div>
          {periodChips}
        </div>
        <div style={{ fontSize: 12, color: PALETTE.muted, lineHeight: 1.5 }}>
          Nothing worn on the calendar in this window yet. Pin what you wear (Planner) and your recap builds itself here.
        </div>
      </section>
    );
  }

  const { glance, wheres, leanedOn, challenge, periodStats } = recap;
  const topOcc = glance.occasions[0];
  const topWx = glance.weathers[0];

  const runJudge = async () => {
    if (!apiKey) { setJudgeErr("Add your Anthropic API key in Settings."); return; }
    setJudging(true); setJudgeErr("");
    try {
      // Lazy chunk: the judge's AI plumbing loads on first tap, not cold start.
      const { judgeMostStylish } = await import("./recapAI.js");
      const picks = await judgeMostStylish({ looks: recap.looks, items, apiKey, topN, periodLabel: judgeLabel });
      setStylish(picks);
    } catch (e) {
      setJudgeErr(e.message || "Couldn't rank looks — try again.");
    } finally {
      setJudging(false);
    }
  };

  const piecesOf = (look) => resolveItemIds(items, look.itemIds);

  return (
    <section style={card}>
      {/* Header + glance + period toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={label}>IN REVIEW · {monthLabel(recap.window.startIso, recap.window.endIso)}</div>
        {periodChips}
      </div>
      <div style={{ fontSize: 13, color: PALETTE.soft, lineHeight: 1.5 }}>
        <strong style={{ color: PALETTE.ink }}>{glance.outfitCount} outfits</strong> over {glance.daysWorn} days
        {glance.tripDays > 0 && <span style={{ color: PALETTE.muted }}> · {glance.tripDays} on trips</span>}
        {topOcc && <> · most for <strong style={{ color: PALETTE.ink }}>{topOcc.key}</strong></>}
        {topWx && <span style={{ color: PALETTE.muted }}> · mostly {topWx.key}</span>}
      </div>

      {/* Where you went */}
      {wheres.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
          {wheres.slice(0, 8).map((w, i) => (
            <span key={i} title={friendlyDate(w.date)}
              style={{ fontSize: 10, padding: "3px 8px", borderRadius: 12, background: "#fff", border: `1px solid ${PALETTE.soft_line}`, color: PALETTE.soft }}>
              {w.isTrip ? "✈ " : ""}{w.where}
            </span>
          ))}
        </div>
      )}

      {/* Period stats — the "in review" layer. Utilization + color story for
          every window; the longer windows are where these numbers get good. */}
      {periodStats && periodStats.distinctGarments > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${PALETTE.soft_line}` }}>
          <div style={{ fontSize: 12, color: PALETTE.soft, lineHeight: 1.6 }}>
            <strong style={{ color: PALETTE.ink }}>{periodStats.distinctGarments}</strong> of {periodStats.garmentCount} garments worn
            {periodStats.utilizationPct !== null && <span style={{ color: PALETTE.muted }}> ({periodStats.utilizationPct}% of the closet)</span>}
            {periodStats.heartedCount > 0 && <> · <strong style={{ color: PALETTE.ink }}>{periodStats.heartedCount}</strong> loved</>}
          </div>
          {periodStats.colorFamilies.length > 0 && (
            <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 4 }}>
              Color story: {periodStats.colorFamilies.slice(0, 5).map(c => c.family).join(" · ")}
            </div>
          )}
          {periodStats.topPieces.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, overflowX: "auto", paddingBottom: 2 }}>
              {periodStats.topPieces.map(({ item, wears }) => (
                <button key={item.id} onClick={() => onEditItem?.(item)}
                  style={{ flexShrink: 0, width: 52, padding: 0, background: "none", border: "none", cursor: "pointer", textAlign: "center" }}>
                  <Img it={item} size={52}/>
                  <div style={{ fontSize: 9, color: PALETTE.muted, marginTop: 2 }}>{wears}×</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Most stylish — AI, on demand, judged against her fingerprint */}
      <div style={{ marginTop: 14 }}>
        <div style={label}>MOST STYLISH THIS {PERIODS[period].chip.toUpperCase()}</div>
        {!stylish && (
          <button onClick={runJudge} disabled={judging}
            style={{ width: "100%", padding: "10px 12px", background: PALETTE.ink, color: PALETTE.cream, border: "none", borderRadius: 8, fontSize: 12, letterSpacing: "0.06em", cursor: judging ? "default" : "pointer" }}>
            {judging ? `Reviewing your ${judgeLabel}…` : "✦ Show my most stylish looks"}
          </button>
        )}
        {judgeErr && <div style={{ fontSize: 11, color: "var(--color-danger)", marginTop: 6 }}>{judgeErr}</div>}
        {stylish && stylish.length === 0 && (
          <div style={{ fontSize: 12, color: PALETTE.muted }}>Not enough full outfits to rank yet.</div>
        )}
        {stylish && stylish.map(({ look, why }, i) => (
          <div key={i} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: i < stylish.length - 1 ? `1px solid ${PALETTE.soft_line}` : "none" }}>
            <div style={{ display: "flex", gap: 3 }}>
              {piecesOf(look).slice(0, 4).map(it => (
                <button key={it.id} onClick={() => onEditItem?.(it)} style={{ padding: 0, border: "none", background: "none", cursor: "pointer" }}>
                  <Img it={it} size={44}/>
                </button>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: PALETTE.ink }}>
                {look.hearted ? "❤ " : ""}{look.occasion || "—"}
                {look.where && <span style={{ color: PALETTE.muted }}> · {look.where}</span>}
              </div>
              <div style={{ fontSize: 11, color: PALETTE.soft, fontStyle: "italic", marginTop: 2, lineHeight: 1.35 }}>{why}</div>
              <div style={{ fontSize: 9, color: PALETTE.muted, marginTop: 2 }}>{friendlyDate(look.date)}{look.isTrip ? " · trip" : ""}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Retrospective + forward sections */}
      {(
        <>
          {/* Leaned-on pieces */}
          {leanedOn.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={label}>LEANED ON · trips not counted</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {leanedOn.slice(0, 6).map(({ item, wears, dates, alternatives }) => (
                  <div key={item.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <button onClick={() => onEditItem?.(item)} style={{ padding: 0, border: "none", background: "none", cursor: "pointer" }}>
                      <Img it={item} size={48}/>
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: PALETTE.ink, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{item.name}</div>
                      <div style={{ fontSize: 10, color: PALETTE.muted }}>
                        worn <strong>{wears}×</strong> · {dates.map(shortDate).join(", ")}
                      </div>
                    </div>
                    {alternatives.length > 0 && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 8, letterSpacing: "0.12em", color: PALETTE.muted, marginBottom: 3 }}>TRY INSTEAD</div>
                        <div style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                          {alternatives.map(alt => (
                            <button key={alt.id} onClick={() => (onStyleItem || onEditItem)?.(alt)} title={`Style ${alt.name}`}
                              style={{ padding: 0, border: "none", background: "none", cursor: "pointer" }}>
                              <Img it={alt} size={34}/>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* (The old REDISCOVER strip is gone — it duplicated Home's Back in
              Rotation scroller, and two resting lists on one page was exactly
              the "repetitive" the owner flagged.) */}

          {/* Challenge */}
          {challenge.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={label}>THE CHALLENGE</div>
              <div style={{ fontSize: 12, color: PALETTE.soft, marginBottom: 8 }}>Wear these three you skipped:</div>
              <div style={{ display: "flex", gap: 8 }}>
                {challenge.map(it => (
                  <button key={it.id} onClick={() => (onStyleItem || onEditItem)?.(it)}
                    style={{ flex: 1, padding: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <Img it={it} size="100%"/>
                    <div style={{ fontSize: 10, color: PALETTE.soft, marginTop: 3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{it.name}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
