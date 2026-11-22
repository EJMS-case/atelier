// ── HER WISH LIST ───────────────────────────────────────────────────────────
// Owner, 2026-11-22: her Wishlists app, moved in. The list she has always
// written here (shoppingList.js — every AI surface reads it, a closet add that
// answers an entry checks it off) now carries what a wish app carries: the
// photo, brand, price and link, a ★ for a must-have, the total. Three things
// the other app could not do:
//   · Atelier reads it (wishRead.js): what she owns like it and whether she
//     wears those, what it pairs with in HER closet, and an honest take.
//   · Its words reach Style Me, the chat, Evaluate and trips (they already
//     read the list), so a look can say "your wish-list clutch finishes this".
//   · Buying it closes the loop: add the piece to the closet and it checks off.
// Safari sends a wish in through the "＋ Atelier" bookmarklet (wishCapture.js).

import { useEffect, useMemo, useState } from "react";
import { s } from "../../ui/styles.js";
import { useRun, startRun } from "../../lib/backgroundRun.js";
import Thumb from "../../components/Thumb.jsx";
import { STYLING_CATEGORY_ORDER } from "../../constants/taxonomy.js";
import { addEntry, setDone, removeEntry, updateEntry, wishTotals } from "./shoppingList.js";
import { formatPrice } from "./shoppingListStore.js";
import { parseWishPayload, bookmarkletFor } from "./wishCapture.js";
import { readWish } from "./wishRead.js";

const label = { fontSize: 10, letterSpacing: "0.16em", color: "var(--color-text-muted)" };
const chip = (on) => ({ ...s.btnSecondary, fontSize: 10, padding: "4px 8px", ...(on ? { background: "var(--color-ink)", color: "var(--color-surface)", borderColor: "var(--color-ink)" } : {}) });
const money = formatPrice;
const when = (iso) => iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
export const wishRunKey = (id) => `wish:read:${id}`;

