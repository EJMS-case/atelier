// ── ITEM WEAR HISTORY — "worn with this piece" ───────────────────────────────
// Read-only card inside EditItemView (owner request 2026-08-19): tapping a
// garment in the closet shows the outfits it was already worn in — dated,
// newest first, with a days-ago readout so she can judge repeat spacing —
// plus upcoming planner pins that feature it and the saved looks built
// around it. Pure data view over state App already holds (wearData.logs /
// wearData.plans): zero AI calls, zero new fetches, no schema changes.
//
// Worn = dated outfit_logs + past/today planner pins (deduped by
// date+item-set signature, mirroring OutfitHistory's merge). Future planner
// pins surface too, flagged PLANNED — "you're already wearing this Friday"
// is exactly the don't-repeat signal she asked for.

import { useMemo, useState } from "react";
import { s, ss } from "../ui/styles.js";
import { resolveItemIds, sortByCategoryOrder } from "../utils/item-helpers.js";
import { outfitsOf, sigOf } from "../features/planner/outfits.js";
import { tagsFor, joinTags } from "../lib/multitag.js";
import { nyToday, friendlyDate } from "../lib/time.js";

const PREVIEW_ROWS = 4;
const MAX_THUMBS = 5;

// Whole days between an iso date and today (positive = past). Same noon-UTC
// anchoring as time.js's friendlyDate so travel timezones can't shift it.
function daysSince(iso, today) {
  const d = new Date(iso + "T12:00:00Z");
  const now = new Date(today + "T12:00:00Z");
  return Math.round((now - d) / 86400000);
}

function agoLabel(iso, today) {
  const days = daysSince(iso, today);
  if (days <= 0) return null; // today/future — friendlyDate already says it
  if (days === 1) return "1 day ago";
  if (days < 60) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
}

// One outfit row: date/label line + a strip of the OTHER pieces in the look.
function OutfitRow({ entry, item, allItems, today }) {
  const companions = sortByCategoryOrder(
    resolveItemIds(allItems, entry.ids).filter(it => it.id !== item.id)
  );
  const shown = companions.slice(0, MAX_THUMBS);
  const extra = companions.length - shown.length;
  const occText = joinTags(tagsFor(entry, "occasions", "occasion"));
  const future = entry.date && entry.date > today;
  const ago = entry.date && !future ? agoLabel(entry.date, today) : null;

  return (
    <div style={{ padding: "8px 0", borderTop: "1px solid var(--color-border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        {entry.date ? (
          <span style={{ fontSize: 12, fontWeight: 600 }}>{friendlyDate(entry.date)}</span>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            Saved look{entry.created ? ` · ${friendlyDate(String(entry.created).slice(0, 10))}` : ""}
          </span>
        )}
        {future && (
          <span style={{ fontSize: 9, letterSpacing: "0.1em", padding: "1px 6px", borderRadius: 3, border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}>
            PLANNED
          </span>
        )}
        {ago && <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>· {ago}</span>}
        {occText && <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>· {occText}</span>}
      </div>
      {shown.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {shown.map(it => it.image ? (
            <img key={it.id} src={it.image} alt={it.name} title={it.name} loading="lazy"
              style={{ ...ss.modalItemThumb, background: "#fff" }} />
          ) : (
            <div key={it.id} title={it.name}
              style={{ ...ss.modalItemThumb, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "var(--color-text-muted)", textAlign: "center", overflow: "hidden", padding: 2 }}>
              {it.name}
            </div>
          ))}
          {extra > 0 && <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>+{extra}</span>}
        </div>
      )}
    </div>
  );
}

function Section({ label, entries, item, allItems, today }) {
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) return null;
  const shown = expanded ? entries : entries.slice(0, PREVIEW_ROWS);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--color-text-muted)", marginBottom: 2 }}>
        {label} · {entries.length}
      </div>
      {shown.map(e => <OutfitRow key={e.key} entry={e} item={item} allItems={allItems} today={today} />)}
      {entries.length > PREVIEW_ROWS && (
        <button onClick={() => setExpanded(x => !x)}
          style={{ background: "none", border: "none", padding: "6px 0 0", fontSize: 11, color: "var(--color-text-muted)", textDecoration: "underline", cursor: "pointer" }}>
          {expanded ? "Show fewer" : `Show all ${entries.length}`}
        </button>
      )}
    </div>
  );
}

export default function ItemWearHistory({ item, allItems, logs, plans }) {
  const today = nyToday();

  const { worn, saved } = useMemo(() => {
    const inLook = (ids) => (ids || []).map(String).includes(String(item.id));

    // Dated logs featuring the piece.
    const wornLogs = (logs || [])
      .filter(l => l.date_worn && inLook(l.garment_ids))
      .map(l => ({ key: `log:${l.id}`, date: l.date_worn, ids: l.garment_ids, occasion: l.occasion, occasions: l.occasions }));

    // Planner pins featuring the piece (past AND future), deduped against
    // logs by date + item-set signature — a pin and its log are one wear.
    const logSigs = new Set(wornLogs.map(e => `${e.date}|${sigOf(e.ids)}`));
    const planEntries = [];
    (plans || []).forEach(p => {
      const date = (p.date || "").slice(0, 10);
      if (!date) return;
      outfitsOf(p).forEach((o, idx) => {
        if (!inLook(o.items)) return;
        if (logSigs.has(`${date}|${sigOf(o.items)}`)) return;
        planEntries.push({ key: `plan:${p.id || date}:${idx}`, date, ids: o.items, occasion: o.occasion, occasions: null });
      });
    });

    // Desc by date: upcoming pins naturally lead, then most recent wears.
    const worn = [...wornLogs, ...planEntries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    // Undated logs = her saved looks (LooksView semantics), newest first.
    const saved = (logs || [])
      .filter(l => !l.date_worn && inLook(l.garment_ids))
      .map(l => ({ key: `look:${l.id}`, date: null, created: l.created_at, ids: l.garment_ids, occasion: l.occasion, occasions: l.occasions }))
      .sort((a, b) => ((a.created || "") < (b.created || "") ? 1 : -1));

    return { worn, saved };
  }, [item.id, logs, plans]);

  if (worn.length === 0 && saved.length === 0) return null;

  const pastWears = worn.filter(e => e.date <= today);
  const wearDays = new Set(pastWears.map(e => e.date));
  const lastWorn = pastWears[0]?.date;

  return (
    <div style={s.settingsCard}>
      <div style={s.settingsTitle}>In Your Looks</div>
      <p style={s.settingsSub}>
        {wearDays.size > 0
          ? <>Worn <strong>{wearDays.size}</strong> day{wearDays.size !== 1 ? "s" : ""}{lastWorn ? <> · last {friendlyDate(lastWorn)}{agoLabel(lastWorn, today) ? ` (${agoLabel(lastWorn, today)})` : ""}</> : null}.</>
          : "Not worn yet — it appears in your saved looks below."}
      </p>
      <Section label="WORN & PLANNED" entries={worn} item={item} allItems={allItems} today={today} />
      <Section label="SAVED LOOKS" entries={saved} item={item} allItems={allItems} today={today} />
    </div>
  );
}
