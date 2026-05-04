import { useState, useRef } from "react";
import { s } from "../ui/styles.js";
import { icons, Icon } from "../ui/icons.jsx";
import { sb, SUPABASE_URL } from "../lib/supabase.js";
import { compressImage, imageToBase64, removeBackground } from "../utils/images.js";
import { loadStylePrefs, saveStylePrefs, loadAboutMe, saveAboutMe } from "../utils/storage.js";
import { CATEGORY_ORDER } from "../constants/taxonomy.js";

export default function SettingsView({ apiKey, rmbgKey, onSave, onBack, items = [], onUpdateItem, onAddItems, onForceSync }) {
  const [key,          setKey]          = useState(apiKey);
  const [rmbg,         setRmbg]         = useState(rmbgKey);
  const [showK,        setShowK]        = useState(false);
  const [showR,        setShowR]        = useState(false);
  const [prefs,        setPrefs]        = useState(() => loadStylePrefs());
  const [newPair,      setNewPair]      = useState("");
  const [aboutMe,      setAboutMe]      = useState(() => loadAboutMe());
  const [aboutMeOpen,  setAboutMeOpen]  = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [fSyncRunning, setFSyncRunning] = useState(false);
  const [fSyncProg,    setFSyncProg]    = useState(null);
  const [fSyncDone,    setFSyncDone]    = useState(null);
  const [batchProgress,setBatchProgress]= useState({ done: 0, total: 0, errors: 0 });
  const [batchDone,    setBatchDone]    = useState(false);
  const batchStop = useRef(false);

  // ── Recover Lost Items state
  const [recoverOpen,    setRecoverOpen]    = useState(false);
  const [orphans,        setOrphans]        = useState([]);
  const [scanRunning,    setScanRunning]    = useState(false);
  const [scanDone,       setScanDone]       = useState(false);
  const [orphanMeta,     setOrphanMeta]     = useState({}); // { [imageId]: { name, category, subcategory, color_family } }
  const [aiCatRunning,   setAiCatRunning]   = useState(false);

  const handleScanStorage = async () => {
    setScanRunning(true); setScanDone(false); setOrphans([]);
    try {
      const [allImages, dbItems] = await Promise.all([sb.listStorageImages(), sb.fetchAll()]);
      const dbIds = new Set(dbItems.map(it => it.id));
      const found = allImages.filter(name => !dbIds.has(name));
      setOrphans(found);
      const initialMeta = {};
      found.forEach(id => { initialMeta[id] = { name: "Item", category: "Tops", subcategory: "", color_family: "" }; });
      setOrphanMeta(initialMeta);
    } catch(e) {
      console.error("Scan failed:", e);
    }
    setScanRunning(false); setScanDone(true);
  };

  const handleAiCategorize = async () => {
    if (!key || orphans.length === 0) return;
    setAiCatRunning(true);
    for (const imageId of orphans) {
      const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/wardrobe-images/${imageId}`;
      try {
        let base64 = null;
        try {
          const resp = await fetch(imageUrl);
          const blob = await resp.blob();
          base64 = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(",")[1]);
            reader.readAsDataURL(blob);
          });
        } catch { /* skip if image can't be fetched */ }
        if (!base64) continue;
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: "claude-opus-4-5",
            max_tokens: 256,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
                { type: "text", text: `Look at this clothing item photo. Return JSON with: name (descriptive name), category (one of: Tops/Knits/Bottoms/Dresses/Sets/Jumpsuits/Loungewear/Athleisure/Outerwear/Occasionwear/Shoes/Accessories), subcategory (specific type), color_family (main color). Return only valid JSON.` },
              ],
            }],
          }),
        });
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const text = aiData.content?.[0]?.text || "";
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            try {
              const parsed = JSON.parse(match[0]);
              setOrphanMeta(prev => ({ ...prev, [imageId]: {
                name: parsed.name || "Item",
                category: parsed.category || "Tops",
                subcategory: parsed.subcategory || "",
                color_family: parsed.color_family || "",
              }}));
            } catch { /* bad JSON, skip */ }
          }
        }
      } catch(e) {
        console.error("AI categorize failed for", imageId, e);
      }
    }
    setAiCatRunning(false);
  };

  const handleAddOrphan = async (imageId) => {
    const meta = orphanMeta[imageId] || {};
    const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/wardrobe-images/${imageId}`;
    const newItem = {
      id: imageId,
      name: meta.name || "Item",
      category: meta.category || "Tops",
      subcategory: meta.subcategory || "",
      color_family: meta.color_family || "",
      image: imageUrl,
      created_at: new Date().toISOString(),
    };
    try {
      if (onAddItems) {
        await onAddItems([newItem]);
      } else {
        await sb.upsert(newItem);
      }
      setOrphans(prev => prev.filter(id => id !== imageId));
    } catch(e) {
      console.error("Failed to add orphan item:", e);
    }
  };

  const updatePrefs = (updated) => { setPrefs(updated); saveStylePrefs(updated); };
  const updateAboutMe = (updated) => { setAboutMe(updated); saveAboutMe(updated); };

  const handleBatchBgRemoval = async () => {
    if (!rmbg) return;
    const toProcess = items.filter(it => it.image);
    if (!toProcess.length) return;
    batchStop.current = false;
    setBatchRunning(true); setBatchDone(false);
    setBatchProgress({ done: 0, total: toProcess.length, errors: 0 });
    let errors = 0;
    for (let i = 0; i < toProcess.length; i++) {
      if (batchStop.current) break;
      const item = toProcess[i];
      try {
        const base64 = await imageToBase64(item.image);
        const cleaned = await removeBackground(base64, rmbg);
        const compressed = await compressImage(cleaned, 600, 0.9, true);
        const url = await sb.uploadImage(item.id, compressed);
        if (onUpdateItem) await onUpdateItem(item.id, { image: url });
      } catch { errors++; }
      setBatchProgress({ done: i + 1, total: toProcess.length, errors });
    }
    setBatchRunning(false); setBatchDone(true);
  };
  const removePair  = (i) => updatePrefs({ ...prefs, colorPairs: prefs.colorPairs.filter((_, idx) => idx !== i) });
  const addPair     = () => {
    if (!newPair.trim()) return;
    updatePrefs({ ...prefs, colorPairs: [...prefs.colorPairs, newPair.trim()] });
    setNewPair("");
  };

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={s.pageTitle}>Settings</h2>
      </div>

      {/* Anthropic key */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}><Icon path={icons.key} size={16}/> Anthropic API Key</div>
        <p style={s.settingsSub}>
          Required to generate outfit looks. Stored locally on your device only.
        </p>
        <div style={{position:"relative"}}>
          <input type={showK?"text":"password"} placeholder="sk-ant-..."
            value={key} onChange={e=>setKey(e.target.value)}
            style={{...s.input,width:"100%",fontFamily:"monospace",fontSize:13,paddingRight:60}}/>
          <button style={s.showHideBtn} onClick={()=>setShowK(v=>!v)}>
            {showK?"hide":"show"}
          </button>
        </div>
        <p style={{...s.settingsSub,marginTop:6}}>
          Get your key at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{color:"var(--color-ink)"}}>console.anthropic.com</a>
        </p>
      </div>

      {/* Remove.bg key */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>✦ Remove.bg API Key</div>
        <p style={s.settingsSub}>
          Automatically removes backgrounds from clothing photos on upload. Free tier includes 50 images/month.
        </p>
        <div style={{position:"relative"}}>
          <input type={showR?"text":"password"} placeholder="your-removebg-key"
            value={rmbg} onChange={e=>setRmbg(e.target.value)}
            style={{...s.input,width:"100%",fontFamily:"monospace",fontSize:13,paddingRight:60}}/>
          <button style={s.showHideBtn} onClick={()=>setShowR(v=>!v)}>
            {showR?"hide":"show"}
          </button>
        </div>
        <p style={{...s.settingsSub,marginTop:6}}>
          Get your free key at <a href="https://www.remove.bg/api" target="_blank" rel="noreferrer" style={{color:"var(--color-ink)"}}>remove.bg/api</a>
        </p>
      </div>

      {/* Style Preferences */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>✦ Style Preferences</div>
        <p style={s.settingsSub}>These are injected into every outfit generation.</p>

        <div style={s.fieldLabel}>Favorite color-blocking pairs</div>
        {prefs.colorPairs.map((pair, i) => (
          <div key={i} style={{display:"flex", alignItems:"center", gap:8, marginBottom:6}}>
            <span style={{flex:1, fontSize:12, color:"var(--color-text)"}}>{pair}</span>
            <button onClick={() => removePair(i)} style={{background:"none",border:"none",color:"var(--color-border-muted)",cursor:"pointer",fontSize:13}}>✕</button>
          </div>
        ))}
        <div style={{display:"flex", gap:8, marginTop:6, marginBottom:14}}>
          <input style={{...s.input, flex:1, fontSize:12}} placeholder="e.g. Navy + Cool Red"
            value={newPair} onChange={e => setNewPair(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addPair()}/>
          <button style={s.btnPrimary} onClick={addPair}>Add</button>
        </div>

        <div style={s.fieldLabel}>Style modes</div>
        {[["monochromaticMode","Monochromatic looks"],["tonalPairing","Tonal pairing (e.g. navy + powder blue)"]].map(([key,label]) => (
          <label key={key} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--color-text)",cursor:"pointer",marginBottom:8}}>
            <input type="checkbox" checked={prefs[key]}
              onChange={e => updatePrefs({ ...prefs, [key]: e.target.checked })}/>
            {label}
          </label>
        ))}
      </div>

      {/* About Me */}
      <div style={s.settingsCard}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer"}} onClick={() => setAboutMeOpen(v => !v)}>
          <div style={s.settingsTitle}>✦ About Me</div>
          <span style={{fontSize:12, color:"var(--color-text-muted)"}}>{aboutMeOpen ? "▲ Collapse" : "▼ Expand"}</span>
        </div>
        <p style={s.settingsSub}>Body descriptors + life context injected into outfit generation. Optional — add what's relevant.</p>
        {aboutMeOpen && (
          <div style={{marginTop:12}}>
            <div style={s.fieldLabel}>Height</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. 5'7&quot;"
              value={aboutMe.height || ""} onChange={e => updateAboutMe({...aboutMe, height: e.target.value})}/>

            <div style={s.fieldLabel}>Torso length</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Long torso, short legs"
              value={aboutMe.torsoLength || ""} onChange={e => updateAboutMe({...aboutMe, torsoLength: e.target.value})}/>

            <div style={s.fieldLabel}>Fit notes</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Prefer relaxed shoulders, avoid cropped"
              value={aboutMe.fitNotes || ""} onChange={e => updateAboutMe({...aboutMe, fitNotes: e.target.value})}/>

            <div style={s.fieldLabel}>Proportions</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Narrow shoulders, fuller hips"
              value={aboutMe.proportions || ""} onChange={e => updateAboutMe({...aboutMe, proportions: e.target.value})}/>

            <div style={s.fieldLabel}>Age range</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Late 30s"
              value={aboutMe.ageRange || ""} onChange={e => updateAboutMe({...aboutMe, ageRange: e.target.value})}/>

            <div style={s.fieldLabel}>Professional context</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Creative director, client-facing, WFH 3 days/week"
              value={aboutMe.professionalContext || ""} onChange={e => updateAboutMe({...aboutMe, professionalContext: e.target.value})}/>
          </div>
        )}
      </div>

      {/* Batch Background Removal */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>✦ Retroactive Background Removal</div>
        <p style={s.settingsSub}>
          Re-processes all {items.filter(it=>it.image).length} wardrobe photos through Remove.bg to get transparent PNG backgrounds for cleaner collages. Uses 1 credit per item.
        </p>
        {!batchRunning && !batchDone && (
          <button style={{...s.btnPrimary, width:"100%"}} onClick={handleBatchBgRemoval}
            disabled={!rmbg || items.filter(it=>it.image).length === 0}>
            {!rmbg ? "Add Remove.bg key above first" : `Process All ${items.filter(it=>it.image).length} Photos`}
          </button>
        )}
        {batchRunning && (
          <div>
            <div style={{...s.auditProgressTrack, marginBottom:8}}>
              <div style={{...s.auditProgressBar, width:`${(batchProgress.done/batchProgress.total)*100}%`}}/>
            </div>
            <div style={{fontSize:11, color:"var(--color-text-2)", marginBottom:8}}>
              {batchProgress.done} / {batchProgress.total} done
              {batchProgress.errors > 0 && ` · ${batchProgress.errors} skipped`}
            </div>
            <button style={{...s.btnPrimary, background:"var(--color-danger)", width:"100%"}}
              onClick={() => { batchStop.current = true; }}>
              Stop
            </button>
          </div>
        )}
        {batchDone && (
          <div style={{fontSize:12, color:"var(--color-success)", fontWeight:500}}>
            ✓ Done — {batchProgress.done - batchProgress.errors} updated
            {batchProgress.errors > 0 && `, ${batchProgress.errors} skipped`}
            <button style={{...s.btnPrimary, width:"100%", marginTop:8}}
              onClick={() => { setBatchDone(false); setBatchProgress({done:0,total:0,errors:0}); }}>
              Run Again
            </button>
          </div>
        )}
      </div>

      <button style={{...s.btnPrimary,width:"100%"}}
        onClick={() => onSave(key, rmbg)} disabled={!key.trim()}>
        Save Settings
      </button>

      {/* Recover Lost Items */}
      <div style={{...s.settingsCard, marginTop:16}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer"}} onClick={() => setRecoverOpen(v => !v)}>
          <div style={s.settingsTitle}>✦ Recover Lost Items</div>
          <span style={{fontSize:12, color:"var(--color-text-muted)"}}>{recoverOpen ? "▲ Collapse" : "▼ Expand"}</span>
        </div>
        <p style={s.settingsSub}>Scan Supabase Storage for photos that aren't linked to any wardrobe item.</p>
        {recoverOpen && (
          <div style={{marginTop:14}}>
            <div style={{display:"flex", gap:8, marginBottom:12, flexWrap:"wrap"}}>
              <button style={{...s.btnPrimary, flex:1}} onClick={handleScanStorage} disabled={scanRunning}>
                {scanRunning ? (
                  <><span style={s.spinnerSm}/>  Scanning...</>
                ) : "Scan Storage"}
              </button>
              {orphans.length > 0 && (
                <button style={{...s.btnPrimary, flex:1, background: aiCatRunning ? "var(--color-text-2)" : "var(--color-ink)"}}
                  onClick={handleAiCategorize} disabled={aiCatRunning || !key}>
                  {aiCatRunning ? (
                    <><span style={s.spinnerSm}/>  Categorizing...</>
                  ) : key ? "AI Categorize All" : "Add API key above"}
                </button>
              )}
            </div>
            {scanDone && orphans.length === 0 && (
              <div style={{fontSize:12, color:"var(--color-success)", fontWeight:500, marginBottom:8}}>
                No orphaned photos found — all storage images are linked to wardrobe items.
              </div>
            )}
            {orphans.length > 0 && (
              <div>
                <div style={{fontSize:12, color:"var(--color-text-2)", marginBottom:10}}>
                  Found {orphans.length} unlinked photo{orphans.length !== 1 ? "s" : ""}. Fill in details and add to wardrobe.
                </div>
                <div style={{display:"flex", flexDirection:"column", gap:14}}>
                  {orphans.map(imageId => {
                    const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/wardrobe-images/${imageId}`;
                    const meta = orphanMeta[imageId] || { name: "Item", category: "Tops" };
                    return (
                      <div key={imageId} style={{display:"flex", gap:12, alignItems:"flex-start", background:"var(--color-surface)", borderRadius:8, padding:12}}>
                        <img src={imageUrl} alt="orphan"
                          style={{width:72, height:90, objectFit:"contain", borderRadius:5, background:"#fff", flexShrink:0, border:"1px solid var(--color-border)"}}/>
                        <div style={{flex:1, display:"flex", flexDirection:"column", gap:6}}>
                          <div style={s.fieldLabel}>Name</div>
                          <input style={{...s.input, width:"100%", boxSizing:"border-box", fontSize:12}}
                            value={meta.name}
                            onChange={e => setOrphanMeta(prev => ({...prev, [imageId]: {...meta, name: e.target.value}}))}/>
                          <div style={s.fieldLabel}>Category</div>
                          <select style={{...s.input, width:"100%", boxSizing:"border-box", fontSize:12}}
                            value={meta.category}
                            onChange={e => setOrphanMeta(prev => ({...prev, [imageId]: {...meta, category: e.target.value}}))}>
                            {CATEGORY_ORDER.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          {meta.color_family && (
                            <div style={{fontSize:11, color:"var(--color-text-muted)"}}>Color: {meta.color_family}</div>
                          )}
                          <button style={{...s.btnPrimary, marginTop:4, fontSize:11, padding:"7px 14px"}}
                            onClick={() => handleAddOrphan(imageId)}>
                            Add to Wardrobe
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Force Sync ── */}
      {onForceSync && (
        <div style={{...s.settingsCard, marginTop:16, borderColor: fSyncDone?.failed > 0 ? "var(--color-danger)" : fSyncDone ? "var(--color-success)" : "#E8DDD5"}}>
          <div style={s.settingsTitle}>Sync Wardrobe to Cloud</div>
          <p style={s.settingsSub}>
            Saves all {items.length} items from this browser directly to Supabase — use this after a bulk upload or if items aren't appearing on other devices. Do this before refreshing.
          </p>
          {fSyncProg && (
            <div style={{marginBottom:10}}>
              <div style={{height:6, background:"var(--color-border-soft)", borderRadius:3, overflow:"hidden", marginBottom:6}}>
                <div style={{height:"100%", width:`${Math.round((fSyncProg.done/fSyncProg.total)*100)}%`,
                  background: fSyncProg.failed > 0 ? "var(--color-danger)" : "#8B6F5E", borderRadius:3, transition:"width 0.3s"}}/>
              </div>
              <div style={{fontSize:11, color:"#6B6460"}}>
                {fSyncRunning
                  ? `Syncing ${fSyncProg.done} / ${fSyncProg.total}…`
                  : `Done — ${fSyncDone?.done} synced${fSyncDone?.failed ? `, ${fSyncDone.failed} failed` : " ✓"}`}
              </div>
            </div>
          )}
          <button style={{...s.settingsBtn, background: fSyncDone && !fSyncDone.failed ? "var(--color-success)" : "#8B6F5E"}}
            onClick={async () => {
              setFSyncRunning(true); setFSyncDone(null);
              setFSyncProg({ done: 0, total: items.length, failed: 0 });
              const result = await onForceSync((done, total, failed) =>
                setFSyncProg({ done, total, failed })
              );
              setFSyncRunning(false); setFSyncDone(result);
            }}
            disabled={fSyncRunning}>
            {fSyncRunning
              ? <><span style={s.spinnerSm}/> Syncing…</>
              : fSyncDone
                ? (fSyncDone.failed ? "⚠ Some failed — tap to retry" : "✓ All Synced to Supabase")
                : `Sync All ${items.length} Items to Supabase`}
          </button>
        </div>
      )}

      <div style={{...s.settingsCard, marginTop:16}}>
        <div style={s.settingsTitle}>About Atelier</div>
        <p style={s.settingsSub}>
          Your wardrobe is stored in Supabase. Photos are stored in Supabase Storage and synced across devices. Item names and details are sent to Claude for styling suggestions.
        </p>
      </div>
    </div>
  );
}
