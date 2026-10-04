import { useEffect, useState } from "react";
import { s } from "../ui/styles.js";
import { sortByCategoryOrder } from "../utils/item-helpers.js";
import TrimmedImage from "./TrimmedImage.jsx";
import { buildCollageLayout, buildFromLayout } from "./collageLayout.js";

// Mobile gets a portrait canvas (4:5 recipes; manual layouts render at the
// builder's 3:4 — see the override logic below) and its own
// layout recipes that mimic Pinterest flat-lays — large hero garment, bag
// overlapping a hip, shoes grounding the bottom. Desktop keeps the wider
// landscape composition that already works there.
//
// ONE matchMedia + ONE native listener for the whole app: the calendar grid
// renders 42 collages at once, and the per-instance version created 42
// matchMedia objects and listeners. Instances subscribe to this shared store.
const MOBILE_QUERY = "(max-width: 480px)";
const mqSubscribers = new Set();
let sharedMq = null;
function ensureSharedMq() {
  if (sharedMq || typeof window === "undefined") return;
  sharedMq = window.matchMedia(MOBILE_QUERY);
  sharedMq.addEventListener?.("change", (e) => {
    mqSubscribers.forEach(fn => fn(e.matches));
  });
}

function useIsMobileCollage() {
  ensureSharedMq();
  const [isMobile, setIsMobile] = useState(() => (sharedMq ? sharedMq.matches : false));
  useEffect(() => {
    mqSubscribers.add(setIsMobile);
    // Re-sync in case the viewport changed between render and subscribe.
    if (sharedMq) setIsMobile(sharedMq.matches);
    return () => { mqSubscribers.delete(setIsMobile); };
  }, []);
  return isMobile;
}


// Positions pieces as floating, slightly overlapping items on a clean background
// Layout: clothing anchored left/center, shoes bottom-left, bag bottom-right, accessories scattered
//
// `compact` switches to a tight flex grid — items sized equally, no recipes,
// no white-space gaps. Use for tiny canvases (calendar tiles) and for views
// where the user wants pieces grouped tightly rather than scattered across
// a tall portrait canvas.
export default function EditorialCollage({ lookItems, onItemClick, canvasStyle, layoutOverride, compact = false }) {
  const isMobile = useIsMobileCollage();
  const sorted = sortByCategoryOrder(lookItems);

  if (compact) {
    const visible = sorted.slice(0, 6);
    // A tile shows six at most; past that it SAYS how many more rather than
    // dropping them silently (the planner cell is the only place a look of
    // seven reads as a look of six).
    const hidden = sorted.length - visible.length;
    // Cell scaling: 1 → 1 col, 2 → 2 cols, 3-4 → 2 cols, 5-6 → 3 cols. Keeps
    // each thumb roughly square at common canvas widths.
    const cols = visible.length <= 1 ? 1 : visible.length <= 4 ? 2 : 3;
    return (
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 2,
        padding: 2,
        width: "100%",
        position: "relative",
        ...canvasStyle,
      }}>
        {hidden > 0 && (
          <span style={{ position: "absolute", right: 2, bottom: 2, zIndex: 1, background: "rgba(28,24,20,0.82)", color: "#fff", borderRadius: 6, padding: "0 4px", fontSize: 8, fontWeight: 600, lineHeight: 1.5 }}>
            +{hidden}
          </span>
        )}
        {visible.map((it, i) => (
          <div key={it.id || i}
            onClick={onItemClick ? () => onItemClick(it) : undefined}
            style={{
              aspectRatio: "1",
              background: "#fff",
              borderRadius: 2,
              overflow: "hidden",
              cursor: onItemClick ? "pointer" : "default",
            }}>
            {it.image ? (
              <TrimmedImage item={it} alt={it.name}
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}/>
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#888" }}>
                {it.category?.[0] || "?"}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // MANUAL layouts (from SilhouetteBuilder) are honored on EVERY viewport.
  // This used to be desktop-only ("override coords look scattered re-projected
  // onto a portrait canvas"), but that had it backwards for the owner's data:
  // she builds on her PHONE, on the builder's portrait 3:4 canvas — so the
  // mobile review was discarding hand-made arrangements that were authored
  // portrait in the first place, and the planner showed an auto-collage
  // instead of what she built (owner report 2026-08-05, "collages aren't
  // saving correctly"). The stored rows were fine all along; only this render
  // branch dropped them.
  //
  // Discriminator: builder layouts stamp a z on every entry (buildLayoutData);
  // the AI LooksTool schema has no z. AI layouts keep their old behavior —
  // honored on desktop, recipe on mobile — so this fix can't restyle every
  // saved Style Me look on the phone as a side effect.
  // A manual override renders on the builder's own 3:4 aspect so the percent
  // coords re-project 1:1; recipe layouts keep the 4:5 canvas they were
  // designed for. Desktop behavior unchanged.
  const hasOverride = Array.isArray(layoutOverride) && layoutOverride.length > 0;
  const isManualLayout = hasOverride && layoutOverride.every(e => e && e.z != null);
  const useOverride = hasOverride && (!isMobile || isManualLayout);
  const slots = useOverride
    ? buildFromLayout(sorted, layoutOverride, isMobile)
    : buildCollageLayout(sorted, isMobile);

  const mobileCanvas = isMobile ? { paddingBottom: useOverride ? "133.33%" : "125%" } : null;

  return (
    <div style={{ ...s.collageCanvas, ...mobileCanvas, ...canvasStyle }}>
      {slots.map((slot, i) => (
        <div key={slot.id || i}
          onClick={onItemClick ? () => onItemClick(slot) : undefined}
          style={{
            position: "absolute",
            left: `${slot.x}%`,
            top: `${slot.y}%`,
            width: `${slot.w}%`,
            height: `${slot.h}%`,
            transform: `rotate(${slot.rotate}deg)`,
            zIndex: slot.zIndex,
            // No drop-shadow — references show clean flat-lay, items just
            // sit on white. Shadow read as juvenile / sticker-like.
            cursor: onItemClick ? "pointer" : "default",
          }}>
          {slot.image ? (
            // TrimmedImage crops the transparent border first, so the piece
            // fills the slot tightly instead of floating in empty space. Big
            // visual win for Style Me looks where the slot is small and the
            // PNG's transparent halo would otherwise dominate.
            <TrimmedImage src={slot.image} alt={slot.name}
              style={{width:"100%", height:"100%", objectFit:"contain", objectPosition:"center top", display:"block"}}/>
          ) : (
            <div style={{...s.collagePh, height:"100%"}}>
              <span style={s.collageCat}>{slot.category?.[0]}</span>
              <span style={s.collageName}>{slot.name}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
