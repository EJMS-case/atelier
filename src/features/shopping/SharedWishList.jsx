// ── THE SHARED WISH LIST (what Mike sees) ───────────────────────────────────
// Opened from a link she sent (#list=<token>). Rendered by main.jsx INSTEAD of
// the app, before the sign-in gate: no account, no closet, nothing but the
// open wishes the token unlocks (wishShare.js, migration 0040). Read-only.

import { useEffect, useState } from "react";
import { fetchSharedWishes } from "./wishShare.js";
import { formatPrice as money } from "./shoppingListStore.js";

export default function SharedWishList({ token }) {
  const [wishes, setWishes] = useState(undefined);   // undefined loading · null off · []
  const [err, setErr] = useState("");
  useEffect(() => {
    fetchSharedWishes(token).then(setWishes).catch(e => { setErr(e.message); setWishes(null); });
  }, [token]);
  const total = (wishes || []).reduce((t, w) => t + (typeof w.price === "number" ? w.price : 0), 0);
  return (
    <div style={{ minHeight: "100vh", background: "#F7F3EE", padding: "24px 16px 48px", boxSizing: "border-box", fontFamily: "'DM Sans',Inter,system-ui,sans-serif", color: "#2C2420" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ fontSize: 10, letterSpacing: "0.2em", color: "#8A7F76" }}>ATELIER</div>
        <h1 style={{ fontFamily: "'DM Serif Display',Georgia,serif", fontWeight: 400, fontSize: 28, margin: "4px 0 4px" }}>Wish list</h1>
        {Array.isArray(wishes) && (
          <div style={{ fontSize: 12, color: "#8A7F76", marginBottom: 18 }}>
            {wishes.length} wish{wishes.length === 1 ? "" : "es"}{total > 0 ? ` · ${money(Math.round(total))}` : ""}{wishes.some(w => w.mustHave) ? " · ★ marks a must-have" : ""}
          </div>
        )}
        {wishes === undefined && <p style={{ fontSize: 13, color: "#8A7F76" }}>Loading…</p>}
        {wishes === null && <p style={{ fontSize: 13, color: "#8A7F76" }}>{err || "This link has been turned off. Ask for a new one."}</p>}
        {Array.isArray(wishes) && wishes.length === 0 && <p style={{ fontSize: 13, color: "#8A7F76" }}>Nothing on the list right now.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
          {(wishes || []).map((w, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid #E6DED5", borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {w.image && (
                <div style={{ aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <img src={w.image} alt={w.text} loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain" }}/>
                </div>
              )}
              <div style={{ padding: "8px 10px 10px", display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.35 }}>{w.mustHave ? "★ " : ""}{w.text}</div>
                {(w.brand || money(w.price)) && <div style={{ fontSize: 12, color: "#5E554E" }}>{[w.brand, money(w.price)].filter(Boolean).join(" · ")}</div>}
                {w.note && <div style={{ fontSize: 11, color: "#8A7F76", lineHeight: 1.4 }}>{w.note}</div>}
                {w.url && <a href={w.url} target="_blank" rel="noreferrer" style={{ marginTop: "auto", paddingTop: 6, fontSize: 12, color: "#2C2420" }}>Open ↗</a>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
