// ── MONTHLY LOOK-BACK — HOME CARD ────────────────────────────────────────────
// A self-contained recap of the last 30 days: the month at a glance + where she
// went, an AI "most stylish" pick (on demand), the garments she leaned on (with
// "try instead" nudges), and two forward looks (rediscover + a small challenge).

import { useEffect, useMemo, useState } from "react";
import { fetchPlansBetween } from "../planner/plannerApi.js";
import { buildRecap, monthWindow } from "./recapData.js";
import { judgeMostStylish } from "./recapAI.js";
import { nyToday, friendlyDate } from "../../lib/time.js";

const PALETTE = {
  ink: "var(--color-ink)", soft: "var(--color-text)", muted: "var(--color-text-muted)",
  bg: "var(--color-surface)", cream: "var(--color-bg)",
  line: "var(--color-border-strong)", soft_line: "var(--color-border)",
};

const card = { background: PALETTE.cream, border: `1px solid ${PALETTE.line}`, borderRadius: 10, padding: 14, marginBottom: 14 };
const label = { fontSize: 9, letterSpacing: "0.2em", color: PALETTE.muted, marginBottom: 8 };
const thumb = { flexShrink: 0, background: "#fff", border: `1px solid ${PALETTE.soft_line}`, borderRadius: 4, overflow: "hidden" };
const Img = ({ it, size }) => (
  <div style={{ ...thumb, width: size, height: size }}>
    {it?.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
  </div>
);

function monthLabel(startIso, endIso) {
  try {
    const f = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${f(startIso)} – ${f(endIso)}`;
  } catch { return "last 30 days"; }
}

export default function LookBackCard({ items, favorites = [], apiKey, onEditItem, onStyleItem }) {
  const todayIso = nyToday();
  const [plans, setPlans] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [stylish, setStylish] = useState(null);
  const [judging, setJudging] = useState(false);
  const [judgeErr, setJudgeErr] = useState("");

  useEffect(() => {
    const { startIso } = monthWindow(todayIso, 30);
    fetchPlansBetween(startIso, todayIso).then(r => setPlans(Array.isArray(r) ? r : [])).catch(() => setPlans([]));
  }, [todayIso]);

  const favLogIds = useMemo(() => new Set(favorites.filter(f => f.type === "outfit").map(f => f.reference_id)), [favorites]);
  const favPieceIds = useMemo(() => new Set(favorites.filter(f => f.type === "piece").map(f => f.reference_id)), [favorites]);

  const recap = useMemo(() => {
    if (!plans) return null;
    return buildRecap({ plans, items, favoriteLogIds: favLogIds, favoritePieceIds: favPieceIds, todayIso, days: 30 });
  }, [plans, items, favLogIds, favPieceIds, todayIso]);

  if (!recap) return null; // still loading plans — stay quiet
  if (recap.empty) {
    return (
      <section style={card}>
        <div style={label}>LOOK-BACK · {monthLabel(recap.window.startIso, recap.window.endIso)}</div>
        <div style={{ fontSize: 12, color: PALETTE.muted, lineHeight: 1.5 }}>
          Nothing worn on the calendar in the last 30 days yet. Pin what you wear (Planner) and your recap builds itself here.
        </div>
      </section>
    );
  }

  const { glance, wheres, leanedOn, rediscover, challenge } = recap;
  const topOcc = glance.occasions[0];
  const topWx = glance.weathers[0];

  const runJudge = async () => {
    if (!apiKey) { setJudgeErr("Add your Anthropic API key in Settings."); return; }
    setJudging(true); setJudgeErr("");
    try {
      const picks = await judgeMostStylish({ looks: recap.looks, items, apiKey, topN: 4 });
      setStylish(picks);
    } catch (e) {
      setJudgeErr(e.message || "Couldn't rank looks — try again.");
    } finally {
      setJudging(false);
    }
  };

  const piecesOf = (look) => (look.itemIds || []).map(id => items.find(it => it.id === id)).filter(Boolean);

  return (
    <section style={card}>
      {/* Header + glance */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={label}>LOOK-BACK · {monthLabel(recap.window.startIso, recap.window.endIso)}</div>
        <button onClick={() => setExpanded(x => !x)}
          style={{ fontSize: 10, color: PALETTE.muted, background: "none", border: "none", cursor: "pointer", letterSpacing: "0.04em" }}>
          {expanded ? "Less ▴" : "More ▾"}
        </button>
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
          {wheres.slice(0, expanded ? 12 : 5).map((w, i) => (
            <span key={i} title={friendlyDate(w.date)}
              style={{ fontSize: 10, padding: "3px 8px", borderRadius: 12, background: "#fff", border: `1px solid ${PALETTE.soft_line}`, color: PALETTE.soft }}>
              {w.isTrip ? "✈ " : ""}{w.where}
            </span>
          ))}
        </div>
      )}

      {/* Most stylish — AI, on demand */}
      <div style={{ marginTop: 14 }}>
        <div style={label}>MOST STYLISH THIS MONTH</div>
        {!stylish && (
          <button onClick={runJudge} disabled={judging}
            style={{ width: "100%", padding: "10px 12px", background: PALETTE.ink, color: PALETTE.cream, border: "none", borderRadius: 8, fontSize: 12, letterSpacing: "0.06em", cursor: judging ? "default" : "pointer" }}>
            {judging ? "Reviewing your month…" : "✦ Show my most stylish looks"}
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

      {/* Everything below is behind "More" to keep Home tidy */}
      {expanded && (
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
                        worn <strong>{wears}×</strong> · {dates.map(d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })).join(", ")}
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

          {/* Rediscover */}
          {rediscover.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={label}>REDISCOVER · resting 60+ days</div>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                {rediscover.map(it => (
                  <button key={it.id} onClick={() => (onStyleItem || onEditItem)?.(it)}
                    style={{ flexShrink: 0, width: 84, padding: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <Img it={it} size={84}/>
                    <div style={{ fontSize: 10, color: PALETTE.soft, marginTop: 3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{it.name}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Challenge */}
          {challenge.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={label}>THIS MONTH'S CHALLENGE</div>
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
