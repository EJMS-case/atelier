import { useState } from "react";
import { s } from "../ui/styles.js";
import { OCCASIONS } from "../constants/taxonomy.js";

export default function SaveLookModal({ look, lookItems, onSave, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const [logAsWorn, setLogAsWorn] = useState(false);
  const [dateWorn,  setDateWorn]  = useState(today);
  const [occasion,  setOccasion]  = useState(look.occasion || "Work");
  const [notes,     setNotes]     = useState("");
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        garment_ids: (look.items || []),
        date_worn: logAsWorn ? dateWorn : null,
        occasion,
        // Carry the weather the look was generated under (stamped in
        // normalizeLooks) so History/Saved capture it — enables a future
        // weather sort. Harmless if absent; saveOutfitLog strips unknown cols.
        weather: look.weather || null,
        weathers: look.weathers || null,
        notes: notes.trim() || null,
        collage_url: JSON.stringify({ mood: look.mood, styling: look.styling || look.why }),
      });
      setSaved(true);
      setTimeout(onClose, 1200);
    } catch (e) {
      console.error(e);
      setSaving(false);
    }
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modalCard} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <span style={s.modalTitle}>{logAsWorn ? "Log This Look" : "Save This Look"}</span>
          <button style={s.modalClose} onClick={onClose}>&times;</button>
        </div>
        {saved ? (
          <div style={{ padding:"40px 20px", textAlign:"center" }}>
            <div style={{ fontSize:28, marginBottom:10 }}>✓</div>
            <div style={{ fontSize:14, color:"var(--color-success)", letterSpacing:"0.06em" }}>
              {logAsWorn ? "Logged in your history" : "Saved to your looks"}
            </div>
          </div>
        ) : (
          <>
            <div style={s.modalLookPreview}>
              <div style={s.modalLookPieces}>{lookItems.map(it => it.name).join(" · ")}</div>
            </div>
            <div style={s.modalField}>
              <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontSize:11, letterSpacing:"0.08em", color:"#6B6460", fontWeight:500 }}>
                <input type="checkbox" checked={logAsWorn} onChange={e => setLogAsWorn(e.target.checked)}
                  style={{ width:14, height:14, accentColor:"#8B6F5E", cursor:"pointer" }}/>
                I wore this — log it in history
              </label>
            </div>
            {logAsWorn && (
              <div style={s.modalField}>
                <label style={s.modalLabel}>DATE WORN</label>
                <input type="date" value={dateWorn} onChange={e => setDateWorn(e.target.value)} style={s.modalInput}/>
              </div>
            )}
            <div style={s.modalField}>
              <label style={s.modalLabel}>OCCASION</label>
              <select value={occasion} onChange={e => setOccasion(e.target.value)} style={s.modalInput}>
                {OCCASIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div style={s.modalField}>
              <label style={s.modalLabel}>NOTES</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="How did it feel? Any styling notes…"
                rows={3} style={{...s.modalInput, resize:"vertical", fontFamily:"inherit"}}/>
            </div>
            <button style={s.modalSaveBtn} onClick={handleSave} disabled={saving}>
              {saving ? <><span style={s.spinnerSm}/> Saving…</> : (logAsWorn ? "Log in History" : "Save to Looks")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
