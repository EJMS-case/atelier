// ── HOME — DASHBOARD ─────────────────────────────────────────────────────────
// Replaces the old 7-day-strip landing. The home view is now an insights
// dashboard that pulls in the wear-tracking metrics that used to live in the
// Wear sub-tab of Saved (most-worn, neglected, cost-per-wear) plus a quick
// Style Me CTA and the user's plan for today (if any).

import { useEffect, useMemo, useState } from "react";
import { useRun, RUN_KEYS } from "../../lib/backgroundRun.js";
import { loadShoppingList } from "../shopping/shoppingListStore.js";
import { loadHomeCollapsed, saveHomeCollapsed } from "../../utils/storage.js";
import { flattenPlanItemIds } from "../planner/outfits.js";
import { mostWornItems, neglectedItems, costPerWear, applyWearStats } from "../wear/wearApi.js";
import { nyToday, todayInTz, friendlyDate, addDaysIso } from "../../lib/time.js";
import { fetchClosetForecast } from "../../lib/weather.js";
import LookBackCard from "../recap/LookBackCard.jsx";
// Resurface eligibility — real restyle-worthy garments only (no tees, no
// activewear brands, no comfort-coded pieces, nothing she filed at f≤2).
// Shared with the recap's challenge/alternatives so the lists never drift.
import { isResurfaceCandidate } from "../recap/recapData.js";
import { resolveItemIds, filterByWeather } from "../../utils/item-helpers.js";
import { autoColorPairs, rotateDaily, hexForColorLabel, seasonalBucketForDate } from "../../utils/wardrobe-coverage.js";
import { PALETTE } from "../../constants/palette.js";


