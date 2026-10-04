import { s } from "../ui/styles.js";

// The one "Show more" row under a paged list (Saved → All, History). A page
// of twelve look cards is ~60 photos; her 150 saved looks painted all at once
// was ~750 photo decodes before the first card could be read (2026-10-04,
// "a little hard to review"). The button says what is left so the list never
// reads as short.
export const LOOKS_PAGE = 12;

export default function ShowMore({ total, shown, onMore, noun = "looks" }) {
  const left = total - shown;
  if (left <= 0) return null;
  return (
    <button onClick={onMore} style={{ ...s.btnSecondary, width: "100%", marginTop: 14, padding: "12px 20px" }}>
      Show {Math.min(LOOKS_PAGE, left)} more · {left} {noun} left
    </button>
  );
}
