// ── REQUEST READ-BACK ────────────────────────────────────────────────────────
// The line under Style Me's "Anything specific?" box: which of her pieces the
// request resolves to, from the same reader the sampler force-includes with
// (resolveRequestedPieces), so it is the truth, not a paraphrase. One piece
// is the anchor. Several — two Theory dresses, two "Ponte Knit Pant" — show
// as chips labelled apart by colour; a tap rewrites the request to that
// piece's own line (requestForPiece), which every reader takes as exactly it.
// Nothing resolved: the theme note.

import { distinguishingLabel } from "../../utils/free-text-match.js";

const hint = { fontSize: 10, color: "var(--color-text-muted)", marginTop: -4, marginBottom: 8, fontStyle: "italic" };

export default function RequestReadBack({ read, onPick, chipStyle }) {
  const pieces = read?.pieces || [];
  if (pieces.length === 0) {
    return <div style={hint}>✦ Applied as the theme for every look you generate. Name a piece to build around it.</div>;
  }
  if (pieces.length === 1) {
    return <div style={hint}>✦ Building around <b>{pieces[0].name}</b>.</div>;
  }
  const shown = pieces.slice(0, 6);
  return (
    <div style={hint}>
      <div>✦ Atelier reads this as {pieces.length} pieces — tap the one you mean, or leave it and they take turns:</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
        {shown.map(p => (
          <button key={p.id} type="button" onClick={() => onPick(p)}
            style={{ ...chipStyle, fontSize: 11, padding: "5px 11px", fontStyle: "normal" }}>
            {distinguishingLabel(p, pieces)}
          </button>
        ))}
        {pieces.length > shown.length && <span style={{ alignSelf: "center" }}>+{pieces.length - shown.length} more</span>}
      </div>
    </div>
  );
}
