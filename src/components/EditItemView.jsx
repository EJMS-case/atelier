import { useState } from "react";
import { s } from "../ui/styles.js";
import { CATEGORY_ORDER, TAXONOMY, SUBCATEGORY_L3, getSubcatL2 } from "../constants/taxonomy.js";
import { costPerWear } from "../features/wear/wearApi.js";
import { stripBackground } from "../lib/bgRemoval.js";
import { imageToBase64, trimTransparentBorders } from "../utils/images.js";

export default function EditItemView({ item, allItems, onSave, onSaveSetMeta, onDelete, onBack, setsMeta: setsMetaProp, rmbgKey, onStyleAround }) {
  const [form, setForm] = useState({
    name: item.name, category: item.category, subcategory: item.subcategory || "",
    brand: item.brand || "", color: item.color || "", notes: item.notes || "",
    image: item.image || "", set_id: item.set_id || "", is_separable: item.is_separable ?? true,
    material: item.material || "",
    pattern: item.pattern || "",
    price_paid: item.price_paid ?? null,
    has_bg: item.has_bg,
    is_trimmed: item.is_trimmed,
  });
  const [preview, setPreview] = useState(item.image || null);
  const [setName, setSetName] = useState(() => (setsMetaProp || {})[item.set_id]?.name || "");
  const [confirm, setConfirm] = useState(false);
  const [bgState, setBgState] = useState("idle"); // idle | running | success | error
  const [bgError, setBgError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Every set that already has members, in closet order, with a label that
  // stays distinguishable when the set has no name yet — an unnamed set used to
  // render as a bare "Unnamed Set", so several of them were indistinguishable
  // and picking the right one for the second piece was guesswork.
  const existingSets = (() => {
    const order = [];
    const byId = new Map();
    for (const it of allItems || []) {
      if (!it.set_id) continue;
      if (!byId.has(it.set_id)) { byId.set(it.set_id, []); order.push(it.set_id); }
      byId.get(it.set_id).push(it);
    }
    return order.map(id => {
      const members = byId.get(id);
      const name = (setsMetaProp || {})[id]?.name;
      const who = members.map(m => m.name).filter(Boolean).slice(0, 2).join(", ");
      return { id, count: members.length, name: name || "", label: name || (who ? `Unnamed — ${who}` : "Unnamed Set") };
    });
  })();

  // Async save wrapper. Awaits the parent's onSave (which returns {ok,error}),
  // shows a clear error if it failed, and only signals "done" on success so
  // the parent can navigate away. Without this, the previous fire-and-forget
  // save would lose changes whenever the network blipped.
  const handleSave = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      // Persist the set's name before the item, so the set is already
      // identifiable in this dropdown by the time she opens its partner piece.
      if (onSaveSetMeta && form.set_id) {
        const current = (setsMetaProp || {})[form.set_id]?.name || "";
        if (setName.trim() !== current) onSaveSetMeta(form.set_id, { name: setName.trim() });
      }
      const result = await onSave(form);
      if (result && result.ok === false) {
        setSaveError(result.error || "Couldn't save. Try again.");
        setSaving(false);
        return;
      }
      // onSave is responsible for navigating away on success.
    } catch (e) {
      setSaveError(e.message || "Couldn't save. Try again.");
      setSaving(false);
    }
  };

  const handleImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setPreview(ev.target.result);
      setForm(f=>({...f,image:ev.target.result, has_bg: undefined, is_trimmed: undefined}));
      setBgState("idle"); setBgError("");
    };
    reader.readAsDataURL(file);
  };

  const handleStripBackground = async () => {
    if (!preview) return;
    setBgState("running"); setBgError("");
    try {
      const base64 = await imageToBase64(preview);
      const result = await stripBackground(base64, { rmbgKey });
      if (result.has_bg) {
        // Both Remove.bg (or missing key) and the imgly fallback gave up.
        setBgState("error");
        setBgError(rmbgKey
          ? "Background removal failed — Remove.bg returned an error and the local fallback isn't available. Try a clearer photo or check your API credit balance."
          : "Add a Remove.bg API key in Settings to strip backgrounds (or upload a photo that's already transparent).");
        return;
      }
      // Trim transparent border so the saved photo is tight to the visible
      // piece. The bg removal almost always leaves padding around the item.
      const trimmed = await trimTransparentBorders(result.image);
      setPreview(trimmed);
      setForm(f => ({...f, image: trimmed, has_bg: false, is_trimmed: true}));
      setBgState("success");
    } catch (e) {
      setBgState("error");
      setBgError(e.message || "Background removal failed.");
    }
  };

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={s.pageTitle}>Edit Item</h2>
      </div>

      <label style={{...s.dropZone, marginBottom:10}}>
        {preview
          ? <img src={preview} alt="preview" style={{width:"100%",height:240,objectFit:"contain",display:"block",background:"#EEEAE4"}}/>
          : <div style={s.dropInner}><div style={s.dropIcon}>✦</div><div style={s.dropSub}>Tap to change photo</div></div>}
        <input type="file" accept="image/*" onChange={handleImage} style={{display:"none"}}/>
      </label>

      {/* Per-item background removal — works against the current preview, so
          users can clean up legacy uploads without going through Settings. */}
      {preview && (
        <div style={{marginBottom:20}}>
          <button
            style={{...s.btnSecondary, width:"100%"}}
            onClick={handleStripBackground}
            disabled={bgState === "running" || form.has_bg === false}>
            {bgState === "running"
              ? "Removing background…"
              : form.has_bg === false
                ? "✓ Background already removed"
                : "Remove Background"}
          </button>
          {bgState === "success" && (
            <div style={{fontSize:11, color:"var(--color-success)", marginTop:6}}>
              ✓ Background removed. Tap Save Changes to keep it.
            </div>
          )}
          {bgState === "error" && (
            <div style={{fontSize:11, color:"var(--color-danger)", marginTop:6}}>
              {bgError}
            </div>
          )}
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
        {[
          ["Name *","name","e.g. Wool Blazer Navy"],
          ["Brand","brand","e.g. Totême, The Row, COS"],
          ["Color","color","e.g. Burgundy, Navy, Espresso"],
          ["Notes","notes","e.g. cropped, chunky knit, cashmere"],
        ].map(([label,field,placeholder]) => (
          <div key={field}>
            <div style={s.fieldLabel}>{label}</div>
            <input style={{...s.input,width:"100%"}} placeholder={placeholder}
              value={form[field]} onChange={e=>setForm(f=>({...f,[field]:e.target.value}))}/>
          </div>
        ))}

        <div style={{display:"flex",gap:10}}>
          <div style={{flex:1}}>
            <div style={s.fieldLabel}>Material</div>
            <input style={{...s.input,width:"100%"}} placeholder="silk, wool, denim…"
              value={form.material}
              onChange={e=>setForm(f=>({...f,material:e.target.value}))}/>
          </div>
          <div style={{flex:1}}>
            <div style={s.fieldLabel}>Pattern</div>
            <select style={{...s.select,width:"100%"}} value={form.pattern}
              onChange={e=>setForm(f=>({...f,pattern:e.target.value}))}>
              <option value="">—</option>
              {["solid","striped","plaid","floral","abstract","animal","polka-dot"].map(p=><option key={p}>{p}</option>)}
            </select>
          </div>
        </div>


        {/* F6 — purchase price for cost-per-wear */}
        <div>
          <div style={s.fieldLabel}>Purchase price (USD, optional)</div>
          <input type="number" min="0" step="1" style={{...s.input,width:"100%"}}
            placeholder="e.g. 450"
            value={form.price_paid ?? ""}
            onChange={e => setForm(f => ({...f, price_paid: e.target.value === "" ? null : Number(e.target.value)}))}/>
          {item.wear_count > 0 && costPerWear(item) !== null && (
            <div style={{fontSize:11, color:"var(--color-text)", marginTop:4}}>
              Cost-per-wear so far: <strong>${costPerWear(item).toFixed(2)}</strong> · {item.wear_count} wears
            </div>
          )}
        </div>
        <div>
          <div style={s.fieldLabel}>Category</div>
          <select style={{...s.select,width:"100%"}} value={form.category}
            onChange={e=>setForm(f=>({...f,category:e.target.value,subcategory:""}))}>
            {CATEGORY_ORDER.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        {TAXONOMY[form.category]?.length > 0 && (() => {
          const l2 = getSubcatL2(form.category, form.subcategory);
          const l3Options = SUBCATEGORY_L3[l2] || [];
          const l3Val = (l2 && l2 !== form.subcategory) ? form.subcategory : "";
          return (
            <>
              <div>
                <div style={s.fieldLabel}>Subcategory</div>
                <select style={{...s.select,width:"100%"}} value={l2}
                  onChange={e => setForm(f => ({...f, subcategory: e.target.value, category: f.category}))}>
                  <option value="">— Select subcategory —</option>
                  {TAXONOMY[form.category].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              {l3Options.length > 0 && (
                <div>
                  <div style={s.fieldLabel}>Type</div>
                  <select style={{...s.select,width:"100%"}} value={l3Val}
                    onChange={e => setForm(f => ({...f, subcategory: e.target.value}))}>
                    <option value="">— Select type —</option>
                    {l3Options.map(opt => <option key={opt}>{opt}</option>)}
                  </select>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Set linking */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>Coord Set</div>
        <p style={s.settingsSub}>Link this piece to a coord set, or create a new one.</p>
        <div style={s.fieldLabel}>Set</div>
        <select style={{...s.select, width:"100%", marginBottom:10}}
          value={form.set_id}
          onChange={e => {
            const val = e.target.value;
            if (val === "__new__") {
              const newId = crypto.randomUUID();
              // A brand-new set starts with this piece alone, so it is a member
              // of a multi-piece set, not a two-piece stored as one item —
              // separable by default. Without this a "Sets" garment carrying the
              // column default (is_separable false) was silently linked LOCKED.
              setForm(f => ({ ...f, set_id: newId, is_separable: true }));
              setSetName("");
            } else if (val === "") {
              // Clearing set membership must also clear is_separable — otherwise
              // a stale `true` flag leaks in and the "Part of Set" badge + filter
              // silently treat the orphan as separable.
              setForm(f => ({ ...f, set_id: "", is_separable: false }));
              setSetName("");
            } else {
              // Joining an existing set: same reasoning as above — a piece that
              // was stored as a standalone complete set becomes one member of a
              // multi-piece set the moment it is linked.
              setForm(f => ({ ...f, set_id: val, is_separable: f.set_id ? f.is_separable : true }));
              setSetName(existingSets.find(g => g.id === val)?.name || "");
            }
          }}>
          <option value="">— Not part of a set —</option>
          <option value="__new__">+ Create new set</option>
          {/* The just-created set has no members yet, so it is absent from the
              list below. Without an option carrying its id the select matches
              nothing and silently falls back to displaying "— Not part of a
              set —", which read as "creating a set did nothing". */}
          {form.set_id && !existingSets.some(g => g.id === form.set_id) && (
            <option value={form.set_id}>{setName.trim() || "New set"} — not saved yet</option>
          )}
          {existingSets.map(g => (
            <option key={g.id} value={g.id}>
              {g.label} ({g.count} piece{g.count !== 1 ? "s" : ""})
            </option>
          ))}
        </select>

        {form.set_id && (
          // Naming the set lived only in the Sets tab, so a set created here
          // stayed "Unnamed Set" — and every unnamed set renders identically in
          // this dropdown, making the second piece impossible to link reliably.
          <div style={{ marginBottom: 10 }}>
            <div style={s.fieldLabel}>Set name</div>
            <input style={{...s.input, width:"100%"}} value={setName}
              placeholder="e.g. Navy Work Set, Weekend Linen"
              onChange={e => setSetName(e.target.value)}/>
          </div>
        )}

        {form.set_id ? (
          // Linked into a multi-piece set: she chooses whether the piece also
          // stands on its own. This control must win over the "Sets"-category
          // branch below — a linked half is never a complete two-piece, and
          // gating it on category left every linked "Sets" garment stuck LOCKED.
          <label style={{display:"flex", alignItems:"center", gap:8, fontSize:12, color:"var(--color-text)", cursor:"pointer"}}>
            <input type="checkbox" checked={form.is_separable !== false}
              onChange={e => setForm(f => ({ ...f, is_separable: e.target.checked }))}/>
            Show as individual piece in its own category (separable)
          </label>
        ) : form.category === "Sets" ? (
          // A "Sets" item stored as one piece: let her declare whether it's a
          // complete two-piece to keep together (styled as one look, like a
          // dress) or pieces she also wears apart. Checked = keep together =
          // is_separable false. This is the control that was missing for a
          // single-item set (the old checkbox only appeared once a set_id link
          // existed), so a set she never split had no way to be marked as one.
          <label style={{display:"flex", alignItems:"flex-start", gap:8, fontSize:12, color:"var(--color-text)", cursor:"pointer"}}>
            <input type="checkbox" checked={form.is_separable === false}
              onChange={e => setForm(f => ({ ...f, is_separable: !e.target.checked }))}/>
            <span>Complete two-piece — keep it together as one look (don't split into separate pieces). Uncheck if you also wear the top and bottom apart.</span>
          </label>
        ) : null}
      </div>

      {onStyleAround && (
        <button style={{...s.btnSecondary, width:"100%", marginBottom: 10, display:"flex", alignItems:"center", justifyContent:"center", gap:6}}
          onClick={() => onStyleAround(item)}>
          ✦ Style around this piece
        </button>
      )}

      <button style={{...s.btnPrimary,width:"100%",marginBottom:saveError ? 6 : 10, opacity: saving ? 0.6 : 1}}
        onClick={handleSave} disabled={!form.name.trim() || saving}>
        {saving ? "Saving…" : "Save Changes"}
      </button>
      {saveError && (
        <div style={{fontSize:12, color:"var(--color-danger)", marginBottom:10, lineHeight:1.4}}>
          {saveError}
          <button onClick={handleSave} disabled={saving}
            style={{marginLeft:8, background:"none", border:"none", color:"var(--color-danger)", textDecoration:"underline", cursor:"pointer", fontSize:12}}>
            Retry
          </button>
        </div>
      )}
      <button style={{...s.btnSecondary,width:"100%",color:confirm?"var(--color-danger)":"var(--color-text-muted)"}}
        onClick={() => confirm ? onDelete() : setConfirm(true)}>
        {confirm ? "Tap again to confirm delete" : "Delete Item"}
      </button>
    </div>
  );
}
