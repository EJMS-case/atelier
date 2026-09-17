import { useEffect, useMemo, useState } from "react";
import { s, si } from "../ui/styles.js";
import { icons, Icon } from "../ui/icons.jsx";
import { useRun, startRun, RUN_KEYS } from "../lib/backgroundRun.js";
import { runShoppingAnalysis } from "../features/shopping/gapAnalysis.js";
import { loadBrandFinds, saveBrandFinds } from "../features/shopping/brandFinds.js";
import { recordVerdict, loadVerdicts } from "../features/shopping/verdicts.js";
import { gapKey } from "../features/shopping/verifyGaps.js";
import { STYLING_CATEGORY_ORDER } from "../constants/taxonomy.js";
import {
  closetColorProfile, colorCategoryCoverage, pairUnlocks, textureInventory,
  seasonForDate, hexForColorLabel,
} from "../utils/wardrobe-coverage.js";

// The deterministic half of the gap analysis, rendered as FACTS before any AI
// runs (owner, 2026-08-20: "gap analysis didn't move" — the coverage math was
// feeding the prompt invisibly; now the navy-bag class of finding is on
// screen the moment the tab opens, and the AI's job is products, not math).
function CoveragePanel({ items }) {
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
  const famLabel = (f) => {
    const shade = profile.dominantShade(f);
    return shade && shade.toLowerCase() !== f.toLowerCase() ? `${shade}` : f;
  };
  const swatch = (label) => (
    <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 8 }}>
      <span style={{ width: 10, height: 10, borderRadius: "50%", display: "inline-block", background: hexForColorLabel(label), boxShadow: "0 0 0 1px rgba(0,0,0,0.12)" }}/>
      {label}
    </span>
  );
  return (
    <div style={{ ...si.card, marginBottom: 16 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.16em", color: "var(--color-text-muted)", marginBottom: 8 }}>
        WHAT THE NUMBERS SAY · computed from your closet, no AI
      </div>
      {coverage.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "var(--color-text-2)", marginBottom: 4 }}>Core colors missing from anchor categories:</div>
          {coverage.map(c => (
            <div key={c.category} style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.7 }}>
              <strong>{c.category}</strong>: no {c.missingCore.map(f => swatch(famLabel(f)))}
            </div>
          ))}
        </div>
      )}
      {unlocks.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "var(--color-text-2)", marginBottom: 4 }}>Pairings one purchase away:</div>
          {unlocks.map(u => (
            <div key={u.label} style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.55 }}>
              <strong>{u.label}</strong> — you own {u.haveCount} {u.haveLabel.toLowerCase()} pieces and zero {u.needLabel.toLowerCase()}.
            </div>
          ))}
        </div>
      )}
      {(textures.missing.length > 0 || textures.thin.length > 0) && (
        <div style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.55 }}>
          <div style={{ fontSize: 11, color: "var(--color-text-2)", marginBottom: 4 }}>Textures for {season}:</div>
          {textures.missing.length > 0 && <div>Missing: {textures.missing.join(", ")}</div>}
          {textures.thin.length > 0 && <div style={{ color: "var(--color-text-2)" }}>Thin (1–2 pieces): {textures.thin.join(", ")}</div>}
        </div>
      )}
      {coverage.length === 0 && unlocks.length === 0 && textures.missing.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No structural color or texture holes — the numbers say your closet is covered; the AI hunt below is for upgrades.</div>
      )}
    </div>
  );
}

// ── Her brand finds — the editor ─────────────────────────────────────────────
// Name + the categories she'd shop there + an optional link. Stored
// cross-device (features/shopping/brandFinds.js); read by the gap analysis,
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
            Labels you found and want to buy from, mapped to what you'd buy there. The gap analysis names them when a pick fits, and Brand Atlas stops re-scouting them.
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
  const opts = [["own", "I own this"], ["no", "Not for me"], ["yes", "Want it"]];
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
  useEffect(() => {
    let alive = true;
    loadBrandFinds().then(list => { if (alive) setFinds(list); }).catch(() => {});
    loadVerdicts().then(list => { if (alive) setVerdicts(list); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const updateFinds = (list) => { setFinds(list); saveBrandFinds(list).catch(() => {}); };
  const onVerdict = (gap, verdict) => { recordVerdict(gap, verdict).then(setVerdicts).catch(() => {}); };

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
        {[["gap","Gap Analysis"],["complete","Complete a Look"]].map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m); setLocalErr(""); }}
            style={{...s.modeTab, ...(mode === m ? s.modeTabActive : {})}}>{label}</button>
        ))}
      </div>

      {mode === "gap" && (
        <>
          <div style={s.advisorNote}>The numbers below are computed live from everything you own, both closets; Run Gap Analysis turns them (plus what you pay, who you buy from, your finds, the rooms you dress for, and the season) into specific pieces to buy — then checks every pick against your closet before you see it.</div>
          <CoveragePanel items={owned}/>
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
        {loading ? <><span style={s.spinnerSmLight}/> Analyzing…</> : <><Icon path={icons.sparkle} size={15}/> {mode === "gap" ? (results ? "Run Gap Analysis again" : "Run Gap Analysis") : `Find Pieces (${selectedIds.length} selected)`}</>}
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
            {results.gaps.length === 0 ? "NOTHING GENUINELY MISSING" : `${results.gaps.length} GAP${results.gaps.length === 1 ? "" : "S"} FOUND`}
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
