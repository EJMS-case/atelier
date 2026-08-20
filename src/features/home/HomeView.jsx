// ── HOME — DASHBOARD ─────────────────────────────────────────────────────────
// Replaces the old 7-day-strip landing. The home view is now an insights
// dashboard that pulls in the wear-tracking metrics that used to live in the
// Wear sub-tab of Saved (most-worn, neglected, cost-per-wear) plus a quick
// Style Me CTA and the user's plan for today (if any).

import { useEffect, useMemo, useState } from "react";
import { flattenPlanItemIds } from "../planner/outfits.js";
import { mostWornItems, neglectedItems, costPerWear, applyWearStats } from "../wear/wearApi.js";
import { nyToday, friendlyDate, addDaysIso } from "../../lib/time.js";
import { fetchNycForecast } from "../../lib/weather.js";
import LookBackCard from "../recap/LookBackCard.jsx";
// Categories the "Neglected" list surfaces — real garments only (no
// accessories/belts/shoes/bags, no swim/lounge/athleisure). Shared with the
// recap's rediscover/challenge nudges so the two lists never drift.
import { GARMENT_CATS as NEGLECT_CATS } from "../recap/recapData.js";
import { resolveItemIds, filterByWeather } from "../../utils/item-helpers.js";
import { autoColorPairs, rotateDaily, hexForColorLabel } from "../../utils/wardrobe-coverage.js";
import { loadStylePrefs } from "../../utils/storage.js";
import { PALETTE } from "../../constants/palette.js";


