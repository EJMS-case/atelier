import { useState } from "react";
import { s } from "../ui/styles.js";
import { stripBackground } from "../lib/bgRemoval.js";
import { autoDetectItem } from "../lib/anthropic.js";
import { applyDetection } from "../features/closet/applyDetection.js";
import { classifyKnitAI } from "../lib/ai/stylist.js";
import { compressImage } from "../utils/images.js";
import { CATEGORY_ORDER, TAXONOMY, SUBCATEGORY_L3, getSubcatL2 } from "../constants/taxonomy.js";

export default function BulkAddView({ onAdd, onBack, rmbgKey, apiKey }) {
  const [queue,      setQueue]      = useState([]);
  const [saving,     setSaving]     = useState(false);
  const [processing, setProcessing] = useState({}); // id -> "bg"|"detect"|"done"|"error"
  const [detected,   setDetected]   = useState({}); // id -> true once AI detect applied (prevents re-runs)
  const [knitSuggest, setKnitSuggest] = useState({}); // id -> { weight, fit, summary } | "loading" | "dismissed"

  const handleFiles = (e) => {
    Array.from(e.target.files).forEach(file => {
      const id = `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const rawImage = ev.target.result;
        setQueue(q => [...q, {
          id, image: rawImage,
          name: file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
          category: "Tops", subcategory: "", brand: "", color: "", notes: "",
          // F1 autodetect fields (may be filled by AI below)
          primary_color_hex: "", secondary_color: "", secondary_color_hex: "",
          material: "", pattern: "", has_bg: false,
          detected_at: null, detection_confidence: null,
        }]);
        setProcessing(p => ({...p, [id]: "bg"}));

        // F1 — run BG removal and AI detect in parallel. Both are best-effort;
        // neither blocks the save button on failure.
        const bgP = stripBackground(rawImage, { rmbgKey })
          .then(r => {
            return compressImage(r.image, 600, 0.9, true).then(compressed => ({
              image: compressed, has_bg: r.has_bg,
            }));
          })
          .catch(err => {
            console.warn("[F1] bg strip failed:", err);
            return { image: rawImage, has_bg: true };
          });

        const detectP = apiKey
          ? autoDetectItem(rawImage, apiKey).catch(err => {
              console.warn("[F1] auto-detect failed:", err);
              return null;
            })
          : Promise.resolve(null);

        const [bg, detection] = await Promise.all([bgP, detectP]);

        // Apply results in a single queue update so we don't race with the
        // user's typing or the Knits auto-classifier (handleCategoryChange).
        setQueue(q => q.map(i => {
          if (i.id !== id) return i;
          let next = { ...i, image: bg.image, has_bg: bg.has_bg };
          if (detection) {
            next = applyDetection(next, detection);
            next.detected_at = new Date().toISOString();
          }
          return next;
        }));
        if (detection) setDetected(d => ({ ...d, [id]: true }));
        setProcessing(p => ({...p, [id]: "done"}));
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  // Run knit classification when category changes to "Knits"
  const handleCategoryChange = async (id, cat, imgStr) => {
    update(id, "category", cat);
    update(id, "subcategory", "");
    if (cat === "Knits" && imgStr && apiKey) {
      setKnitSuggest(k => ({...k, [id]: "loading"}));
      try {
        const result = await classifyKnitAI(imgStr, apiKey);
        setKnitSuggest(k => ({...k, [id]: result}));
      } catch {
        setKnitSuggest(k => ({...k, [id]: "dismissed"}));
      }
    }
  };

  const confirmKnit = (id, suggestion) => {
    update(id, "subcategory", "Pullovers");
    update(id, "knit_weight", suggestion.weight);
    update(id, "knit_fit",    suggestion.fit);
    setKnitSuggest(k => ({...k, [id]: "dismissed"}));
  };

  const update = (id, f, v) => setQueue(q => q.map(i => i.id===id ? {...i,[f]:v} : i));
  const remove = (id)       => setQueue(q => q.filter(i => i.id!==id));

  const handleSave = () => {
    const valid = queue.filter(i => i.name.trim());
    if (!valid.length) return;
    setSaving(true);
    const newItems = valid.map(item => ({
      ...item,
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      created_at: new Date().toISOString(),
    }));
    onAdd(newItems);
    setSaving(false);
    onBack();
  };

  const allDone = queue.every(i => {
    const st = processing[i.id];
    return st === "done" || st === "error" || st === undefined;
  });

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={s.pageTitle}>Add Items</h2>
        {queue.length > 0 && <span style={s.queueBadge}>{queue.length}</span>}
      </div>

      {/* Upload pipeline notice */}
      {apiKey && rmbgKey && (
        <div style={s.rmbgNotice}>
          ✦ AI auto-detect + background removal active — category, color, brand, and material fill in automatically
        </div>
      )}
      {apiKey && !rmbgKey && (
        <div style={{...s.rmbgNotice, background:"#FFF8EC", borderColor:"#E8D5A0", color:"#8B6914"}}>
          ✦ AI auto-detect active. Add a Remove.bg key in Settings for best backgrounds — otherwise photos keep their original background.
        </div>
      )}
      {!apiKey && (
        <div style={{...s.rmbgNotice, background:"#FFF8EC", borderColor:"#E8D5A0", color:"#8B6914"}}>
          Add an Anthropic API key in Settings to auto-fill category, colors, and brand from the photo.
        </div>
      )}

      <label style={s.dropZone}>
        <div style={s.dropInner}>
          <div style={s.dropIcon}>✦</div>
          <div style={s.dropTitle}>Select photos</div>
          <div style={s.dropSub}>Choose one or many at once</div>
        </div>
        <input type="file" accept="image/*" multiple onChange={handleFiles} style={{display:"none"}}/>
      </label>

      {queue.length > 0 && (
        <>
          <div style={s.queueList}>
            {queue.map(item => {
              const status = processing[item.id];
              return (
                <div key={item.id} style={s.queueRow}>
                  {/* Thumbnail with status overlay */}
                  <div style={s.queueThumb}>
                    <img src={item.image} alt="" style={s.queueThumbImg}/>
                    {status === "bg" && (
                      <div style={s.thumbOverlay}>
                        <span style={s.spinnerSm}/>
                      </div>
                    )}
                    {status === "done" && (
                      <div style={{...s.thumbOverlay, background:"rgba(61,122,78,0.55)"}}>
                        <span style={{color:"#fff",fontSize:14}}>✓</span>
                      </div>
                    )}
                    {status === "error" && (
                      <div style={{...s.thumbOverlay, background:"rgba(192,57,43,0.7)"}}>
                        <span style={{color:"#fff",fontSize:11}}>failed</span>
                      </div>
                    )}
                    {item.has_bg && status === "done" && (
                      <div style={{position:"absolute",top:4,left:4,background:"rgba(139,105,20,0.9)",color:"#fff",fontSize:9,padding:"2px 5px",borderRadius:3,fontWeight:600}}>BG</div>
                    )}
                  </div>

                  <div style={s.queueFields}>
                    <input style={{...s.input,...s.queueInput,fontWeight:500}}
                      placeholder="Name *" value={item.name}
                      onChange={e=>update(item.id,"name",e.target.value)}/>
                    <div style={s.queueRow2}>
                      <select style={{...s.select,...s.queueSelect}} value={item.category}
                        onChange={e => handleCategoryChange(item.id, e.target.value, item.image)}>
                        {CATEGORY_ORDER.map(c=><option key={c}>{c}</option>)}
                      </select>
                      {TAXONOMY[item.category]?.length > 0 && item.category !== "Knits" && (() => {
                        const l2 = getSubcatL2(item.category, item.subcategory);
                        const l3Options = SUBCATEGORY_L3[l2] || [];
                        const l3Val = (l2 && l2 !== item.subcategory) ? item.subcategory : "";
                        return (
                          <>
                            <select style={{...s.select,...s.queueSelect}} value={l2}
                              onChange={e => update(item.id, "subcategory", e.target.value)}>
                              <option value="">Subcategory</option>
                              {TAXONOMY[item.category].map(opt => <option key={opt}>{opt}</option>)}
                            </select>
                            {l3Options.length > 0 && (
                              <select style={{...s.select,...s.queueSelect}} value={l3Val}
                                onChange={e => update(item.id, "subcategory", e.target.value)}>
                                <option value="">— Type —</option>
                                {l3Options.map(opt => <option key={opt}>{opt}</option>)}
                              </select>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    {/* Knit classification prompt */}
                    {item.category === "Knits" && (() => {
                      const ks = knitSuggest[item.id];
                      if (ks === "loading") return (
                        <div style={s.knitPrompt}>
                          <span style={s.spinnerSm}/> Classifying knit…
                        </div>
                      );
                      if (ks && ks !== "dismissed") return (
                        <div style={s.knitPrompt}>
                          <span style={s.knitSugText}>This looks like a <strong>{ks.summary}</strong> — is that right?</span>
                          <div style={{display:"flex",gap:6,marginTop:6}}>
                            <button style={s.knitConfirm} onClick={() => confirmKnit(item.id, ks)}>Confirm ✓</button>
                            <button style={s.knitEdit} onClick={() => setKnitSuggest(k => ({...k, [item.id]:"dismissed"}))}>Edit</button>
                          </div>
                        </div>
                      );
                      if (!ks || ks === "dismissed") return (
                        <div style={s.queueRow2}>
                          <select style={{...s.select,...s.queueSelect}} value={item.knit_fit || ""}
                            onChange={e=>update(item.id,"knit_fit",e.target.value)}>
                            <option value="">Fit</option>
                            {["Cropped","Oversized"].map(v=><option key={v}>{v}</option>)}
                          </select>
                          <select style={{...s.select,...s.queueSelect}} value={item.knit_weight || ""}
                            onChange={e=>update(item.id,"knit_weight",e.target.value)}>
                            <option value="">Weight</option>
                            {["Chunky/Winter","Fine/Summer"].map(v=><option key={v}>{v}</option>)}
                          </select>
                        </div>
                      );
                      return null;
                    })()}
                    <div style={s.queueRow2}>
                      <input style={{...s.input,...s.queueInput}} placeholder="Color"
                        value={item.color} onChange={e=>update(item.id,"color",e.target.value)}/>
                      <input style={{...s.input,...s.queueInput}} placeholder="Brand"
                        value={item.brand} onChange={e=>update(item.id,"brand",e.target.value)}/>
                    </div>
                    <input style={{...s.input,...s.queueInput}}
                      placeholder="Notes (e.g. cropped, chunky knit, cashmere)"
                      value={item.notes} onChange={e=>update(item.id,"notes",e.target.value)}/>
                  </div>
                  <button style={s.queueRemove} onClick={()=>remove(item.id)}>✕</button>
                </div>
              );
            })}
          </div>

          <div style={s.queueActions}>
            {!allDone && (
              <p style={{fontSize:12,color:"var(--color-text-muted)",textAlign:"center",margin:"0 0 8px"}}>
                Cleaning photos & auto-detecting details… you can edit any field while waiting
              </p>
            )}
            <button style={{...s.btnPrimary,width:"100%"}}
              onClick={handleSave}
              disabled={saving || queue.every(i=>!i.name.trim())}>
              {saving
                ? <><span style={s.spinnerSm}/> Saving…</>
                : `Save ${queue.filter(i=>i.name.trim()).length} item${queue.filter(i=>i.name.trim()).length!==1?"s":""} to Wardrobe`}
            </button>
            <button style={s.btnSecondary} onClick={onBack}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
