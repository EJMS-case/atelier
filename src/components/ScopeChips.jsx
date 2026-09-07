import { s } from "../ui/styles.js";
import { SCOPE_ALL, SCOPE_WEARABLE, scopeNotice } from "../features/closet/lookScope.js";

// The "All looks (n) / Wearable now (n)" chip pair, shared by every Saved
// surface that lists looks. Counts ride ON the chips so neither view is a
// mystery, and when the active scope is hiding looks it says so underneath in
// words — that line is what keeps a narrowed list from reading as a lost one.
//
// Renders nothing when every look is wearable from here: a chip that cannot
// change the list is noise, and the same rule governs the status and occasion
// chips beside it.
export default function ScopeChips({ scope, counts, onChange }) {
  if (!counts || counts.outOfScope < 1) return null;
  const notice = scopeNotice(scope, counts.outOfScope);
  return (
    <>
      <div style={{...s.filterRow, marginBottom: notice ? 4 : 8}}>
        {[[SCOPE_ALL, counts.all], [SCOPE_WEARABLE, counts.wearable]].map(([sc, n]) => (
          <button key={sc} onClick={() => onChange(sc)}
            style={{...s.chip, ...(scope === sc ? s.chipActive : {})}}>{sc} ({n})</button>
        ))}
      </div>
      {notice && (
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>
          {notice}
        </div>
      )}
    </>
  );
}
