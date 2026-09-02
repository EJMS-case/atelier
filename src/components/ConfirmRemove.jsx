import { s } from "../ui/styles.js";

// ── CONFIRM / CANCEL ─────────────────────────────────────────────────────────
// The two-tap delete confirmation, shared by the saved-looks list and the wear
// history. Both had their own copy, identical down to the danger colour — and
// two copies of a destructive affordance is one that can drift into looking
// less dangerous than the other.
export default function ConfirmRemove({ onConfirm, onCancel }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button style={{ ...s.histDeleteBtn, color: "var(--color-danger)" }} onClick={onConfirm}>Confirm</button>
      <button style={s.histDeleteBtn} onClick={onCancel}>Cancel</button>
    </div>
  );
}
