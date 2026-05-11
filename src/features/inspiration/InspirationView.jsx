// ── INSPIRATION VIEW ────────────────────────────────────────────────────────
// Upload + tag style references. Each image gets an AI-written vibe note on
// upload (one Claude call). That note — NOT the image — is what reaches the
// stylist prompt during outfit generation. This is deliberate:
// (1) keeps generation cheap (no image tokens per call),
// (2) prevents the AI from substituting inspo pieces for closet pieces.

import { useEffect, useMemo, useState } from "react";
import { s } from "../../ui/styles.js";
import { OCCASIONS } from "../../constants/taxonomy.js";
import { compressImage } from "../../utils/images.js";
import { listInspirations, createInspiration, deleteInspiration, updateInspiration } from "./inspirationApi.js";
import { summarizeInspiration } from "./summarize.js";

const WEATHERS = ["Hot", "Warm", "Mild", "Cool", "Cold"];

export default function InspirationView({ apiKey, onBack, items, setItems }) {
  const [loading, setLoading] = useState(items.length === 0);
  const [filter, setFilter] = useState({ occasion: "All", weather: "All" });
  const [uploadOcc, setUploadOcc] = useState("Casual");
  const [uploadWx, setUploadWx] = useState("Warm");
  const [queue, setQueue] = useState([]); // pending uploads: {id, status, error, occasion, weather}

  // Refresh from Supabase whenever the view mounts — App.jsx loads on first
  // boot, but other devices may have added rows since.
  useEffect(() => {
    (async () => {
      try {
        const rows = await listInspirations();
        setItems(rows);
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return items.filter(it => {
      if (filter.occasion !== "All" && it.occasion !== filter.occasion) return false;
      if (filter.weather  !== "All" && it.weather  !== filter.weather ) return false;
      return true;
    });
  }, [items, filter]);

  const handleFiles = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = "";
    if (!files.length) return;
    if (!apiKey) {
      alert("Add your Anthropic API key in Settings first — needed to generate the vibe summary.");
      return;
    }
    files.forEach(file => {
      const tempId = `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const raw = ev.target.result;
        const occasion = uploadOcc;
        const weather  = uploadWx;
        setQueue(q => [...q, { id: tempId, status: "summarizing", occasion, weather, preview: raw }]);
        try {
          // 1) Compress for upload, summarize the original for fidelity.
          const compressed = await compressImage(raw, 1024, 0.85, false);
          const vibe_text = await summarizeInspiration(raw, apiKey, { occasion, weather });
          setQueue(q => q.map(i => i.id === tempId ? { ...i, status: "uploading", vibe_text } : i));
          // 2) Persist row + image.
          const saved = await createInspiration({ image: compressed, occasion, weather, vibe_text });
          setItems([saved, ...items]);
          setQueue(q => q.filter(i => i.id !== tempId));
        } catch (err) {
          setQueue(q => q.map(i => i.id === tempId
            ? { ...i, status: "error", error: err.message || "Upload failed" }
            : i));
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleDelete = async (id) => {
    const before = items;
    setItems(items.filter(it => it.id !== id));
    try { await deleteInspiration(id); }
    catch { setItems(before); alert("Couldn't delete — try again."); }
  };

  const [editingId, setEditingId] = useState(null);
  const [editOcc, setEditOcc] = useState("");
  const [editWx, setEditWx] = useState("");

  const startEdit = (it) => { setEditingId(it.id); setEditOcc(it.occasion); setEditWx(it.weather); };
  const cancelEdit = () => { setEditingId(null); };
  const saveEdit = async (it) => {
    const before = items;
    const next = { ...it, occasion: editOcc, weather: editWx };
    setItems(items.map(i => i.id === it.id ? next : i));
    setEditingId(null);
    try { await updateInspiration(next); }
    catch { setItems(before); alert("Couldn't save changes — try again."); }
  };

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={s.pageTitle}>Inspiration</h2>
      </div>

      <p style={{...s.settingsSub, marginBottom:16}}>
        Upload 3–5 style references per occasion + weather combo. The AI reads the vibe (silhouette, color, mood) — never the items themselves — and uses it to bias looks built from <strong>your closet</strong>. Your closet is the only source of clothes; these images only set the feel.
      </p>

      {/* Upload card */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>✦ Add Inspiration</div>
        <p style={s.settingsSub}>Pick the occasion + weather these references belong to, then add photos.</p>

        <div style={{display:"flex", gap:10, marginBottom:10}}>
          <div style={{flex:1}}>
            <div style={s.fieldLabel}>Occasion</div>
            <select style={{...s.select, width:"100%"}} value={uploadOcc} onChange={e => setUploadOcc(e.target.value)}>
              {OCCASIONS.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div style={{flex:1}}>
            <div style={s.fieldLabel}>Weather</div>
            <select style={{...s.select, width:"100%"}} value={uploadWx} onChange={e => setUploadWx(e.target.value)}>
              {WEATHERS.map(w => <option key={w}>{w}</option>)}
            </select>
          </div>
        </div>

        <label style={{...s.btnPrimary, width:"100%", display:"inline-block", textAlign:"center", cursor:"pointer", boxSizing:"border-box"}}>
          Choose photos
          <input type="file" accept="image/*" multiple onChange={handleFiles} style={{display:"none"}}/>
        </label>

        {queue.length > 0 && (
          <div style={{marginTop:12, display:"flex", flexDirection:"column", gap:8}}>
            {queue.map(q => (
              <div key={q.id} style={{display:"flex", gap:10, alignItems:"center", fontSize:11, color:"var(--color-text-2)"}}>
                <img src={q.preview} alt="" style={{width:40, height:40, objectFit:"cover", borderRadius:4}}/>
                <div>
                  <div>{q.occasion} · {q.weather}</div>
                  <div style={{color: q.status === "error" ? "var(--color-danger)" : "var(--color-text-muted)"}}>
                    {q.status === "summarizing" && "Reading the vibe…"}
                    {q.status === "uploading"   && "Saving…"}
                    {q.status === "error"       && (q.error || "Failed")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{display:"flex", gap:10, marginTop:18, marginBottom:12, flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", marginBottom:4}}>OCCASION</div>
          <select style={s.select} value={filter.occasion} onChange={e => setFilter(f => ({...f, occasion: e.target.value}))}>
            <option>All</option>
            {OCCASIONS.map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", marginBottom:4}}>WEATHER</div>
          <select style={s.select} value={filter.weather} onChange={e => setFilter(f => ({...f, weather: e.target.value}))}>
            <option>All</option>
            {WEATHERS.map(w => <option key={w}>{w}</option>)}
          </select>
        </div>
      </div>

      {loading && <div style={{fontSize:12, color:"var(--color-text-muted)"}}>Loading…</div>}
      {!loading && filtered.length === 0 && (
        <div style={{fontSize:12, color:"var(--color-text-muted)", padding:"20px 4px"}}>
          No inspiration here yet. Add a few photos for each occasion + weather you wear most.
        </div>
      )}

      <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:12}}>
        {filtered.map(it => {
          const isEditing = editingId === it.id;
          return (
            <div key={it.id} style={{background:"var(--color-surface)", borderRadius:8, overflow:"hidden", border:"1px solid var(--color-border)"}}>
              <img src={it.image_url} alt="" loading="lazy" decoding="async" style={{width:"100%", height:180, objectFit:"cover", display:"block"}}/>
              <div style={{padding:8, fontSize:11}}>
                {isEditing ? (
                  <div style={{display:"flex", gap:6, marginBottom:6}}>
                    <select value={editOcc} onChange={e => setEditOcc(e.target.value)}
                      style={{...s.select, flex:1, fontSize:11, padding:"4px 6px"}}>
                      {OCCASIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
                    <select value={editWx} onChange={e => setEditWx(e.target.value)}
                      style={{...s.select, flex:1, fontSize:11, padding:"4px 6px"}}>
                      {WEATHERS.map(w => <option key={w}>{w}</option>)}
                    </select>
                  </div>
                ) : (
                  <div style={{color:"var(--color-text-muted)", marginBottom:4}}>{it.occasion} · {it.weather}</div>
                )}
                {it.vibe_text && (
                  <div style={{color:"var(--color-text)", marginBottom:8, lineHeight:1.4}}>{it.vibe_text}</div>
                )}
                {isEditing ? (
                  <div style={{display:"flex", gap:6}}>
                    <button style={{...s.btnPrimary, flex:1, padding:"6px 10px", fontSize:11}}
                      onClick={() => saveEdit(it)}>Save</button>
                    <button style={{...s.btnSecondary, flex:1, padding:"6px 10px", fontSize:11}}
                      onClick={cancelEdit}>Cancel</button>
                  </div>
                ) : (
                  <div style={{display:"flex", gap:6}}>
                    <button style={{...s.btnSecondary, flex:1, padding:"6px 10px", fontSize:11}}
                      onClick={() => startEdit(it)}>Edit</button>
                    <button style={{...s.btnSecondary, flex:1, padding:"6px 10px", fontSize:11}}
                      onClick={() => handleDelete(it.id)}>Remove</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