export default function HomeView({ items, favorites, apiKey, plans, wearStats, onRefreshWearData, onOpenPlanner, onOpenStyle, onStyleRequest, onEditItem, onStyleItem, onOpenProfile, styleFingerprint, brandDiscovery, onOpenDiscovery }) {
  // Anchor to NYC time like the rest of the app — `toISOString()` is UTC
  // which flips the date forward in the evening for users west of UTC.
  const todayIso = nyToday();
  // Show the next 14 days; render the first 5 non-empty ones as "Coming up".
  const horizonIso = addDaysIso(todayIso, 14);

  // Plans + wear stats are fetched once by App (shared with the stylist and
  // LookBackCard) and passed down. Ask for a refresh on every Home visit so
  // the dashboard reflects outfits logged / plans saved since the last fetch —
  // the same per-mount refetch semantics this view had when it fetched itself.
  // Swallow rejections: the refresh is best-effort (the view just keeps the
  // stats it already has), and an unhandled rejection would surface in console.
  useEffect(() => { onRefreshWearData?.()?.catch?.(() => {}); }, [onRefreshWearData]);

  // Today + "Coming up" derive from the shared planner rows. fetchAllPlans and
  // fetchPlansBetween return the same select=*, date-ascending rows, so the
  // client-side date-window filter matches the old scoped fetch exactly.
  const { todayPlan, upcomingPlans } = useMemo(() => {
    const list = (Array.isArray(plans) ? plans : []).filter(r => r.date >= todayIso && r.date <= horizonIso);
    return {
      todayPlan: list.find(r => r.date === todayIso) || null,
      upcomingPlans: list
        // flattenPlanItemIds reads every outfit on the day — a multi-
        // outfit day whose legacy `items` mirror is empty still counts.
        .filter(r => r.date > todayIso && flattenPlanItemIds(r).length > 0)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 5),
    };
  }, [plans, todayIso, horizonIso]);

  // Real wear stats come from the calendar (planned_outfits) + legacy worn logs,
  // NOT the stored wear_count/last_worn cache (which froze when the user moved to
  // the calendar). Overlay the derived truth onto items so every metric below —
  // and the Look-Back card — reads accurate wears.
  const wearItems = useMemo(() => applyWearStats(items, wearStats || {}), [items, wearStats]);

  const topWorn   = useMemo(() => mostWornItems(wearItems, 5), [wearItems]);

  // Today's NYC weather bucket (cached 6h by lib/weather.js) — the neglected
  // list is only useful if what it surfaces is wearable THIS week, not a wool
  // coat in August. Null until the forecast resolves (or on failure), in which
  // case the list simply isn't season-filtered.
  const [todayBucket, setTodayBucket] = useState(null);
  useEffect(() => {
    let live = true;
    fetchNycForecast()
      .then(f => { if (live) setTodayBucket(f?.[todayIso]?.bucket || null); })
      .catch(() => {});
    return () => { live = false; };
  }, [todayIso]);

  // Neglected = real garments only. Accessories, belts, shoes, bags repeat by
  // design, and swim / lounge / athleisure aren't "rediscover" pieces — she
  // doesn't want any of those cluttering the list (belts were dominating it).
  // Season-aware (filterByWeather on today's bucket) so August never nags her
  // about resting wool, and date-seeded rotation so the surfaced dozen changes
  // every day instead of pinning the same 12 pieces for weeks.
  const neglected = useMemo(() => {
    const resting = neglectedItems(wearItems, 60).filter(it => NEGLECT_CATS.has(it.category));
    const inSeason = todayBucket ? filterByWeather(resting, todayBucket) : resting;
    return rotateDaily(inSeason, todayIso);
  }, [wearItems, todayBucket, todayIso]);

  // Color Stories — in-fashion color-blocking pairs her closet can make right
  // now (auto-derived, nothing to type), excluding pairs she already keeps by
  // hand in her Style Profile. Tap one → Style Me pre-briefed with the pair.
  const colorStories = useMemo(() => {
    try {
      return autoColorPairs(items, { exclude: loadStylePrefs()?.colorPairs || [], max: 3 });
    } catch { return []; }
  }, [items]);

  const itemsWithPrice = useMemo(() => wearItems.filter(it => Number(it.price_paid) > 0), [wearItems]);
  const cpwValues      = useMemo(() => itemsWithPrice.map(costPerWear).filter(v => v !== null), [itemsWithPrice]);
  const avgCpw         = cpwValues.length > 0 ? cpwValues.reduce((a, b) => a + b, 0) / cpwValues.length : null;

  // Every outfit on today's plan, not just the legacy `items` mirror of #0.
  const todayPlanItems = useMemo(
    () => resolveItemIds(items, flattenPlanItemIds(todayPlan)),
    [items, todayPlan],
  );

  return (
    <div style={{ padding: "8px 16px 120px" }}>
      {/* Header strip */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, marginTop: 4 }}>
        <h2 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 22, color: PALETTE.ink, margin: 0 }}>Today</h2>
        <div style={{ fontSize: 10, letterSpacing: "0.06em", color: PALETTE.muted }}>
          {items.length} pieces{neglected.length > 0 && ` · ${neglected.length} neglected`}
        </div>
      </div>

      {/* Today's plan or quick Style Me CTA */}
      {todayPlanItems.length > 0 ? (
        <button onClick={onOpenPlanner}
          style={{ width: "100%", textAlign: "left", padding: 14, background: PALETTE.cream, border: `1px solid ${PALETTE.line}`, borderRadius: 10, marginBottom: 16, cursor: "pointer" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.2em", color: PALETTE.muted, marginBottom: 8 }}>
            PLANNED FOR TODAY · {friendlyDate(todayIso)}
          </div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {todayPlanItems.slice(0, 6).map(it => (
              <div key={it.id} style={{ flexShrink: 0, width: 56, height: 56, background: "#fff", border: `1px solid ${PALETTE.soft_line}`, borderRadius: 4, overflow: "hidden" }}>
                {it.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
              </div>
            ))}
          </div>
        </button>
      ) : (
        <button onClick={onOpenStyle}
          style={{ width: "100%", padding: "14px 16px", background: PALETTE.ink, color: PALETTE.cream, border: "none", borderRadius: 10, marginBottom: 16, fontSize: 13, letterSpacing: "0.08em", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
          ✦ Style me for today
        </button>
      )}

      {/* Style Profile entry — her stylist's file (fingerprint, color
          pairings, About Me), moved out of Settings (roadmap B; placement
          "Inside Home" chosen by the owner 2026-08-19). One-line teaser from
          the fingerprint when it exists. */}
      {onOpenProfile && (
        <button onClick={onOpenProfile}
          style={{ width: "100%", textAlign: "left", padding: "12px 14px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 10, marginBottom: 16, cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.2em", color: PALETTE.muted }}>✦ YOUR STYLE PROFILE</div>
            <div style={{ fontSize: 11, color: PALETTE.muted }}>›</div>
          </div>
          <div style={{ fontSize: 12, color: PALETTE.soft, marginTop: 6, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {styleFingerprint?.text
              ? styleFingerprint.text
              : "Your stylist's read on you — fingerprint, color pairings, and fit notes."}
          </div>
        </button>
      )}

      {/* Color Stories — in-fashion pairings the closet already supports.
          Auto-derived (autoColorPairs), so she never has to type a color.
          Tap → Style Me pre-briefed to build around the pair. */}
      {colorStories.length > 0 && (
        <section style={sectionStyle}>
          <div style={sectionHeader}>COLOR STORIES · IN FASHION, IN YOUR CLOSET</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {colorStories.map(story => (
              <button key={story.label}
                onClick={() => (onStyleRequest || onOpenStyle)?.(`Color-block ${story.label} — build the look around that pairing`)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", border: `1px solid ${PALETTE.soft_line}`, borderRadius: 8, cursor: "pointer", textAlign: "left" }}>
                <div style={{ display: "flex", flexShrink: 0 }}>
                  {story.sides.map((side, i) => (
                    <div key={side} style={{
                      width: 22, height: 22, borderRadius: "50%",
                      background: hexForColorLabel(side),
                      border: "1.5px solid #fff",
                      marginLeft: i > 0 ? -7 : 0,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.06)",
                    }}/>
                  ))}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: PALETTE.ink, fontWeight: 500 }}>{story.label}</div>
                  <div style={{ fontSize: 10, color: PALETTE.muted, lineHeight: 1.4, marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{story.note}</div>
                </div>
                <div style={{ fontSize: 11, color: PALETTE.muted }}>✦</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Brand Atlas entry — renders ONLY the cached scouting result (zero AI
          calls, zero network on Home). The heavy work — a web-search-backed
          scouting run — lives behind an explicit tap inside the view. */}
      {onOpenDiscovery && (
        <button onClick={onOpenDiscovery}
          style={{ width: "100%", textAlign: "left", padding: "12px 14px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 10, marginBottom: 16, cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.2em", color: PALETTE.muted }}>✧ BRAND ATLAS</div>
            <div style={{ fontSize: 11, color: PALETTE.muted }}>›</div>
          </div>
          <div style={{ fontSize: 12, color: PALETTE.soft, marginTop: 6, lineHeight: 1.45 }}>
            {brandDiscovery?.brands?.length
              ? `${brandDiscovery.brands.slice(0, 3).map(b => b.name).join(" · ")} — and more, scouted for you`
              : "Lesser-known, international labels scouted live against your closet."}
          </div>
        </button>
      )}

      {/* Coming Up — next planned days within the 2-week horizon. Pinned near
          the top (above the recap) since it's the most forward-looking, act-on-
          it-now section. Tap to jump straight into the planner on that date.
          Hidden when nothing's planned to avoid an empty section. */}
      {upcomingPlans.length > 0 && (
        <section style={sectionStyle}>
          <div style={sectionHeader}>COMING UP</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {upcomingPlans.map(plan => {
              const planItems = resolveItemIds(items, plan.items);
              const tag = plan.day_label || plan.occasion || "";
              return (
                <button key={plan.date} onClick={onOpenPlanner}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", border: `1px solid ${PALETTE.soft_line}`, borderRadius: 8, cursor: "pointer", textAlign: "left" }}>
                  <div style={{ minWidth: 70 }}>
                    <div style={{ fontSize: 11, color: PALETTE.ink, fontWeight: 500 }}>{friendlyDate(plan.date)}</div>
                    {tag && <div style={{ fontSize: 9, letterSpacing: "0.04em", color: PALETTE.muted, marginTop: 2 }}>{tag}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 4, overflow: "hidden", flex: 1 }}>
                    {planItems.slice(0, 5).map(it => (
                      <div key={it.id} style={{ flexShrink: 0, width: 40, height: 40, background: PALETTE.cream, border: `1px solid ${PALETTE.soft_line}`, borderRadius: 3, overflow: "hidden" }}>
                        {it.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Monthly look-back — recap of the last 30 days (worn diary + AI picks
          + leaned-on pieces + forward nudges). Reads its 30-day window out of
          the shared planner rows passed down from App. */}
      {items.length > 0 && (
        <LookBackCard items={wearItems} favorites={favorites || []} apiKey={apiKey}
          plans={plans} onEditItem={onEditItem} onStyleItem={onStyleItem}/>
      )}

      {/* Most-worn metric */}
      {topWorn.length > 0 && (
        <section style={sectionStyle}>
          <div style={sectionHeader}>MOST WORN</div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {topWorn.map((it, i) => (
              <button key={it.id} onClick={() => onEditItem?.(it)}
                style={{ flexShrink: 0, width: 96, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                <div style={{ position: "relative", aspectRatio: "1", background: PALETTE.cream, borderRadius: 6, overflow: "hidden", border: `1px solid ${PALETTE.soft_line}` }}>
                  {it.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                  <div style={{ position: "absolute", top: 4, left: 4, background: PALETTE.ink, color: PALETTE.cream, fontSize: 9, padding: "2px 6px", borderRadius: 10 }}>#{i + 1}</div>
                </div>
                <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 4 }}>{it.wear_count} wear{it.wear_count === 1 ? "" : "s"}</div>
                <div style={{ fontSize: 11, color: PALETTE.soft, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{it.name}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Cost-per-wear */}
      {avgCpw !== null && (
        <section style={sectionStyle}>
          <div style={sectionHeader}>COST PER WEAR</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 22, fontFamily: "serif", color: PALETTE.ink }}>${avgCpw.toFixed(2)}</div>
            <div style={{ fontSize: 10, color: PALETTE.muted, textAlign: "right" }}>average across<br/>{itemsWithPrice.length} priced piece{itemsWithPrice.length === 1 ? "" : "s"}</div>
          </div>
          <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 6 }}>
            Add a purchase price in Edit Item to track more pieces here.
          </div>
        </section>
      )}

      {/* Neglected pieces — season-filtered (only what's wearable in today's
          weather) and rotated daily so the same 12 don't pin here for weeks.
          The whole section disappears when there's nothing to say — an empty
          gray box was just a gap on the page. */}
      {neglected.length > 0 && (
      <section style={sectionStyle}>
        <div style={sectionHeader}>
          BACK IN ROTATION · RESTING 60+ DAYS{todayBucket ? ` · ${todayBucket.toUpperCase()}-READY` : ""}
        </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 10 }}>
            {neglected.slice(0, 12).map(it => {
              const cpw = costPerWear(it);
              return (
                <div key={it.id} style={{ background: "#fff", border: `1px solid ${PALETTE.soft_line}`, borderRadius: 6, padding: 6 }}>
                  <button onClick={() => onEditItem?.(it)}
                    style={{ width: "100%", padding: 0, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ aspectRatio: "1", background: PALETTE.cream, borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
                      {it.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                    </div>
                    <div style={{ fontSize: 10, color: PALETTE.soft, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", marginBottom: 2 }}>{it.name}</div>
                    <div style={{ fontSize: 9, color: PALETTE.muted, marginBottom: 6 }}>
                      {it.last_worn ? `last ${it.last_worn}` : "never worn"}
                      {cpw !== null ? ` · $${cpw.toFixed(2)}/wear` : ""}
                    </div>
                  </button>
                  {onStyleItem && (
                    <button onClick={() => onStyleItem(it)}
                      style={{ width: "100%", fontSize: 10, padding: "4px 6px", background: PALETTE.ink, color: PALETTE.cream, border: "none", borderRadius: 4, cursor: "pointer", letterSpacing: "0.05em" }}>
                      ✦ Style this
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        {neglected.length > 12 && (
          <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 8, textAlign: "right" }}>
            and {neglected.length - 12} more — a fresh dozen rotates in daily
          </div>
        )}
      </section>
      )}

      {/* First-wear nudge — replaces the old always-rendered empty Neglected
          box (it read as a big blank gap on the page). */}
      {items.length > 0 && topWorn.length === 0 && (
        <div style={{ ...emptyStyle, padding: "4px 2px 12px" }}>
          Log a couple of outfits as worn and your top pieces + resting list will populate here.
        </div>
      )}

      {/* Empty state for brand-new closets */}
      {topWorn.length === 0 && neglected.length === 0 && items.length === 0 && (
        <div style={{ marginTop: 20, padding: 20, background: PALETTE.cream, borderRadius: 10, textAlign: "center" }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>✦</div>
          <div style={{ fontSize: 13, color: PALETTE.soft, lineHeight: 1.5 }}>
            Your closet is empty. Start by uploading a few pieces under <em>Closet</em>, then come back here to see what you wear most.
          </div>
        </div>
      )}
    </div>
  );
}

const sectionStyle = {
  background: PALETTE.cream,
  border: `1px solid ${PALETTE.soft_line}`,
  borderRadius: 10,
  padding: 14,
  marginBottom: 14,
};

const sectionHeader = {
  fontSize: 9,
  letterSpacing: "0.2em",
  color: PALETTE.muted,
  marginBottom: 10,
};

const emptyStyle = {
  fontSize: 12,
  color: PALETTE.muted,
  padding: "8px 0",
  lineHeight: 1.5,
};