export default function HomeView({ items, wardrobe, activeCloset, favorites, apiKey, plans, wearStats, onRefreshWearData, onOpenPlanner, onOpenStyle, onStyleRequest, onEditItem, onStyleItem, brandDiscovery, onOpenDiscovery, onOpenShop, onNavigate }) {
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

  // Today's weather bucket at the ACTIVE CLOSET's location (cached 6h by
  // lib/weather.js; NYC fallback when the closet lacks coords) — the
  // neglected list is only useful if what it surfaces is wearable THIS week,
  // not a wool coat in August. Null until the forecast resolves (or on
  // failure), in which case the list simply isn't season-filtered.
  const [todayBucket, setTodayBucket] = useState(null);
  useEffect(() => {
    let live = true;
    fetchClosetForecast(activeCloset)
      // The forecast map is keyed by the closet's LOCAL dates — look up the
      // closet's "today", not NY's.
      .then(f => { if (live) setTodayBucket(f?.[todayInTz(activeCloset?.timezone)]?.bucket || null); })
      .catch(() => {});
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayIso, activeCloset?.id]);

  // Back in Rotation = restyle-worthy garments only (isResurfaceCandidate: no
  // tees / activewear / lounge / swim, per the owner). Season-aware ALWAYS —
  // live forecast bucket when it resolves, month-based NYC bucket otherwise,
  // so a failed weather fetch can never surface August wool. Date-seeded
  // rotation keeps the surfaced set fresh daily.
  const neglected = useMemo(() => {
    const resting = neglectedItems(wearItems, 60).filter(isResurfaceCandidate);
    const bucket = todayBucket || seasonalBucketForDate();
    return rotateDaily(filterByWeather(resting, bucket), todayIso);
  }, [wearItems, todayBucket, todayIso]);

  // Color Stories — in-fashion color-blocking pairs her closet can make right
  // now (auto-derived, nothing to type), excluding pairs she already keeps by
  // hand in her Style Profile. Tap one → Style Me pre-briefed with the pair.
  // Swatches only — the piece thumbnails kept surfacing items whose photo
  // read as the wrong color and weren't tappable, so the owner asked to drop
  // them (2026-08-20: "omit the icons of clothing and just have the
  // swatches"). Eight stories, and her hand-picked pairs are NOT excluded
  // here anymore — hiding them made favorites like Burgundy + Navy invisible
  // on Home (the exclusion still applies in Style Profile, where it prevents
  // suggesting a pair she already keeps).
  const colorStories = useMemo(() => {
    try {
      return autoColorPairs(items, { max: 8 });
    } catch { return []; }
  }, [items]);
  // Eight stories is a screen of swatches between "Today" and the rest of
  // Home; she asked for them to fold away (2026-09-17: "The colors can be
  // collapsed as well"). Remembered per device.
  const [colorsOpen, setColorsOpen] = useState(() => !loadHomeCollapsed().colorStories);
  const toggleColors = () => setColorsOpen(open => {
    saveHomeCollapsed({ ...loadHomeCollapsed(), colorStories: open });
    return !open;
  });

  // Long AI runs that used to live only inside their screens — a Gap
  // Analysis, the Style Intelligence profile, a Brand Atlas scout — run in
  // lib/backgroundRun.js now, so leaving the screen never loses them. Home
  // shows which are in flight so she can come back for the result.
  const gapRun = useRun(RUN_KEYS.shoppingGap);
  const completeRun = useRun(RUN_KEYS.shoppingComplete);
  const profileRun = useRun(RUN_KEYS.insightsProfile);
  const scoutRun = useRun(RUN_KEYS.brandScout);
  const shopRunning = gapRun.status === "running" || completeRun.status === "running";
  // Her shopping list (features/shopping/shoppingList.js): the row says what
  // is open and what her last closet add answered. Rides the mount-time
  // settings batch (SETTINGS_BATCH_KEYS), so this is no extra request.
  const [shoppingList, setShoppingList] = useState([]);
  useEffect(() => {
    let alive = true;
    loadShoppingList().then(list => { if (alive) setShoppingList(list); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const shopSub = useMemo(() => {
    if (shopRunning) return "Atelier is looking for ideas — it keeps going while you do other things; they wait here.";
    const open = shoppingList.filter(e => e.status === "open");
    const bought = shoppingList.filter(e => e.status === "done" && e.boughtName).sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""))[0];
    if (!open.length && !bought) return "The list you write and check off yourself — every stylist surface reads it, and a closet add checks it off.";
    const parts = [];
    if (open.length) parts.push(`${open.length} on your list${open.length ? ` — ${open.slice(-2).map(e => e.text).join(" · ")}` : ""}`);
    if (bought) parts.push(`${bought.boughtName} answered "${bought.text}"`);
    return parts.join(". ") + ".";
  }, [shoppingList, shopRunning]);

  const itemsWithPrice = useMemo(() => wearItems.filter(it => Number(it.price_paid) > 0), [wearItems]);
  const cpwValues      = useMemo(() => itemsWithPrice.map(costPerWear).filter(v => v !== null), [itemsWithPrice]);
  const avgCpw         = cpwValues.length > 0 ? cpwValues.reduce((a, b) => a + b, 0) / cpwValues.length : null;

  // Every outfit on today's plan, not just the legacy `items` mirror of #0.
  const todayPlanItems = useMemo(
    // A planned day is a COMMITTED set of ids and can hold a piece from the
    // other room, so it resolves against the wardrobe. `items` stays scoped
    // below, where the question really is "what's resting in THIS closet".
    () => resolveItemIds(wardrobe || items, flattenPlanItemIds(todayPlan)),
    [items, todayPlan],
  );

  return (
    <div style={{ padding: "8px 16px 120px" }}>
      {/* Header strip */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, marginTop: 4 }}>
        <h2 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontSize: 22, color: PALETTE.ink, margin: 0 }}>Today</h2>
        <div style={{ fontSize: 10, letterSpacing: "0.06em", color: PALETTE.muted }}>
          {items.length} pieces{neglected.length > 0 && ` · ${neglected.length} resting`}
        </div>
      </div>

      {/* Today's plan or quick Style Me CTA */}
      {todayPlanItems.length > 0 ? (
        <button onClick={onOpenPlanner}
          style={{ width: "100%", textAlign: "left", padding: 14, background: PALETTE.cream, border: `1px solid ${PALETTE.line}`, borderRadius: 10, marginBottom: 16, cursor: "pointer" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.2em", color: PALETTE.muted, marginBottom: 8 }}>
            PLANNED FOR TODAY
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

      {/* Color Stories — in-fashion pairings the closet already supports.
          Auto-derived (autoColorPairs), so she never has to type a color.
          Tap → Style Me pre-briefed to build around the pair. Collapsible. */}
      {colorStories.length > 0 && (
        <section style={sectionStyle}>
          <button onClick={toggleColors} aria-expanded={colorsOpen}
            style={{ ...sectionHeader, display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", marginBottom: colorsOpen ? 10 : 0, textAlign: "left" }}>
            <span>COLOR STORIES · IN FASHION, IN YOUR CLOSET</span>
            <span style={{ fontSize: 10, letterSpacing: 0 }}>{colorsOpen ? "▲" : `▼ ${colorStories.length}`}</span>
          </button>
          {colorsOpen && (<>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {colorStories.map(story => (
              <button key={story.label}
                onClick={() => (onStyleRequest || onOpenStyle)?.(`Color-block ${story.label} — build the look around that pairing`)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff", border: `1px solid ${PALETTE.soft_line}`, borderRadius: 8, cursor: "pointer", textAlign: "left" }}>
                <div style={{ display: "flex", flexShrink: 0 }}>
                  {story.sides.map((side, i) => (
                    <div key={side} style={{
                      width: 26, height: 26, borderRadius: "50%",
                      background: hexForColorLabel(side),
                      border: "1.5px solid #fff",
                      marginLeft: i > 0 ? -8 : 0,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.08)",
                    }}/>
                  ))}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: PALETTE.ink, fontWeight: 500 }}>{story.label}</div>
                  <div style={{ fontSize: 10, color: PALETTE.muted, lineHeight: 1.4, marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{story.note}</div>
                </div>
                <div style={{ fontSize: 11, color: PALETTE.muted, flexShrink: 0 }}>✦</div>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 8 }}>
            Tap a pairing and the stylist builds the look around it.
          </div>
          </>)}
        </section>
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
              const planItems = resolveItemIds(wardrobe || items, plan.items);
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
        <LookBackCard items={wearItems} wardrobe={wardrobe} favorites={favorites || []} apiKey={apiKey}
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

      {/* Back in Rotation — a single compact scroller (the old 12-card grid
          was a multi-screen wall of white at the bottom of Home; the owner
          read it as "a big blank spot"). Season-filtered always, rotated
          daily, restyle-worthy garments only. Tap a piece → Style Me around
          it; that's the whole point of resurfacing it. */}
      {neglected.length > 0 && (
      <section style={sectionStyle}>
        <div style={sectionHeader}>
          BACK IN ROTATION · RESTING 60+ DAYS · {(todayBucket || seasonalBucketForDate()).toUpperCase()}-READY
        </div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          {neglected.slice(0, 10).map(it => (
            <button key={it.id} onClick={() => (onStyleItem || onEditItem)?.(it)}
              title={`Style ${it.name}`}
              style={{ flexShrink: 0, width: 88, padding: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: 88, height: 88, background: "#fff", border: `1px solid ${PALETTE.soft_line}`, borderRadius: 6, overflow: "hidden", position: "relative" }}>
                {it.image && <img src={it.image} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
                <div style={{ position: "absolute", bottom: 3, right: 3, background: PALETTE.ink, color: PALETTE.cream, fontSize: 9, lineHeight: 1, padding: "3px 5px", borderRadius: 8 }}>✦</div>
              </div>
              <div style={{ fontSize: 10, color: PALETTE.soft, marginTop: 3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{it.name}</div>
              <div style={{ fontSize: 9, color: PALETTE.muted }}>{it.last_worn ? `last ${it.last_worn}` : "never worn"}</div>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 6 }}>
          Tap a piece to style it today{neglected.length > 10 ? ` · ${neglected.length - 10} more rotate through daily` : ""}
        </div>
      </section>
      )}

      {/* Your stylist's tools — everything that used to hide under Settings →
          "More tools" and the Style Profile pointer (owner, 2026-09-17: "Can
          that feature, as well as anything that isn't a true 'setting' live
          on the home page with everything else?"). Settings now holds only
          plumbing: account, keys, photo tools, sync. Every row renders from
          local data; the AI work lives behind explicit taps inside each
          screen and keeps running if she leaves it. */}
      {onNavigate && (
        <section style={{ ...sectionStyle, background: "#fff" }}>
          <div style={sectionHeader}>YOUR STYLIST'S FILE &amp; TOOLS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <ToolRow onClick={() => onNavigate("profile")} icon="✦" title="Style Profile"
              sub="Your stylist's read, how you wear things, what reads current, color pairings, About Me & measurements, and the AI Readiness audit."/>
            <ToolRow onClick={() => onNavigate("insights")} icon="✦" title="Style Intelligence" running={profileRun.status === "running"}
              sub={profileRun.status === "running" ? "Writing your monthly profile — it keeps going while you do other things." : "Wear patterns, signature pairs, category balance, and a monthly written profile."}/>
            <ToolRow onClick={() => onNavigate("color")} icon="✦" title="Color Advisor"
              sub="Analyze a piece against your Dark Winter coloring, or audit the whole closet."/>
            <ToolRow onClick={() => onNavigate("visionpilot")} icon="✦" title="Visual AI"
              sub="Reads sleeves, fabrics and formality off your photos so the stylist styles what is actually there."/>
          </div>
        </section>
      )}

      {/* Shop Smarter — Brand Atlas + her Shopping List, at the BOTTOM of Home
          (owner request 2026-08-20: dressing sections first, shopping last). */}
      {(onOpenDiscovery || onOpenShop) && (
        <section style={{ ...sectionStyle, background: "#fff" }}>
          <div style={sectionHeader}>SHOP SMARTER</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {onOpenDiscovery && (
              <ToolRow onClick={onOpenDiscovery} icon="✧" title="Brand Atlas" running={scoutRun.status === "running"}
                sub={scoutRun.status === "running" ? "Scouting the fashion world — it keeps going while you do other things." : brandDiscovery?.brands?.length
                  ? `${brandDiscovery.brands.slice(0, 3).map(b => b.name).join(" · ")} — and more, scouted for you`
                  : "Lesser-known, international labels scouted live against your closet."}/>
            )}
            {onOpenShop && (
              <ToolRow onClick={onOpenShop} icon="◇" title="Shopping List" running={shopRunning} sub={shopSub}/>
            )}
          </div>
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

// One tappable row in a tools section. `running` shows the same pulsing dot
// the nav uses for a Style Me in flight.
function ToolRow({ onClick, icon, title, sub, running = false }) {
  return (
    <button onClick={onClick}
      style={{ width: "100%", textAlign: "left", padding: "9px 11px", background: PALETTE.cream, border: `1px solid ${PALETTE.soft_line}`, borderRadius: 8, cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 12, color: PALETTE.ink, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
          {icon} {title}
          {running && (
            <span title="Running in the background" style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--color-accent)", animation: "pulse 1.4s ease-in-out infinite" }}/>
          )}
        </div>
        <div style={{ fontSize: 11, color: PALETTE.muted }}>›</div>
      </div>
      <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 3, lineHeight: 1.4 }}>{sub}</div>
    </button>
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
