import { useState } from "react";
import { s } from "../ui/styles.js";
import { CATEGORY_ORDER, TAXONOMY, getL3Options, getSubcatL2 } from "../constants/taxonomy.js";
import { DEFAULT_CLOSET_ID, SEED_CLOSETS } from "../features/closet/closets.js";
import { costPerWear } from "../features/wear/wearApi.js";
import { stripBackground } from "../lib/bgRemoval.js";
import { imageToBase64, trimTransparentBorders, compressImage, PHOTO_MAX_DIM } from "../utils/images.js";
import ItemWearHistory from "./ItemWearHistory.jsx";

export default function EditItemView({ item, allItems, closets, onSave, onDelete, onBack, setsMeta: setsMetaProp, rmbgKey, onStyleAround, onSaveSetMeta, logs, plans }) {
  const [form, setForm] = useState({
    name: item.name, category: item.category, subcategory: item.subcategory || "",
    brand: item.brand || "", color: item.color || "", notes: item.notes || "",
    stylist_line: item.stylist_line || "",
    image: item.image || "", set_id: item.set_id || "", is_separable: item.is_separable ?? true,
    closet_id: item.closet_id || DEFAULT_CLOSET_ID,
    material: item.material || "",
    pattern: item.pattern || "",
    price_paid: item.price_paid ?? null,
    has_bg: item.has_bg,
    is_trimmed: item.is_trimmed,
    is_recut: item.is_recut,
  });
  const [preview, setPreview] = useState(item.image || null);
  // Set name lives beside the set link (owner report, stale PR #151 / open
  // item 10): picking "+ Create new set" used to mint an id no option matched,
  // so the select silently displayed "— Not part of a set —" and the set could
  // only be named later from the Sets tab. Now the fresh set renders as its
  // own option and is nameable inline; the name persists on Save via
  // onSaveSetMeta → App.updateSetMeta.
  const [setName, setSetName] = useState((setsMetaProp || {})[item.set_id]?.name || "");
  const [confirm, setConfirm] = useState(false);
  const [bgState, setBgState] = useState("idle"); // idle | running | success | error
  const [bgError, setBgError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Async save wrapper. Awaits the parent's onSave (which returns {ok,error}),
  // shows a clear error if it failed, and only signals "done" on success so
  // the parent can navigate away. Without this, the previous fire-and-forget
  // save would lose changes whenever the network blipped.
  const handleSave = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      // Persist the set name first — updateSetMeta is optimistic-local with a
      // fire-and-forget upsert, so this can't block or fail the item save.
      if (form.set_id && onSaveSetMeta) {
        const existing = (setsMetaProp || {})[form.set_id]?.name || "";
        if (setName.trim() !== existing) onSaveSetMeta(form.set_id, { name: setName.trim() });
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
      // Reset the cleanliness flags with WRITABLE values. `undefined` here was
      // a silent trap: JSON serialization drops undefined keys, so the upsert
      // kept the OLD photo's has_bg/is_trimmed — and is_recut wasn't reset at
      // all. A padded replacement photo inherited "already cropped" flags and
      // the recut drip skipped it forever. null (unknown → Settings backfill
      // re-detects) and false (drip re-trims next session) actually persist.
      setForm(f=>({...f,image:ev.target.result, has_bg: null, is_trimmed: false, is_recut: false}));
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
        // Removal didn't produce a keepable cutout — the original photo is
        // untouched. Say WHY: a rejected ghost matte (the washed-out-tote
        // failure) reads very differently from a missing key, and if
        // Remove.bg itself errored (credits, key) that's the actionable part.
        setBgState("error");
        const rmbgNote = result.rmbg_error
          ? ` Remove.bg error: ${result.rmbg_error}.`
          : "";
        if (result.reason === "bad_matte") {
          setBgError(`The cutout came back washed out (semi-transparent), so your original photo was kept. Try again${rmbgKey ? "" : ", or add a Remove.bg API key in Settings for a cleaner cut"}.${rmbgNote}`);
        } else {
          setBgError(rmbgKey
            ? `Background removal failed and the local fallback couldn't finish. Try a clearer photo or check your Remove.bg credit balance.${rmbgNote}`
            : "Add a Remove.bg API key in Settings to strip backgrounds (or upload a photo that's already transparent).");
        }
        return;
      }
      // Trim transparent border so the saved photo is tight to the visible
      // piece. The bg removal almost always leaves padding around the item.
      const trimmed = await trimTransparentBorders(result.image);
      // Cap at PHOTO_MAX_DIM like every other write path (bulk add, both
      // Settings passes, the drip) — this was the one image writer that could
      // store an oversized photo, and is_recut: true tells the drip to never
      // revisit it.
      const capped = await compressImage(trimmed, PHOTO_MAX_DIM, 0.9, true);
      setPreview(capped);
      // is_recut: true — this image was just alpha-trimmed right here, so the
      // background drip doesn't need to (and shouldn't) re-process it.
      setForm(f => ({...f, image: capped, has_bg: false, is_trimmed: true, is_recut: true}));
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
          {/* Never lock the button after a removal: a bad result used to
              dead-end here ("✓ Background already removed", disabled) with no
              way to re-run short of re-uploading the photo. Re-running is
              user-initiated and harmless — it works on the current preview. */}
          <button
            style={{...s.btnSecondary, width:"100%"}}
            onClick={handleStripBackground}
            disabled={bgState === "running"}>
            {bgState === "running"
              ? "Removing background…"
              : form.has_bg === false
                ? "↻ Re-run Background Removal"
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
        ].map(([label,field,placeholder]) => (
          <div key={field}>
            <div style={s.fieldLabel}>{label}</div>
            <input style={{...s.input,width:"100%"}} placeholder={placeholder}
              value={form[field]} onChange={e=>setForm(f=>({...f,[field]:e.target.value}))}/>
          </div>
        ))}

        {/* Stylist line — the short curated line the AI reads (classifiers +
            prompts). Long pasted product copy in Notes stays for display and
            search; when this line exists it speaks for the piece instead. */}
        <div>
          <div style={s.fieldLabel}>Stylist line · what the AI reads (≤200 chars)</div>
          <input style={{...s.input, width:"100%"}} maxLength={200}
            placeholder="e.g. silk cami, bias cut, layers under blazers; not for work alone"
            value={form.stylist_line} onChange={e=>setForm(f=>({...f,stylist_line:e.target.value}))}/>
        </div>

        {/* Notes gets a real multi-line editor — her notes are sentences
            (fit, care, occasion guidance the stylist reads), and a one-line
            input made editing them a horizontal-scroll exercise. */}
        <div>
          <div style={s.fieldLabel}>Notes</div>
          <textarea rows={4}
            style={{...s.input, width:"100%", minHeight:96, resize:"vertical", fontFamily:"inherit", lineHeight:1.5}}
            placeholder="e.g. cropped, chunky knit, cashmere — fit, care, when to wear it"
            value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/>
        </div>

        {/* minWidth:0 lets each half shrink below its control's content width
            on narrow screens instead of overflowing the page sideways. */}
        <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={s.fieldLabel}>Material</div>
            <input style={{...s.input,width:"100%"}} placeholder="silk, wool, denim…"
              value={form.material}
              onChange={e=>setForm(f=>({...f,material:e.target.value}))}/>
          </div>
          <div style={{flex:1,minWidth:0}}>
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
          const l3Options = getL3Options(form.category, l2);
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
              setForm(f => ({ ...f, set_id: newId }));
              setSetName("");
            } else if (val === "") {
              // Clearing set membership must also clear is_separable — otherwise
              // a stale `true` flag leaks in and the "Part of Set" badge + filter
              // silently treat the orphan as separable.
              setForm(f => ({ ...f, set_id: "", is_separable: false }));
              setSetName("");
            } else {
              setForm(f => ({ ...f, set_id: val }));
              setSetName((setsMetaProp || {})[val]?.name || "");
            }
          }}>
          <option value="">— Not part of a set —</option>
          <option value="__new__">+ Create new set</option>
          {(() => {
            // Build unique set IDs from items; count pieces in one pass. Sets
            // have no closet of their own — they live wherever their member
            // items do — so the picker offers only sets with at least one
            // piece in THIS garment's closet (form.closet_id, so changing the
            // Closet select re-scopes the list live). Owner report 2026-08-28:
            // editing in Arizona listed every NYC set. A cross-closet twin
            // (duplicate.js copies set_id) makes its set show in both closets,
            // which is exactly right. The item's own set always stays listed.
            const counts = new Map();
            const setClosets = new Map();
            (allItems || []).forEach(it => {
              if (!it.set_id) return;
              counts.set(it.set_id, (counts.get(it.set_id) || 0) + 1);
              if (!setClosets.has(it.set_id)) setClosets.set(it.set_id, new Set());
              setClosets.get(it.set_id).add(it.closet_id || DEFAULT_CLOSET_ID);
            });
            const options = [...counts.entries()]
              .filter(([id]) => id === form.set_id || setClosets.get(id).has(form.closet_id))
              .map(([id, count]) => (
              <option key={id} value={id}>
                {(setsMetaProp || {})[id]?.name || "Unnamed Set"} ({count} piece{count !== 1 ? "s" : ""})
              </option>
            ));
            // A freshly minted set has no member rows yet, so no option above
            // matches it — without this the select fell back to "— Not part of
            // a set —" and creating a set looked like it did nothing.
            if (form.set_id && !counts.has(form.set_id)) {
              options.unshift(
                <option key={form.set_id} value={form.set_id}>
                  ✦ {setName.trim() || "New set"} — saves with this item
                </option>
              );
            }
            return options;
          })()}
        </select>
        {form.set_id && (
          <div style={{marginBottom:10}}>
            <div style={s.fieldLabel}>Set name</div>
            <input style={{...s.input, width:"100%"}} placeholder="e.g. Navy Tweed Coord"
              value={setName} onChange={e => setSetName(e.target.value)}/>
          </div>
        )}
        {form.category === "Sets" ? (
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
        ) : form.set_id ? (
          <label style={{display:"flex", alignItems:"center", gap:8, fontSize:12, color:"var(--color-text)", cursor:"pointer"}}>
            <input type="checkbox" checked={form.is_separable}
              onChange={e => setForm(f => ({ ...f, is_separable: e.target.checked }))}/>
            Show as individual piece in its own category (separable)
          </label>
        ) : null}
      </div>

      {/* Closet assignment (multi-closet, Phase A) — saving with a different
          closet moves the piece there via the normal onSave path. */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>Closet</div>
        <p style={s.settingsSub}>Which closet does this piece live in? Saving moves it.</p>
        <div style={s.fieldLabel}>Closet</div>
        <select style={{...s.select, width:"100%"}}
          value={form.closet_id}
          onChange={e => setForm(f => ({ ...f, closet_id: e.target.value }))}>
          {(() => {
            const list = (closets && closets.length > 0) ? closets : SEED_CLOSETS;
            const options = list.map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.city ? ` — ${c.city}` : ""}</option>
            ));
            // Safety net: an id no listed closet matches (stale cache) still
            // renders instead of the select silently showing the first option.
            if (form.closet_id && !list.some(c => c.id === form.closet_id)) {
              options.unshift(<option key={form.closet_id} value={form.closet_id}>Unknown closet</option>);
            }
            return options;
          })()}
        </select>
      </div>

      {/* "In Your Looks" — worn/planned/saved outfits featuring this piece,
          with dates, so she can judge repeat spacing at a glance. Renders
          nothing when the piece has no history. */}
      <ItemWearHistory item={item} allItems={allItems} logs={logs} plans={plans} />

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
