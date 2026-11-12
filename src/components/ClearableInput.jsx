// A text field with an ✕ that empties it in one tap (owner, 2026-11-12:
// "titles have an X to easily remove what exists … add that X to the style me
// text box as well"). On a phone, deleting a long name or request one
// backspace at a time is the friction this removes.
//
// `onChange` receives the raw string — "" when the ✕ is tapped — the same
// contract as SearchInput. Every other prop (placeholder, onBlur,
// autoCapitalize, aria-label, maxLength…) passes through to the <input>. The
// ✕ refocuses the field so she can type the replacement straight away.
import { useRef } from "react";

export default function ClearableInput({ value, onChange, style, wrapStyle, clearLabel = "Clear", ...rest }) {
  const ref = useRef(null);
  const has = value != null && String(value) !== "";
  return (
    <div style={{ position: "relative", ...wrapStyle }}>
      <input
        ref={ref}
        type="text"
        {...rest}
        value={value ?? ""}
        onChange={e => onChange(e.target.value)}
        style={{ ...style, paddingRight: 34, boxSizing: "border-box" }}
      />
      {has && (
        <button type="button" aria-label={clearLabel}
          onMouseDown={e => e.preventDefault()}
          onClick={() => { onChange(""); ref.current?.focus(); }}
          style={{
            position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)",
            width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
            background: "none", border: "none", color: "var(--color-text-muted)",
            cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1,
          }}>
          ✕
        </button>
      )}
    </div>
  );
}