// ── One wish ─────────────────────────────────────────────────────────────────
function WishCard({ e, list, onChange, wardrobe, apiKey, onAddToCloset }) {
  const run = useRun(wishRunKey(e.id));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [bought, setBought] = useState(false);
  const [readOpen, setReadOpen] = useState(false);
  // A finished run lands on the entry, so it is kept (and paid for) once.
  useEffect(() => {
    if (run.status === "done" && run.result && run.result.at && run.result.at !== e.read?.at) {
      onChange(updateEntry(list, e.id, { read: run.result }));
      setReadOpen(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.status, run.result]);
  const byId = useMemo(() => new Map((wardrobe || []).map(it => [it.id, it])), [wardrobe]);
  const ask = () => startRun(wishRunKey(e.id), () => readWish({ wish: e, wardrobe, apiKey }));
  const read = e.read;
  const reading = run.status === "running";
  const pieceRow = (list2, key) => list2.map(p => byId.get(p.id) ? { it: byId.get(p.id), text: p[key] } : null).filter(Boolean);
  const owns = read ? pieceRow(read.owns || [], "note") : [];
  const pairs = read ? pieceRow(read.pairs || [], "why") : [];
  const sub = [e.brand, e.price != null ? money(e.price) : "", e.store && e.store !== e.brand ? e.store : ""].filter(Boolean).join(" · ");
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, background: "#fff", overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column" }}>
      {e.image ? (
        <div style={{ position: "relative", aspectRatio: "1", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img src={e.image} alt={e.text} loading="lazy" decoding="async" referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "contain" }}/>
        </div>
      ) : null}
      <div style={{ padding: "8px 10px 10px", display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--color-text)", lineHeight: 1.35, fontWeight: 500 }}>{e.text}</div>
          <button onClick={() => onChange(updateEntry(list, e.id, { mustHave: !e.mustHave }))}
            aria-pressed={e.mustHave} aria-label={e.mustHave ? `Must-have: ${e.text}` : `Mark must-have: ${e.text}`}
            style={{ background: "none", border: "none", padding: 0, fontSize: 16, lineHeight: 1, cursor: "pointer", color: e.mustHave ? "#B8860B" : "var(--color-border-muted)" }}>
            {e.mustHave ? "★" : "☆"}
          </button>
        </div>
        {sub && <div style={{ fontSize: 11, color: "var(--color-text-2)" }}>{sub}</div>}
        {e.note && <div style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.4 }}>✎ {e.note}</div>}
        {e.source !== "me" && (
          <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{e.source === "numbers" ? "from your closet's numbers" : "Atelier's idea, kept by you"}</div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto", paddingTop: 6 }}>
          {e.url && <a href={e.url} target="_blank" rel="noreferrer" style={{ ...chip(false), textDecoration: "none", color: "var(--color-ink)" }}>Open ↗</a>}
          <button style={chip(bought)} onClick={() => onAddToCloset ? setBought(b => !b) : onChange(setDone(list, e.id, true))} aria-label={`Bought: ${e.text}`}>✓ Bought</button>
          <button style={chip(false)} onClick={() => confirmRemove ? onChange(removeEntry(list, e.id)) : setConfirmRemove(true)}
            aria-label={`Remove ${e.text}`}>{confirmRemove ? "Remove?" : "✕"}</button>
        </div>
        {bought && (
          <div style={{ marginTop: 6, padding: 8, background: "var(--color-bg)", borderRadius: 6, fontSize: 11, lineHeight: 1.4 }}>
            <div style={{ marginBottom: 6 }}>Congratulations. Add it to your closet?</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button style={chip(true)} onClick={() => onAddToCloset(e)}>Add to my closet</button>
              <button style={chip(false)} onClick={() => onChange(setDone(list, e.id, true))}>Just mark bought</button>
            </div>
          </div>
        )}
        {read && !reading ? (
          <button onClick={() => setReadOpen(o => !o)} aria-expanded={readOpen}
            style={{ ...chip(readOpen), marginTop: 6, textAlign: "left", whiteSpace: "normal", lineHeight: 1.35 }}>
            ✦ {read.headline || "Atelier's read"}
          </button>
        ) : (
          <button onClick={ask} disabled={reading || !apiKey} style={{ ...chip(false), marginTop: 6, opacity: reading || !apiKey ? 0.6 : 1 }}
            title={apiKey ? "" : "Add your Anthropic key in Settings"}>
            {reading ? "✦ Reading…" : run.status === "error" ? "✦ Try again" : "✦ What do you think?"}
          </button>
        )}
        {run.status === "error" && <div style={{ fontSize: 10, color: "var(--color-danger)" }}>{run.error}</div>}
      </div>
      {read && readOpen && (
        <div style={{ padding: "0 10px 10px", fontSize: 12, color: "var(--color-text)", lineHeight: 1.5 }}>
          {read.take && <p style={{ margin: "0 0 8px" }}>{read.take}</p>}
          {[["YOU OWN LIKE IT", owns], ["WEAR IT WITH", pairs]].map(([title, rows]) => rows.length > 0 && (
            <div key={title} style={{ marginBottom: 8 }}>
              <div style={{ ...label, marginBottom: 4 }}>{title}</div>
              {rows.map(({ it, text }) => (
                <div key={it.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <div style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 4, overflow: "hidden", background: "var(--color-bg)" }}>
                    <Thumb item={it} alt={it.name} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                  </div>
                  <div style={{ minWidth: 0, fontSize: 11, lineHeight: 1.35 }}>
                    <span style={{ fontWeight: 500 }}>{it.name}</span>
                    {text && <span style={{ color: "var(--color-text-2)" }}> — {text}</span>}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <button onClick={ask} disabled={reading} style={{ ...chip(false), fontSize: 10 }}>{reading ? "Reading…" : "↻ Read it again"}</button>
          {read.at && <span style={{ fontSize: 10, color: "var(--color-text-muted)", marginLeft: 8 }}>read {when(read.at)}</span>}
        </div>
      )}
    </div>
  );
}

// ── Add a wish ───────────────────────────────────────────────────────────────
const EMPTY = { text: "", brand: "", price: "", store: "", image: "", url: "", category: "", note: "", mustHave: false };
function AddWishSheet({ initial, onSave, onClose }) {
  const [f, setF] = useState(() => ({ ...EMPTY, ...(initial || {}), price: initial?.price ?? "" }));
  const [pasteMsg, setPasteMsg] = useState("");
  const set = (k) => (ev) => setF(prev => ({ ...prev, [k]: ev.target.value }));
  const fill = (raw) => {
    const w = parseWishPayload(raw);
    if (!w) { setPasteMsg("That isn't a link or a wish from the bookmark. Type the details below."); return false; }
    setF(prev => ({ ...prev, ...Object.fromEntries(Object.entries(w).filter(([, v]) => v !== "" && v != null)), price: w.price ?? prev.price }));
    setPasteMsg(w.image ? "Filled in from the page." : "Filled in what the link says. Add a photo link or the price if you like.");
    return true;
  };
  const paste = async () => {
    try { const t = await navigator.clipboard.readText(); fill(t); }
    catch { setPasteMsg("Your browser didn't share the clipboard. Long-press the box below and Paste."); }
  };
  const save = () => { if (f.text.trim()) onSave({ ...f, text: f.text.trim() }); };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.5)", zIndex: 1100, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div role="dialog" aria-label="Add a wish" onClick={ev => ev.stopPropagation()}
        style={{ background: "var(--color-surface)", width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", borderRadius: "14px 14px 0 0", padding: 18, boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 16, fontFamily: "'DM Serif Display',Georgia,serif" }}>Add a wish</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--color-text-muted)" }}>×</button>
        </div>
        <button style={{ ...s.btnSecondary, width: "100%", fontSize: 12 }} onClick={paste}>Paste a link or a wish from Safari</button>
        <input style={{ ...s.input, width: "100%", fontSize: 12, marginTop: 6, boxSizing: "border-box" }} placeholder="…or paste it here"
          onPaste={ev => { const t = ev.clipboardData?.getData("text"); if (t && fill(t)) ev.preventDefault(); }}
          onChange={ev => { if (/https?:\/\/|atelier-wish:/.test(ev.target.value)) { fill(ev.target.value); ev.target.value = ""; } }}/>
        {pasteMsg && <div style={{ fontSize: 11, color: "var(--color-text-2)", marginTop: 6 }}>{pasteMsg}</div>}
        {f.image && (
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
            <img src={f.image} alt="" referrerPolicy="no-referrer" style={{ width: 72, height: 72, objectFit: "contain", background: "#fff", border: "1px solid var(--color-border)", borderRadius: 6 }}/>
            <button style={chip(false)} onClick={() => setF(prev => ({ ...prev, image: "" }))}>Remove photo</button>
          </div>
        )}
        <input style={{ ...s.input, width: "100%", fontSize: 13, marginTop: 10, boxSizing: "border-box" }} placeholder="What is it? — e.g. Twisted Gold Side Handle Clutch" value={f.text} onChange={set("text")} aria-label="Wish name"/>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input style={{ ...s.input, flex: 2, minWidth: 0, fontSize: 12 }} placeholder="Brand" value={f.brand} onChange={set("brand")} aria-label="Brand"/>
          <input style={{ ...s.input, flex: 1, minWidth: 0, fontSize: 12 }} placeholder="$ Price" inputMode="decimal" value={f.price} onChange={set("price")} aria-label="Price"/>
        </div>
        <input style={{ ...s.input, width: "100%", fontSize: 12, marginTop: 6, boxSizing: "border-box" }} placeholder="Note — size, colour, why" value={f.note} onChange={set("note")} aria-label="Note"/>
        <input style={{ ...s.input, width: "100%", fontSize: 12, marginTop: 6, boxSizing: "border-box" }} placeholder="Link (optional)" value={f.url} onChange={set("url")} aria-label="Link"/>
        <input style={{ ...s.input, width: "100%", fontSize: 12, marginTop: 6, boxSizing: "border-box" }} placeholder="Photo link, https://… (optional)" value={f.image} onChange={set("image")} aria-label="Photo link"/>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
          {STYLING_CATEGORY_ORDER.map(c => (
            <button key={c} onClick={() => setF(prev => ({ ...prev, category: prev.category === c ? "" : c }))} aria-pressed={f.category === c} style={chip(f.category === c)}>{c}</button>
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12, color: "var(--color-text)" }}>
          <input type="checkbox" checked={f.mustHave} onChange={ev => setF(prev => ({ ...prev, mustHave: ev.target.checked }))} style={{ width: 16, height: 16, accentColor: "var(--color-ink)" }}/>
          ★ Must-have
        </label>
        <button style={{ ...s.btnPrimary, width: "100%", marginTop: 12, fontSize: 13, opacity: f.text.trim() ? 1 : 0.5 }} disabled={!f.text.trim()} onClick={save}>Add to my wish list</button>
      </div>
    </div>
  );
}

// ── Getting a wish in from Safari ────────────────────────────────────────────
function SafariSetup() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = bookmarkletFor(typeof window !== "undefined" ? window.location.origin : "");
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <div style={{ marginTop: 12 }}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 11, color: "var(--color-ink)", textDecoration: "underline" }}>
        {open ? "Hide" : "Add wishes straight from Safari"}
      </button>
      {open && (
        <div style={{ fontSize: 12, color: "var(--color-text-2)", lineHeight: 1.55, marginTop: 6 }}>
          <p style={{ margin: "0 0 6px" }}>A one-time setup puts an “＋ Atelier” button in your Safari bookmarks. Tap it on any product page and the wish arrives with its photo, brand and price.</p>
          <ol style={{ margin: "0 0 8px", paddingLeft: 18 }}>
            <li>Tap <b>Copy the bookmark</b> below.</li>
            <li>In Safari, bookmark any page (Share → Add Bookmark), and name it <b>＋ Atelier</b>.</li>
            <li>Open Bookmarks, tap <b>Edit</b>, open ＋ Atelier, clear its address and paste.</li>
          </ol>
          <p style={{ margin: "0 0 8px" }}>Then on a product page: Bookmarks → ＋ Atelier. Atelier opens with the wish filled in. If you use Atelier from your home screen, the wish is also copied: open Atelier, tap <b>+ Add wish</b>, then <b>Paste</b>.</p>
          <button style={{ ...s.btnSecondary, fontSize: 12 }} onClick={copy}>{copied ? "Copied ✓" : "Copy the bookmark"}</button>
        </div>
      )}
    </div>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────
export default function WishList({ list, onChange, wardrobe, apiKey, pendingWish = null, onPendingConsumed, onAddToCloset }) {
  const [adding, setAdding] = useState(null);       // null | initial fields
  const [mustOnly, setMustOnly] = useState(false);
  const [boughtOpen, setBoughtOpen] = useState(false);
  const [shareMsg, setShareMsg] = useState("");
  // A wish Safari sent (App reads #wish= and hands it here): open the sheet on it.
  useEffect(() => {
    if (!pendingWish) return;
    const w = parseWishPayload(pendingWish);
    setAdding(w || {});
    onPendingConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingWish]);

  const open = list.filter(e => e.status === "open").slice().reverse();   // last added first
  const shown = mustOnly ? open.filter(e => e.mustHave) : open;
  const done = list.filter(e => e.status === "done").sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
  const { total } = wishTotals(list);

  const save = (f) => {
    onChange(addEntry(list, { ...f, source: "me" }));
    setAdding(null);
  };
  // For Mike (owner, 2026-11-22: "I'd like to share the wishlist with Mike").
  // A LINK to a live, read-only page (wishShare.js, migration 0040) that
  // stays current as she adds and buys, and that she can turn off; or the
  // list as a one-off message. Both go out through the phone's share sheet.
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const sendOut = async (payload, copied) => {
    try {
      if (navigator.share) { await navigator.share(payload); return; }
      await navigator.clipboard.writeText(payload.url || payload.text);
      setShareMsg(copied);
    } catch (err) {
      if (err?.name !== "AbortError") setShareMsg("Couldn't open sharing on this device.");
    }
  };
  const shareLinkNow = async () => {
    setShareMsg("");
    try {
      const { startSharing, shareLink } = await import("./wishShare.js");
      const token = await startSharing();
      setSharing(true);
      await sendOut({ title: "My wish list", url: shareLink(window.location.origin, token) }, "Link copied. Paste it into a message.");
    } catch (err) { setShareMsg(err.message || "Couldn't turn on sharing."); }
  };
  const shareText = () => {
    const lines = open.map(e => [`${e.mustHave ? "★ " : ""}${e.text}`, [e.brand, e.price != null ? money(e.price) : ""].filter(Boolean).join(", "), e.url].filter(Boolean).join(" — "));
    return sendOut({ title: "My wish list", text: `My wish list\n\n${lines.join("\n")}` }, "Copied. Paste it into a message.");
  };
  const stopShare = async () => {
    const { stopSharing } = await import("./wishShare.js");
    const ok = await stopSharing();
    setSharing(false);
    setShareMsg(ok ? "Sharing is off. Links you've sent no longer open the list." : "Couldn't turn sharing off. Try again.");
  };
  useEffect(() => {
    if (!shareOpen) return;
    import("./wishShare.js").then(m => m.loadShareToken()).then(t => setSharing(!!t)).catch(() => {});
  }, [shareOpen]);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <div style={label}>MY WISH LIST · {open.length} open{total > 0 ? ` · ${money(Math.round(total))}` : ""}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={chip(shareOpen)} onClick={() => setShareOpen(o => !o)} aria-expanded={shareOpen}>Share</button>
          <button style={{ ...chip(true) }} onClick={() => setAdding({})}>+ Add wish</button>
        </div>
      </div>
      {shareOpen && (
        <div style={{ padding: 10, marginBottom: 10, background: "#fff", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12, lineHeight: 1.5, color: "var(--color-text-2)" }}>
          <div style={{ marginBottom: 8 }}>
            A link opens a read-only page of your open wishes (photo, brand, price, link and note). It stays up to date as you add and buy. No account needed, and nothing else in Atelier is visible.
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={chip(true)} onClick={shareLinkNow}>{sharing ? "Send the link" : "Share a link"}</button>
            <button style={chip(false)} onClick={shareText} disabled={!open.length}>Send as a message</button>
            {sharing && <button style={chip(false)} onClick={stopShare}>Stop sharing</button>}
          </div>
          {sharing && <div style={{ fontSize: 11, marginTop: 6 }}>Sharing is on.</div>}
        </div>
      )}
      {shareMsg && <div style={{ fontSize: 11, color: "var(--color-text-2)", marginBottom: 6 }}>{shareMsg}</div>}
      {open.some(e => e.mustHave) && (
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <button style={chip(!mustOnly)} onClick={() => setMustOnly(false)}>All</button>
          <button style={chip(mustOnly)} onClick={() => setMustOnly(true)}>★ Must-haves</button>
        </div>
      )}
      {open.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-text-2)", margin: "0 0 8px", lineHeight: 1.5 }}>
          Nothing on it yet. Add what you're eyeing — a link, a photo, or just the words. Atelier reads the list everywhere it styles you, will tell you what it thinks of each piece, and checks a wish off when you add the piece to your closet.
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          {shown.map(e => <WishCard key={e.id} e={e} list={list} onChange={onChange} wardrobe={wardrobe} apiKey={apiKey} onAddToCloset={onAddToCloset}/>)}
        </div>
      )}
      <SafariSetup/>
      {done.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setBoughtOpen(o => !o)} aria-expanded={boughtOpen}
            style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={label}>BOUGHT · {done.length}</span>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{boughtOpen ? "▲" : "▼"}</span>
          </button>
          {boughtOpen && done.map(e => (
            <div key={e.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8 }}>
              <input type="checkbox" checked aria-label={`Still looking: ${e.text}`} onChange={() => onChange(setDone(list, e.id, false))}
                style={{ marginTop: 2, width: 16, height: 16, accentColor: "var(--color-ink)", flexShrink: 0 }}/>
              <div style={{ flex: 1, fontSize: 12, color: "var(--color-text-2)", lineHeight: 1.4, textDecoration: "line-through" }}>{e.text}</div>
              <div style={{ fontSize: 10, color: "var(--color-text-muted)", textAlign: "right", lineHeight: 1.4 }}>
                {e.boughtName ? <>answered by <span style={{ color: "var(--color-text)" }}>{e.boughtName}</span><br/></> : null}{when(e.doneAt)}
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && <AddWishSheet initial={adding} onSave={save} onClose={() => setAdding(null)}/>}
    </div>
  );
}
