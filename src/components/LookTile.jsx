// ── LOOK TILE — a worn look, as an outfit, that opens the whole canvas ───────
// The small composed collage Home's "Most stylish" picks and a garment's "In
// Your Looks" rows draw (owner, 2026-10-04: "I want to actually see the
// outfit that was stylish all together as an outfit. I want to click it and
// see the whole canvas, not the individual piece"). One tap opens the day in
// the Planner (or the look under Saved), where every piece is its own tap.
// Her saved arrangement when the row has one, the portrait recipe otherwise;
// every piece from its thumb (`tile`); one pair of shoes (`oneShoe`).

import EditorialCollage from "./EditorialCollage.jsx";
import { oneShoe } from "./collageLayout.js";
import { PALETTE } from "../constants/palette.js";

export default function LookTile({ items, layout = null, onOpen, label, width = 96 }) {
  const shown = oneShoe(items);
  const box = {
    position: "relative", width, aspectRatio: "3 / 4", flexShrink: 0,
    background: "#fff", border: `1px solid ${PALETTE.soft_line}`, borderRadius: 6, overflow: "hidden",
  };
  const collage = <EditorialCollage lookItems={shown} layoutOverride={layout} tile/>;
  if (!onOpen) return <div style={box}>{collage}</div>;
  return (
    <button type="button" onClick={onOpen} aria-label={label || "Open this look"}
      style={{ ...box, padding: 0, cursor: "pointer", display: "block" }}>
      {collage}
    </button>
  );
}
