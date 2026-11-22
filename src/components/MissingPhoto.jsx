// A tile whose piece's photo cannot be loaded at all: an old photo host
// dropped it (the Black cardigan Top, 2026-11-22). The piece's name in words,
// never the browser's broken "?". Thumb and TrimmedImage both fall back here.

/** What a tile shows when a piece's photo can't be loaded at all. */
export default function MissingPhoto({ alt, style }) {
  return (
    <span role="img" aria-label={`${alt || "Piece"}: photo missing`} title={`${alt || "This piece"}: the photo is missing. Add a new one in Edit.`}
      style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 8, lineHeight: 1.2, color: "var(--color-text-muted)", background: "var(--color-bg)", overflow: "hidden", padding: 2, boxSizing: "border-box" }}>
      {alt ? `${String(alt).split(" ").slice(0, 3).join(" ")} · no photo` : "no photo"}
    </span>
  );
}

