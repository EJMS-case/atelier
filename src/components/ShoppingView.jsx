import { useEffect, useMemo, useState } from "react";
import { s, si } from "../ui/styles.js";
import { icons, Icon } from "../ui/icons.jsx";
import { useRun, startRun, RUN_KEYS } from "../lib/backgroundRun.js";
import { runShoppingAnalysis } from "../features/shopping/gapAnalysis.js";
import { loadBrandFinds, saveBrandFinds } from "../features/shopping/brandFinds.js";
import { recordVerdict, loadVerdicts } from "../features/shopping/verdicts.js";
import { gapKey } from "../features/shopping/verifyGaps.js";
import { loadShoppingList, saveShoppingList, addEntry, setDone, removeEntry, entryFromGap } from "../features/shopping/shoppingList.js";
import { invalidateLearning } from "../features/stylist/learning.js";
import { STYLING_CATEGORY_ORDER } from "../constants/taxonomy.js";
import {
  closetColorProfile, colorCategoryCoverage, pairUnlocks, textureInventory,
  seasonForDate, hexForColorLabel, unlockNeedPhrase,
} from "../utils/wardrobe-coverage.js";

const label = { fontSize: 10, letterSpacing: "0.16em", color: "var(--color-text-muted)" };
const chip = (on) => ({ ...s.btnSecondary, fontSize: 10, padding: "4px 8px", ...(on ? { background: "var(--color-ink)", color: "var(--color-surface)", borderColor: "var(--color-ink)" } : {}) });
const addBtn = { ...s.btnSecondary, fontSize: 10, padding: "3px 8px", whiteSpace: "nowrap", flexShrink: 0 };
const when = (iso) => iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }) : "";

// ── Her list ────────────────────────────────────────────────────────────────
// The centre of the screen (owner, 2026-09-17: "an area I write and check off
// myself"). Everything else on the page ADDS to it; a closet add checks an
// entry off (App.addItems → answerShoppingList) and the piece is named here.
function ShoppingListCard({ list, onChange }) {
  const [text, setText] = useState("");
  const [cat, setCat] = useState("");
  const [note, setNote] = useState("");
  const [boughtOpen, setBoughtOpen] = useState(false);
  const open = list.filter(e => e.status === "open");
  const done = list.filter(e => e.status === "done").sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
  const add = () => {
    const v = text.trim();
    if (!v) return;
    onChange(addEntry(list, { text: v, category: cat, note: note.trim(), source: "me" }));
    setText(""); setNote(""); setCat("");
  };
  const source = (e) => e.source === "numbers" ? "from your closet's numbers" : e.source === "atelier" ? "Atelier's idea, kept by you" : "";
  return (
    <div style={{ ...si.card, marginBottom: 16 }}>
      <div style={{ ...label, marginBottom: 8 }}>MY LIST{open.length ? ` · ${open.length}` : ""}</div>
      {open.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--color-text-2)", margin: "0 0 8px", lineHeight: 1.5 }}>
          Nothing on it yet. Write what you're looking for — every stylist surface reads this list, and when a piece you add to the closet answers an entry, it's checked off for you.
        </p>
      )}
      {open.map(e => (
        <div key={e.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
          <input type="checkbox" checked={false} aria-label={`Bought: ${e.text}`} onChange={() => onChange(setDone(list, e.id, true))}
            style={{ marginTop: 2, width: 16, height: 16, accentColor: "var(--color-ink)", flexShrink: 0 }}/>
          <div style={{ flex: 1, fontSize: 13, color: "var(--color-text)", lineHeight: 1.4 }}>
            {e.text}
            {(e.category || e.color) && <span style={{ color: "var(--color-text-muted)", fontSize: 11 }}> · {[e.category, e.color].filter(Boolean).join(" · ")}</span>}
            {e.note && <div style={{ fontSize: 11, color: "var(--color-text-2)", lineHeight: 1.45 }}>{e.note}</div>}
            {(source(e) || e.url) && (
              <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                {source(e)}{source(e) && e.url ? " · " : ""}{e.url && <a href={e.url} target="_blank" rel="noreferrer" style={{ color: "var(--color-ink)" }}>link</a>}
              </div>
            )}
          </div>
          <button onClick={() => onChange(removeEntry(list, e.id))} aria-label={`Remove ${e.text}`}
            style={{ background: "none", border: "none", color: "var(--color-border-muted)", cursor: "pointer", fontSize: 13 }}>✕</button>
        </div>
      ))}
      <input style={{ ...s.input, width: "100%", fontSize: 13, marginTop: 4 }} placeholder="What are you looking for? — e.g. a burgundy suede loafer" value={text}
        onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}/>
      <input style={{ ...s.input, width: "100%", fontSize: 12, marginTop: 6 }} placeholder="Note (optional) — why, or what it has to go with" value={note} onChange={e => setNote(e.target.value)}/>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
        {STYLING_CATEGORY_ORDER.map(c => (
          <button key={c} onClick={() => setCat(cat === c ? "" : c)} aria-pressed={cat === c} style={chip(cat === c)}>{c}</button>
        ))}
      </div>
      <button style={{ ...s.btnPrimary, width: "100%", marginTop: 8, fontSize: 12 }} onClick={add} disabled={!text.trim()}>Add to my list</button>
      {done.length > 0 && (
        <div style={{ marginTop: 12 }}>
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
    </div>
  );
}

