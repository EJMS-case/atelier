import { useState } from "react";
import { s } from "../ui/styles.js";
import { CATEGORY_ORDER, TAXONOMY, SUBCATEGORY_L3, getSubcatL2 } from "../constants/taxonomy.js";
import { costPerWear } from "../features/wear/wearApi.js";

export default function EditItemView({ item, allItems, onSave, onDelete, onBack, setsMeta: setsMetaProp }) {
  const [form, setForm] = useState({
    name: item.name, category: item.category, subcategory: item.subcategory || "",
    brand: item.brand || "", color: item.color || "", notes: item.notes || "",
    image: item.image || "", set_id: item.set_id || "", is_separable: item.is_separable || false,
    primary_color_hex: item.primary_color_hex || "",
    secondary_color: item.secondary_color || "",
    secondary_color_hex: item.secondary_color_hex || "",
    material: item.material || "",
    pattern: item.pattern || "",
    tags: Array.isArray(item.tags) ? item.tags : [],
    price_paid: item.price_paid || "",
  });
  const [tagsInput, setTagsInput] = useState((item.tags || []).join(", "));
  const [preview, setPreview] = useState(item.image || null);
  const [confirm, setConfirm] = useState(false);

  const handleImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setPreview(ev.target.result); setForm(f=>({...f,image:ev.target.result})); };
    reader.readAsDataURL(file);
  };

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={s.pageTitle}>Edit Item</h2>
      </div>

      <label style={{...s.dropZone, marginBottom:20}}>
        {preview
          ? <img src={preview} alt="preview" style={{width:"100%",height:240,objectFit:"contain",display:"block",background:"#EEEAE4"}}/>
          : <div style={s.dropInner}><div style={s.dropIcon}>✦</div><div style={s.dropSub}>Tap to change photo</div></div>}
        <input type="file" accept="image/*" onChange={handleImage} style={{display:"none"}}/>
      </label>

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
            <div style={s.fieldLabel}>Color hex</div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {form.primary_color_hex && (
                <span style={{width:26,height:26,borderRadius:4,border:"1px solid #D6CDC1",background:form.primary_color_hex,flexShrink:0}}/>
              )}
              <input style={{...s.input,flex:1,fontFamily:"monospace"}} placeholder="#5D3A1A"
                value={form.primary_color_hex}
                onChange={e=>setForm(f=>({...f,primary_color_hex:e.target.value}))}/>
            </div>
          </div>
          <div style={{flex:1}}>
            <div style={s.fieldLabel}>Secondary color</div>
            <input style={{...s.input,width:"100%"}} placeholder="optional"
              value={form.secondary_color}
              onChange={e=>setForm(f=>({...f,secondary_color:e.target.value}))}/>
          </div>
        </div>
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
        <div>
          <div style={s.fieldLabel}>Tags (comma-separated)</div>
          <input style={{...s.input,width:"100%"}} placeholder="tailored, fluid, workwear"
            value={tagsInput}
            onChange={e => {
              const v = e.target.value;
              setTagsInput(v);
              const tags = v.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
              setForm(f => ({...f, tags}));
            }}/>
        </div>

        <div>
          <div style={s.fieldLabel}>Purchase price (USD, optional)</div>
          <input type="number" min="0" step="1" style={{...s.input,width:"100%"}}
            placeholder="e.g. 450"
            value={form.price_paid}
            onChange={e => setForm(f => ({...f, price_paid: e.target.value ? Number(e.target.value) : ""}))}/>
          {item.wear_count > 0 && costPerWear(item) !== null && (
            <div style={{fontSize:11, color:"#4A3E36", marginTop:4}}>
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
              setForm(f => ({ ...f, set_id: newId }));
            } else {
              setForm(f => ({ ...f, set_id: val }));
            }
          }}>
          <option value="">— Not part of a set —</option>
          <option value="__new__">+ Create new set</option>
          {(() => {
            const seen = new Set();
            return (allItems || []).filter(it => it.set_id && !seen.has(it.set_id) && (seen.add(it.set_id), true)).map(it => {
              const setName = (setsMetaProp || {})[it.set_id]?.name;
              const count = (allItems || []).filter(o => o.set_id === it.set_id).length;
              return (
                <option key={it.set_id} value={it.set_id}>
                  {setName || "Unnamed Set"} ({count} piece{count !== 1 ? "s" : ""})
                </option>
              );
            });
          })()}
        </select>
        {form.set_id && (
          <label style={{display:"flex", alignItems:"center", gap:8, fontSize:12, color:"#4A3E36", cursor:"pointer"}}>
            <input type="checkbox" checked={form.is_separable}
              onChange={e => setForm(f => ({ ...f, is_separable: e.target.checked }))}/>
            Show as individual piece in its own category (separable)
          </label>
        )}
      </div>

      <button style={{...s.btnPrimary,width:"100%",marginBottom:10}}
        onClick={() => onSave(form)} disabled={!form.name.trim()}>
        Save Changes
      </button>
      <button style={{...s.btnSecondary,width:"100%",color:confirm?"#C0392B":"#9A8E84"}}
        onClick={() => confirm ? onDelete() : setConfirm(true)}>
        {confirm ? "Tap again to confirm delete" : "Delete Item"}
      </button>
    </div>
  );
}