// ── The numbers, as things she can add ──────────────────────────────────────
// The deterministic read of the wardrobe (utils/wardrobe-coverage.js): which
// of her core colours no bag or dress carries, which pairing one piece would
// unlock, which textures are missing for the season. Counted over the pieces
// she styles — gym, lounge, swim and metal-coloured jewellery stay out — and
// every line says the count it rests on. Each is an offer for the list, not a
// finding (owner, 2026-09-17: the old panel was wrong and read as orders).
const SINGULAR = { Bags: "bag", Shoes: "pair of shoes", Outerwear: "coat or jacket", Knits: "knit", Tops: "top", Bottoms: "bottom", Dresses: "dress" };
function NumbersCard({ items, list, onAdd }) {
  const [open, setOpen] = useState(false);
  const data = useMemo(() => {
    try {
      const season = seasonForDate();
      const profile = closetColorProfile(items);
      const coverage = colorCategoryCoverage(items).filter(c => c.missingCore.length > 0);
      const unlocks = pairUnlocks(items, { max: 3 });
      const textures = textureInventory(items, { season });
      return { season, profile, coverage, unlocks, textures };
    } catch (e) {
      // Visible in console — a silent null here once hid the whole panel.
      console.error("[Atelier] coverage panel failed:", e);
      return null;
    }
  }, [items]);
  if (!data) return null;
  const { profile, coverage, unlocks, textures, season } = data;
  const shade = (f) => {
    const sh = profile.dominantShade(f);
    return (sh && sh.toLowerCase() !== f.toLowerCase() ? sh : f).toLowerCase();
  };
  const onList = (text) => list.some(e => e.status === "open" && e.text.toLowerCase() === text.toLowerCase());
  const swatch = (lbl) => (
    <span style={{ width: 10, height: 10, borderRadius: "50%", display: "inline-block", background: hexForColorLabel(lbl), boxShadow: "0 0 0 1px rgba(0,0,0,0.12)", marginRight: 5, verticalAlign: "middle" }}/>
  );
  const offers = [];
  for (const c of coverage) {
    for (const f of c.missingCore) {
      const text = `A ${shade(f)} ${SINGULAR[c.category] || c.category.toLowerCase()}`;
      const note = `Your ${shade(f)} runs through ${profile.familyCounts[f] || 0} pieces you style, and none of them is a ${SINGULAR[c.category] || c.category.toLowerCase()}.`;
      offers.push({ key: `${c.category}|${f}`, text, note, category: c.category, color: shade(f), swatch: shade(f) });
    }
  }
  for (const u of unlocks) {
    const text = `A ${u.needLabel.toLowerCase()} piece — unlocks ${u.label}`;
    offers.push({ key: u.label, text, note: `You own ${u.haveCount} ${u.haveLabel.toLowerCase()} pieces and ${unlockNeedPhrase(u)}. ${u.note}`, category: "", color: u.needLabel, swatch: u.needLabel });
  }
  for (const t of textures.missing) offers.push({ key: `tex|${t}`, text: `Something in ${t}`, note: `Nothing you style reads as ${t}, and it is a ${season} texture.`, category: "", color: "" });
  for (const t of textures.thin) offers.push({ key: `thin|${t}`, text: `Another piece in ${t}`, note: `${textures.owned[t]} piece${textures.owned[t] === 1 ? "" : "s"} in ${t} — thin for ${season}.`, category: "", color: "" });
  return (
    <div style={{ ...si.card, marginBottom: 16 }}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={label}>FROM YOUR CLOSET'S NUMBERS{offers.length ? ` · ${offers.length}` : ""}</span>
        <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 11, color: "var(--color-text-2)", margin: "0 0 8px", lineHeight: 1.45 }}>
            Counted from the pieces you style, both closets — gym, lounge and swim left out, no AI. Ideas, not orders: add the ones you agree with.
          </p>
          {offers.length === 0 && <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No structural colour or texture holes in what you style.</div>}
          {offers.map(o => (
            <div key={o.key} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1, fontSize: 12, color: "var(--color-text)", lineHeight: 1.45 }}>
                {o.swatch ? swatch(o.swatch) : null}<strong>{o.text}</strong>
                <div style={{ fontSize: 11, color: "var(--color-text-2)" }}>{o.note}</div>
              </div>
              {onList(o.text)
                ? <span style={{ fontSize: 10, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>on your list</span>
                : <button style={addBtn} onClick={() => onAdd({ text: o.text, category: o.category, color: o.color, note: o.note, source: "numbers" })}>+ Add</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Her brand finds — the editor ─────────────────────────────────────────────
// Name + the categories she'd shop there + an optional link. Stored
// cross-device (features/shopping/brandFinds.js); read by Atelier's ideas,
// Complete-a-Look, and Brand Atlas.
function BrandFindsCard({ finds, onChange }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [cats, setCats] = useState([]);
  const toggleCat = (c) => setCats(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  const add = () => {
    const v = name.trim();
    if (!v) return;
    onChange([...finds, { name: v, categories: cats, url: url.trim(), note: note.trim() }]);
    setName(""); setUrl(""); setNote(""); setCats([]);
  };
  return (
    <div style={{ ...si.card, marginBottom: 16 }}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 10, letterSpacing: "0.16em", color: "var(--color-text-muted)" }}>MY BRAND FINDS{finds.length ? ` · ${finds.length}` : ""}</span>
        <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 11, color: "var(--color-text-2)", margin: "0 0 8px", lineHeight: 1.45 }}>
            Labels you found and want to buy from, mapped to what you'd buy there. Atelier names them when an idea fits, and Brand Atlas stops re-scouting them.
          </p>
          {finds.map((f, i) => (
            <div key={`${f.name}-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
              <div style={{ flex: 1, fontSize: 12, color: "var(--color-text)", lineHeight: 1.4 }}>
                {f.url ? <a href={f.url} target="_blank" rel="noreferrer" style={{ color: "var(--color-ink)" }}>{f.name}</a> : f.name}
                <span style={{ color: "var(--color-text-muted)" }}> · {f.categories.length ? f.categories.join(", ") : "any category"}</span>
                {f.note && <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{f.note}</div>}
              </div>
              <button onClick={() => onChange(finds.filter((_, idx) => idx !== i))} aria-label={`Remove ${f.name}`}
                style={{ background: "none", border: "none", color: "var(--color-border-muted)", cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input style={{ ...s.input, flex: 1, fontSize: 12 }} placeholder="Brand name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}/>
            <input style={{ ...s.input, flex: 1, fontSize: 12 }} placeholder="Link (optional)" value={url} onChange={e => setUrl(e.target.value)}/>
          </div>
          <input style={{ ...s.input, width: "100%", fontSize: 12, marginTop: 6 }} placeholder="Note (optional) — e.g. great loafers, runs small" value={note} onChange={e => setNote(e.target.value)}/>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
            {STYLING_CATEGORY_ORDER.map(c => (
              <button key={c} onClick={() => toggleCat(c)} aria-pressed={cats.includes(c)}
                style={{ ...s.btnSecondary, fontSize: 10, padding: "4px 8px", ...(cats.includes(c) ? { background: "var(--color-ink)", color: "var(--color-surface)", borderColor: "var(--color-ink)" } : {}) }}>{c}</button>
            ))}
          </div>
          <button style={{ ...s.btnPrimary, width: "100%", marginTop: 8, fontSize: 12 }} onClick={add} disabled={!name.trim()}>Add brand find</button>
        </div>
      )}
    </div>
  );
}

// ── Her verdict on one suggestion ────────────────────────────────────────────
function VerdictRow({ gap, verdicts, onVerdict }) {
  const current = verdicts.find(v => v.key === gapKey(gap))?.verdict || "";
  const opts = [["own", "I own this"], ["no", "Not for me"], ["yes", "Add to list"]];
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      {opts.map(([v, label]) => (
        <button key={v} onClick={() => onVerdict(gap, current === v ? null : v)} aria-pressed={current === v}
          style={{ ...s.btnSecondary, fontSize: 10, padding: "4px 9px", ...(current === v ? { background: "var(--color-ink)", color: "var(--color-surface)", borderColor: "var(--color-ink)" } : {}) }}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── What was left out, and why ───────────────────────────────────────────────
// The verified-away picks (features/shopping/verifyGaps.js): she sees the
// blue tote the model wanted to sell her, next to the navy one she owns.
function DroppedList({ dropped }) {
  if (!dropped?.length) return null;
  return (
    <div style={{ ...si.card, background: "var(--color-bg)" }}>
      <div style={{ fontSize: 10, letterSpacing: "0.16em", color: "var(--color-text-muted)", marginBottom: 6 }}>LEFT OUT · CHECKED AGAINST YOUR CLOSET</div>
      {dropped.map((d, i) => (
        <div key={i} style={{ fontSize: 11, color: "var(--color-text-2)", lineHeight: 1.5 }}>
          <span style={{ color: "var(--color-text)" }}>{d.gap?.suggestion}</span> — {d.reason}
          {d.owned?.length ? `: ${d.owned.slice(0, 3).map(it => [it.brand, it.name].filter(Boolean).join(" ")).join(", ")}` : ""}
        </div>
      ))}
    </div>
  );
}

export default function ShoppingView({ items, wardrobe = [], logs = [], apiKey, onBack }) {
  const [mode, setMode] = useState("gap");
  const [selectedIds, setSelectedIds] = useState([]);
  const [pickerQuery, setPickerQuery] = useState("");
  // The analysis runs in lib/backgroundRun.js, not in this component's
  // state: leaving the screen no longer loses it, and the last result is
  // still here tomorrow (owner, 2026-09-17: it "took FOREVER and didn't run
  // in the background"). One run per mode.
  const runKey = mode === "gap" ? RUN_KEYS.shoppingGap : RUN_KEYS.shoppingComplete;
  const run = useRun(runKey);
  const loading = run.status === "running";
  const results = run.status === "done" ? run.result : null;
  const [localErr, setLocalErr] = useState("");
  const err = localErr || (run.status === "error" ? run.error : "");
  // A buy decision reads everything she owns, both closets; the picker below
  // (Complete a Look) offers what she can pick from right now.
  const owned = wardrobe.length ? wardrobe : items;

  const [finds, setFinds] = useState([]);
  const [verdicts, setVerdicts] = useState([]);
  const [list, setList] = useState([]);
  useEffect(() => {
    let alive = true;
    loadBrandFinds().then(l => { if (alive) setFinds(l); }).catch(() => {});
    loadVerdicts().then(l => { if (alive) setVerdicts(l); }).catch(() => {});
    loadShoppingList().then(l => { if (alive) setList(l); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  // Every save teaches: the learning memo is cleared so the chat, Style Me
  // and the next run read the new entry, find or verdict on their next tap.
  const updateFinds = (l) => { setFinds(l); saveBrandFinds(l).catch(() => {}); invalidateLearning(); };
  const updateList = (l) => { setList(l); saveShoppingList(l).catch(() => {}); invalidateLearning(); };
  const addToList = (fields) => updateList(addEntry(list, fields));
  // "Add to list" keeps the idea on HER list (what every prompt reads); the
  // verdict itself is what the card remembers and what the next run rules out.
  const onVerdict = (gap, verdict) => {
    if (verdict === "yes") addToList(entryFromGap(gap));
    recordVerdict(gap, verdict).then(l => { setVerdicts(l); invalidateLearning(); }).catch(() => {});
  };

  const PICKER_CAP = 60;
  const q = pickerQuery.trim().toLowerCase();
  const pickable = items.filter(it => it.image).filter(it =>
    !q || [it.name, it.brand, it.category, it.subcategory, it.color]
      .some(f => (f || "").toLowerCase().includes(q))
  );
  // Selected items always render, even when the search filter would hide them.
  const shown = [
    ...pickable.filter(it => selectedIds.includes(it.id)),
    ...pickable.filter(it => !selectedIds.includes(it.id)).slice(0, PICKER_CAP),
  ];

  const toggleItem = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleAnalyze = () => {
    if (!apiKey) { setLocalErr("Add your Anthropic API key in Settings."); return; }
    if (mode === "complete" && selectedIds.length === 0) { setLocalErr("Select at least one piece."); return; }
    setLocalErr("");
    startRun(runKey, () => runShoppingAnalysis({ wardrobe: owned, available: items, apiKey, mode, selectedIds, logs }));
  };

  const priorityColor = { high: "var(--color-danger)", medium: "#8B6914", low: "var(--color-success)" };

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Shopping</h2>
      </div>

      <div style={s.modeTabs}>
        {[["gap","My List"],["complete","Complete a Look"]].map(([m, name]) => (
          <button key={m} onClick={() => { setMode(m); setLocalErr(""); }}
            style={{...s.modeTab, ...(mode === m ? s.modeTabActive : {})}}>{name}</button>
        ))}
      </div>

      {mode === "gap" && (
        <>
          <div style={s.advisorNote}>Your list, in your words. Style Me, the stylist chat, Evaluate and trips all read it; a piece you add to the closet that answers an entry checks it off. Below it, two sources of ideas you can add or ignore: what the numbers say about the pieces you style, and what Atelier would look for.</div>
          <ShoppingListCard list={list} onChange={updateList}/>
          <NumbersCard items={owned} list={list} onAdd={addToList}/>
          <BrandFindsCard finds={finds} onChange={updateFinds}/>
        </>
      )}

      {mode === "complete" && (
        <>
          <div style={s.advisorNote}>Select pieces from your wardrobe, and AI will suggest what to buy to complete or elevate the outfit.</div>
          <input
            type="text"
            value={pickerQuery}
            onChange={e => setPickerQuery(e.target.value)}
            placeholder="Search your closet — name, brand, category, color…"
            style={{width:"100%", padding:"10px 12px", marginBottom:12, fontSize:13, border:"1px solid var(--color-border)", borderRadius:6, background:"var(--color-surface)", color:"var(--color-text)"}}
          />
          {pickable.length > shown.length && (
            <div style={{fontSize:11, color:"var(--color-text-muted)", marginBottom:8}}>
              Showing {shown.length} of {pickable.length} — search to narrow down.
            </div>
          )}
          <div style={{...s.grid, marginBottom:20}}>
            {shown.map(item => (
              <div key={item.id} style={{...s.card, border: selectedIds.includes(item.id) ? "2px solid var(--color-ink)" : "1px solid var(--color-border)", cursor:"pointer"}}
                onClick={() => toggleItem(item.id)}>
                <div style={{...s.cardImg, height:120}}>
                  <img src={item.image} alt={item.name} loading="lazy" decoding="async" style={s.cardPhoto}/>
                  {selectedIds.includes(item.id) && (
                    <div style={{position:"absolute",top:6,right:6,background:"var(--color-ink)",color:"var(--color-surface)",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>✓</div>
                  )}
                </div>
                <div style={{padding:"6px 8px"}}><div style={{fontSize:10,color:"var(--color-text-muted)"}}>{item.category}</div><div style={{fontSize:11}}>{item.name}</div></div>
              </div>
            ))}
          </div>
        </>
      )}

      {err && <p style={s.err}>{err}</p>}
      <button style={{...s.btnPrimary, width:"100%", marginBottom: loading ? 6 : 20}} onClick={handleAnalyze} disabled={loading}>
        {loading ? <><span style={s.spinnerSmLight}/> Analyzing…</> : <><Icon path={icons.sparkle} size={15}/> {mode === "gap" ? (results ? "Ask Atelier for ideas again" : "Ask Atelier for ideas") : `Find Pieces (${selectedIds.length} selected)`}</>}
      </button>
      {loading && (
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 20, lineHeight: 1.5 }}>
          This takes a minute or two. You can leave — it keeps running, and the result waits here and on Home.
        </div>
      )}
      {results && run.finishedAt && (
        <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 10, letterSpacing: "0.06em" }}>
          RAN {new Date(run.finishedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).toUpperCase()}
        </div>
      )}

      {results && mode === "gap" && results.gaps && (
        <div>
          <div style={{fontSize:11,letterSpacing:"0.2em",color:"var(--color-text-muted)",marginBottom:16,fontFamily:"sans-serif"}}>
            {results.gaps.length === 0 ? "NOTHING ATELIER WOULD ADD" : `${results.gaps.length} IDEA${results.gaps.length === 1 ? "" : "S"} FROM ATELIER · add the ones you agree with`}
          </div>
          {results.gaps.length === 0 && (
            <div style={{ ...si.card, fontSize: 12, color: "var(--color-text-2)", lineHeight: 1.5 }}>
              Every pick the stylist reached for is something you already own or have ruled out. Your closet is covered for the season — the list below shows what was checked.
            </div>
          )}
          {results.gaps.map((gap, i) => (
            <div key={i} style={si.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:9,letterSpacing:"0.12em",padding:"2px 8px",borderRadius:3,fontFamily:"sans-serif",
                  background: gap.priority === "high" ? "#FFF0F0" : gap.priority === "medium" ? "#FFF8EC" : "#F0FFF4",
                  color: priorityColor[gap.priority] || "var(--color-text-2)"}}>{gap.priority?.toUpperCase()}</div>
                <div style={{fontSize:10,color:"var(--color-accent)"}}>{gap.price}</div>
              </div>
              <div style={{fontSize:10,letterSpacing:"0.1em",color:"var(--color-text-muted)",marginBottom:4}}>{gap.category}{gap.subcategory ? ` · ${gap.subcategory}` : ""}</div>
              <div style={{fontSize:14,marginBottom:4}}>{gap.suggestion}</div>
              <div style={{fontSize:12,color:"var(--color-text-2)",marginBottom:6,lineHeight:1.5}}>{gap.description}</div>
              <div style={{fontSize:11,color:"var(--color-text)",lineHeight:1.5,marginBottom:4,fontStyle:"italic"}}>{gap.reason}</div>
              {gap.colorNote && <div style={{fontSize:10,color:"var(--color-success)"}}>✓ {gap.colorNote}</div>}
              <VerdictRow gap={gap} verdicts={verdicts} onVerdict={onVerdict}/>
            </div>
          ))}
          <DroppedList dropped={results.dropped}/>
        </div>
      )}

      {results && mode === "complete" && results.completions && (
        <div>
          <div style={{fontSize:11,letterSpacing:"0.2em",color:"var(--color-text-muted)",marginBottom:16,fontFamily:"sans-serif"}}>
            {results.completions.length} SUGGESTIONS
          </div>
          {results.completions.map((comp, i) => (
            <div key={i} style={si.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontSize:9,letterSpacing:"0.12em",padding:"2px 8px",borderRadius:3,fontFamily:"sans-serif",
                  background: comp.type === "essential" ? "#E8F5EC" : "#EDE8FF",
                  color: comp.type === "essential" ? "var(--color-success)" : "#5B4E8E"}}>{comp.type === "essential" ? "ESSENTIAL" : "ELEVATING"}</span>
                <div style={{fontSize:10,color:"var(--color-accent)"}}>{comp.price}</div>
              </div>
              <div style={{fontSize:10,letterSpacing:"0.1em",color:"var(--color-text-muted)",marginBottom:4}}>{comp.category}</div>
              <div style={{fontSize:14,marginBottom:4}}>{comp.suggestion}</div>
              <div style={{fontSize:12,color:"var(--color-text-2)",marginBottom:6,lineHeight:1.5}}>{comp.description}</div>
              <div style={{fontSize:11,color:"var(--color-text)",lineHeight:1.5,marginBottom:4}}>{comp.why}</div>
              {comp.colorNote && <div style={{fontSize:10,color:"var(--color-success)"}}>✓ {comp.colorNote}</div>}
              <VerdictRow gap={comp} verdicts={verdicts} onVerdict={onVerdict}/>
            </div>
          ))}
          <DroppedList dropped={results.dropped}/>
        </div>
      )}
    </div>
  );
}
