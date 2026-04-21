import { useState, useEffect, useCallback, useRef } from "react";
import { buildStylingPrompt } from "./prompts/styling-system-prompt.js";
import { sampleClosetItems, formatInventory } from "./utils/closet-sampler.js";
import { generateValidatedLooks, ValidationError } from "./utils/styling-validator.js";
import { getRecentlySuggestedItems, recordGeneration, loadSuggestionCounts } from "./utils/rotation-tracker.js";
import { generateContactSheets } from "./utils/contact-sheet.js";
import { autoDetectItem } from "./lib/anthropic.js";
import { stripBackground } from "./lib/bgRemoval.js";
import { applyDetection } from "./features/closet/applyDetection.js";
import { getLocalWeatherLabel } from "./lib/weather.js";
import { MOODS, moodPromptFor } from "./features/stylist/moods.js";
import { saveLookFeedback, fetchItemFeedbackScores, lookHash } from "./features/stylist/feedback.js";
import CalendarView from "./features/planner/CalendarView.jsx";
import { savePlan } from "./features/planner/plannerApi.js";
import SilhouetteBuilder from "./features/builder/SilhouetteBuilder.jsx";
import MoodboardView from "./features/moodboard/MoodboardView.jsx";
import WearView from "./features/wear/WearView.jsx";
import { bumpWearCounts, unbumpWearCounts, costPerWear } from "./features/wear/wearApi.js";
import HomeView from "./features/home/HomeView.jsx";
import { s, si, ss } from "./ui/styles.js";
import { icons, Icon } from "./ui/icons.jsx";
import {
  CATEGORY_ORDER, TAXONOMY, SUBCATEGORY_L3, CATEGORIES, SET_TAGS, OCCASIONS, getSubcatL2,
} from "./constants/taxonomy.js";
import {
  STYLE_PROFILE, CASUAL_STYLE_PROFILE, STYLING_PRINCIPLES, STYLE_PREFS,
  OCCASION_SLOTS, STYLING_STRATEGIES,
} from "./constants/styling.js";
import { COLOR_FAMILIES, COLOR_SORT_ORDER, SLEEVE_SORT, LENGTH_SORT, WEIGHT_SORT } from "./constants/color.js";
import {
  getSleeveType, filterByWeather, colorSortIdx, defaultSortComparator,
  normalizeItem, mergeItems, shuffle,
} from "./utils/item-helpers.js";
import {
  STORAGE_KEY, API_KEY_STORE, RMBG_KEY_STORE, SETS_META_KEY,
  STYLE_PREFS_KEY, ABOUT_ME_KEY, THEME_KEY, RECENT_LOOKS_KEY, INSIGHTS_DISMISSED_KEY,
  loadLocalItems, saveLocalItems, loadApiKey, saveApiKey, loadRmbgKey, saveRmbgKey,
  loadSetsMeta, saveSetsMeta, migrateLocalStorage, reconcilePendingSyncFlag,
} from "./utils/storage.js";
import { compressImage, imageToBase64, removeBackground } from "./utils/images.js";
import { sb, SUPABASE_URL, SUPABASE_KEY, SB_HEADERS, STORAGE_HEADERS, BUCKET } from "./lib/supabase.js";
import {
  generateOutfit, generateElevation, classifyKnitAI, analyzeColorAI,
  streamStyleProfile, generateShoppingRecs, buildImgSource, colorHex,
} from "./lib/ai/stylist.js";

// Rename any pre-namespace localStorage keys from older app builds. Runs once
// per browser; no-op afterward. Must fire before any load*() helpers below.
migrateLocalStorage();

// Mark every existing local item as `pending_sync: true` once, so the new
// delete-protection merge (which drops local-only items without that flag)
// doesn't discard pre-existing unsynced data on first reload. No-op after.
reconcilePendingSyncFlag();


// ── DARK WINTER COLOR SWATCHES ────────────────────────────────────────────────














// ── COLOR RESULT CARD (shared across modes) ───────────────────────────────────
function ColorResultCard({ result }) {
  if (!result) return null;
  const isException = result.darkWinterMatch === "Warm Exception";
  const { symbol, color, label } = isException
    ? { symbol: "✓", color: "#8B6914", label: "Warm Exception — Fully Approved" }
    : result.darkWinterMatch === "Strong match"
    ? { symbol: "✅", color: "var(--color-success)", label: "Strong Dark Winter Match" }
    : result.darkWinterMatch === "Borderline"
    ? { symbol: "⚠️", color: "#8B6914", label: "Borderline" }
    : { symbol: "❌", color: "var(--color-danger)", label: "Avoid — Warm-Toned" };

  return (
    <div style={s.colorResult}>
      <div style={{...s.colorVerdict, color}}>{symbol} {label}</div>
      <div style={s.colorMeta}>
        <span style={s.colorTag}>{result.undertone} undertone</span>
        <span style={s.colorTag}>{result.confidence} confidence</span>
      </div>
      {result.colorDescription && <div style={s.colorDesc}>{result.colorDescription}</div>}
      <div style={s.colorReasoning}>{result.reasoning}</div>
      {isException && (
        <div style={s.colorException}>
          Warm-toned — intentional exception in your wardrobe. Fully compatible.
        </div>
      )}
    </div>
  );
}

// ── SHOPPING DIMENSIONS CARD ──────────────────────────────────────────────────
function ShoppingDimensionsCard({ dimensions }) {
  if (!dimensions) return null;
  const scoreColor = (score) => {
    if (["Pass","High","Excellent","Strong"].includes(score)) return "var(--color-success)";
    if (["Medium","Good","Borderline","Exception"].includes(score)) return "#8B6914";
    return "var(--color-danger)";
  };
  const rows = [
    { key: "undertoneScore",     label: "Undertone" },
    { key: "visualCohesion",     label: "Visual Cohesion" },
    { key: "colorPaletteFit",    label: "Palette Fit" },
    { key: "textureFabric",      label: "Texture & Fabric" },
    { key: "layeringPotential",  label: "Layering Potential" },
    { key: "practicality",       label: "Practicality" },
    { key: "similarityFlag",     label: "Similarity" },
  ];
  return (
    <div style={{marginTop:16, border:"1px solid var(--color-border)", borderRadius:8, overflow:"hidden"}}>
      <div style={{padding:"10px 14px", background:"#F8F4F0", borderBottom:"1px solid var(--color-border)", fontSize:11, fontWeight:500, letterSpacing:"0.06em", color:"var(--color-text-muted)", textTransform:"uppercase"}}>
        Styling Analysis
      </div>
      {rows.map(({key, label}) => {
        const dim = dimensions[key];
        if (!dim) return null;
        const score = dim.score ?? (dim.flagged ? "Flagged" : "Clear");
        return (
          <div key={key} style={{padding:"10px 14px", borderBottom:"1px solid var(--color-surface-3)", display:"flex", gap:12, alignItems:"flex-start"}}>
            <div style={{minWidth:120, fontSize:11, fontWeight:500, color:"var(--color-text-muted)", paddingTop:1}}>{label}</div>
            <div style={{flex:1}}>
              <span style={{fontSize:11, fontWeight:600, color:scoreColor(score), marginRight:8}}>{score}</span>
              {dim.note && <span style={{fontSize:11, color:"#6B5E57"}}>{dim.note}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── COLOR ADVISOR VIEW ────────────────────────────────────────────────────────
function ColorAdvisorView({ items, apiKey }) {
  const [mode, setMode]           = useState("analyze");
  const [uploadImg, setUploadImg] = useState(null);
  const [checking, setChecking]   = useState(false);
  const [result, setResult]       = useState(null);
  const [err, setErr]             = useState("");
  // Audit state
  const [auditItems,    setAuditItems]    = useState([]);
  const [auditRunning,  setAuditRunning]  = useState(false);
  const [auditProgress, setAuditProgress] = useState({ done: 0, total: 0 });
  const [dismissed,     setDismissed]     = useState(new Set());

  const reset = () => { setUploadImg(null); setResult(null); setErr(""); };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setUploadImg(ev.target.result); setResult(null); setErr(""); };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!apiKey) { setErr("Add your Anthropic API key in Settings."); return; }
    if (!uploadImg) { setErr("Upload an image first."); return; }
    setChecking(true); setResult(null); setErr("");
    try {
      const wardrobe = mode === "shopping" ? items : null;
      const res = await analyzeColorAI(uploadImg, apiKey, wardrobe);
      setResult(res);
    } catch(e) { setErr(e.message); }
    finally { setChecking(false); }
  };

  const handleAudit = async () => {
    if (!apiKey) { setErr("Add your Anthropic API key in Settings."); return; }
    const UNDERTONE_CATEGORIES = ["Tops", "Knits", "Dresses", "Outerwear", "Jumpsuits", "Ocasionwear", "Occasionwear"];
    const toAudit = items.filter(it => it.image && UNDERTONE_CATEGORIES.includes(it.category));
    if (!toAudit.length) { setErr("No items with photos found."); return; }
    setAuditRunning(true); setAuditItems([]); setDismissed(new Set());
    setAuditProgress({ done: 0, total: toAudit.length });
    const results = [];
    for (const item of toAudit) {
      try {
        const analysis = await analyzeColorAI(item.image, apiKey);
        results.push({ ...item, analysis });
      } catch {
        results.push({ ...item, analysis: null });
      }
      setAuditProgress(p => ({ ...p, done: p.done + 1 }));
      setAuditItems([...results]);
    }
    setAuditRunning(false);
  };

  const auditGroups = [
    { key: "Strong match", symbol: "✅", label: "Confirmed Cool — Strong Dark Winter" },
    { key: "Warm Exception", symbol: "✓",  label: "Warm Exceptions — Fully Approved" },
    { key: "Borderline",    symbol: "⚠️", label: "Borderline — May Depend on Lighting" },
    { key: "Avoid",         symbol: "❌", label: "Warm-Toned — Flagged" },
  ];

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Color Advisor</h2>
      </div>

      <div style={s.modeTabs}>
        {[["analyze","Analyze"],["shopping","Shopping Check"],["audit","Wardrobe Audit"]].map(([m,label]) => (
          <button key={m} onClick={() => { setMode(m); reset(); }}
            style={{...s.modeTab, ...(mode===m ? s.modeTabActive : {})}}>
            {label}
          </button>
        ))}
      </div>

      {/* ── ANALYZE + SHOPPING ── */}
      {(mode === "analyze" || mode === "shopping") && (
        <div>
          {mode === "shopping" && (
            <div style={s.advisorNote}>
              Upload a product photo from any retailer. We'll check undertone compatibility and show which pieces you already own would pair with it.
            </div>
          )}
          <label style={{...s.dropZone, marginBottom: 16}}>
            {uploadImg
              ? <img src={uploadImg} alt="preview" style={{width:"100%",height:240,objectFit:"contain",background:"#EEEAE4",display:"block"}}/>
              : <div style={s.dropInner}>
                  <div style={s.dropIcon}>✦</div>
                  <div style={s.dropTitle}>{mode === "shopping" ? "Upload product photo" : "Upload garment photo"}</div>
                  <div style={s.dropSub}>Any image — garment, screenshot, product photo</div>
                </div>}
            <input type="file" accept="image/*" onChange={handleFile} style={{display:"none"}}/>
          </label>

          {err && <p style={s.err}>{err}</p>}
          <button style={{...s.btnPrimary, width:"100%", marginBottom:20}}
            onClick={handleAnalyze} disabled={checking || !uploadImg}>
            {checking
              ? <><span style={s.spinnerSm}/> Analyzing…</>
              : <><Icon path={icons.sparkle} size={15}/> {mode === "shopping" ? "Check This Piece" : "Analyze Color"}</>}
          </button>

          <ColorResultCard result={result}/>
          {result && mode === "shopping" && result.dimensions && (
            <ShoppingDimensionsCard dimensions={result.dimensions}/>
          )}

          {result && mode === "shopping" && result.pairingItemIds?.length > 0 && (
            <div style={s.pairingSection}>
              <div style={s.pairingLabel}>
                Pairs with {result.pairingCount || result.pairingItemIds.length} pieces you own
              </div>
              <div style={s.pairingRow}>
                {result.pairingItemIds.slice(0,5).map(id => {
                  const item = items.find(it => it.id === id);
                  if (!item) return null;
                  return (
                    <div key={id} style={s.pairingItem}>
                      {item.image
                        ? <img src={item.image} alt={item.name} style={s.pairingThumb}/>
                        : <div style={{...s.pairingThumb, background:"var(--color-surface-3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"var(--color-text-muted)"}}>{item.category?.[0]}</div>}
                      <div style={s.pairingName}>{item.name}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── AUDIT ── */}
      {mode === "audit" && (
        <div>
          <div style={s.advisorNote}>
            Analyzes tops, knits, dresses, and outerwear for undertone + Dark Winter compatibility. Browns and warm reds are never flagged. Bottoms, shoes, and accessories are excluded. One API call per item.
          </div>
          {err && <p style={s.err}>{err}</p>}

          {!auditRunning && (
            <button style={{...s.btnPrimary, width:"100%", marginBottom:20}}
              onClick={handleAudit} disabled={auditRunning}>
              <Icon path={icons.sparkle} size={15}/>
              {auditItems.length > 0 ? "Re-run Audit" : `Run Audit (${items.filter(i=>i.image && ["Tops","Knits","Dresses","Outerwear","Jumpsuits","Occasionwear"].includes(i.category)).length} garments)`}
            </button>
          )}

          {auditRunning && (
            <div style={s.auditProgressWrap}>
              <div style={s.auditProgressTrack}>
                <div style={{...s.auditProgressBar, width:`${(auditProgress.done/auditProgress.total)*100}%`}}/>
              </div>
              <div style={s.auditProgressText}>
                Analyzing {auditProgress.done} / {auditProgress.total}…
              </div>
            </div>
          )}

          {auditItems.length > 0 && auditGroups.map(({ key, symbol, label }) => {
            const group = auditItems.filter(it =>
              it.analysis?.darkWinterMatch === key && !dismissed.has(it.id)
            );
            if (!group.length) return null;
            return (
              <div key={key} style={s.auditGroup}>
                <div style={s.auditGroupHeader}>
                  {symbol} {label} <span style={s.auditCount}>({group.length})</span>
                </div>
                {group.map(item => (
                  <div key={item.id} style={s.auditRow}>
                    {item.image
                      ? <img src={item.image} alt={item.name} style={s.auditThumb}/>
                      : <div style={{...s.auditThumb, background:"var(--color-surface-3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"var(--color-border-muted)"}}>{item.category?.[0]}</div>}
                    <div style={s.auditInfo}>
                      <div style={s.auditName}>{item.name}</div>
                      <div style={s.auditCat}>{item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}</div>
                      {item.analysis?.colorDescription && (
                        <div style={s.auditColorDesc}>{item.analysis.colorDescription}</div>
                      )}
                      {item.analysis?.reasoning && (
                        <div style={s.auditReasoning}>{item.analysis.reasoning}</div>
                      )}
                    </div>
                    {key === "Avoid" && (
                      <button style={s.keepAnywayBtn}
                        onClick={() => setDismissed(d => new Set([...d, item.id]))}>
                        Keep anyway
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ── IMAGE MIGRATION HELPERS ───────────────────────────────────────────────────
// Upload base64 images from a list of items to Storage, update state + DB
async function migrateImages(items, setItemsFn, saveLocalFn) {
  for (const item of items) {
    try {
      const url = await sb.uploadImage(item.id, item.image);
      const updated = { ...item, image: url };
      await sb.upsert(updated);
      if (setItemsFn) {
        setItemsFn(prev => {
          const next = prev.map(it => it.id === item.id ? updated : it);
          saveLocalFn(next);
          return next;
        });
      }
    } catch {
      // Keep base64 as fallback if upload fails
    }
  }
}

// Upload images + push metadata to Supabase — processes sequentially to avoid rate limits
async function migrateAndSync(items, setItemsFn, flashSyncFn) {
  flashSyncFn("syncing");
  let failed = 0;
  for (const item of items) {
    try {
      let toSave = item;
      if (item.image?.startsWith("data:")) {
        try {
          const url = await sb.uploadImage(item.id, item.image);
          toSave = { ...item, image: url };
          if (setItemsFn) {
            setItemsFn(prev => prev.map(it => it.id === item.id ? toSave : it));
          }
        } catch { /* keep base64 in state, upsert without image */ }
      }
      await sb.upsert(toSave);
    } catch { failed++; }
    // Small pause between items to avoid rate limits
    await new Promise(r => setTimeout(r, 150));
  }
  failed > 0 ? flashSyncFn("error") : flashSyncFn("synced");
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [items,      setItems]      = useState(() => loadLocalItems());
  const [view,       setViewRaw]    = useState("home");
  const closetScrollRef = useRef(0);
  const viewRef = useRef("closet");
  const setView = useCallback((v) => {
    // Save scroll position when leaving closet
    if (viewRef.current === "closet" && v !== "closet") {
      closetScrollRef.current = window.scrollY;
    }
    viewRef.current = v;
    setViewRaw(v);
    // Restore scroll position when returning to closet
    if (v === "closet") {
      requestAnimationFrame(() => {
        window.scrollTo(0, closetScrollRef.current);
      });
    }
  }, []);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; }
    catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);
  const [filter,     setFilter]     = useState("All"); // legacy — still used for Sets view
  const [activeFilters, setActiveFilters] = useState({ category: [], subcategory: [], color: [], brand: [], sleeveLength: "", sets: "", lastWorn: "" });
  const [outfits,    setOutfits]    = useState(null);
  const [outfitNotes, setOutfitNotes] = useState(null); // notes from AI when fewer than 3 looks
  const [allLooks,   setAllLooks]   = useState(() => {
    // Lazy-init from localStorage so anti-repeat history persists across sessions
    try {
      const raw = localStorage.getItem(RECENT_LOOKS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }); // history of all generated looks for anti-repeat
  const [styling,    setStyling]    = useState(false);
  const [styleErr,   setStyleErr]   = useState("");
  const [occasion,   setOccasion]   = useState("Work");
  const [weather,    setWeather]    = useState("");
  const [mood,       setMood]       = useState(""); // F2 — mood tag key
  const [request,    setRequest]    = useState("");
  const [styleExcludes, setStyleExcludes] = useState(new Set()); // user-toggled exclusions
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false); // F2 — auto-location fetch
  const [feedbackScores, setFeedbackScores] = useState({});    // F2 — aggregate item scores
  const [recentlyWornItems, setRecentlyWornItems] = useState([]); // F2 — item IDs worn in last 3 days
  const [apiKey,     setApiKey]     = useState(() => loadApiKey());
  const [rmbgKey,    setRmbgKey]    = useState(() => loadRmbgKey());
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | synced | error
  const [editItem,   setEditItem]   = useState(null);
  const [closetSearch, setClosetSearch] = useState("");  // global closet search
  const [favorites,  setFavorites]  = useState([]);
  // ── Sets metadata ──
  const [setsMeta,       setSetsMeta]       = useState(() => loadSetsMeta());
  const [setsSearch,     setSetsSearch]     = useState("");
  const [setsTagFilter,  setSetsTagFilter]  = useState("");
  const [setsSort,       setSetsSort]       = useState("recent"); // recent | alpha | count
  const [editingSet,     setEditingSet]     = useState(null); // null or set_id for modal
  const syncTimer = useRef(null);

  // ── Persist allLooks to localStorage so anti-repeat history survives reloads
  useEffect(() => {
    try { localStorage.setItem(RECENT_LOOKS_KEY, JSON.stringify(allLooks)); } catch {}
  }, [allLooks]);

  // ── Flash sync status briefly
  const flashSync = (status) => {
    setSyncStatus(status);
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => setSyncStatus("idle"), 3000);
  };

  // ── Pull from Supabase and merge — callable on mount AND as a manual retry
  const reloadFromSupabase = useCallback(() => {
    setSyncStatus("syncing");
    sb.fetchAll()
      .then(async sbItems => {
        // Remove test placeholder items (t1-t10) that were never real wardrobe entries
        const testIds = sbItems.filter(it => /^t\d+$/.test(it.id)).map(it => it.id);
        if (testIds.length > 0) {
          await Promise.all(testIds.map(id => sb.remove(id).catch(() => {})));
          sbItems = sbItems.filter(it => !/^t\d+$/.test(it.id));
        }

        const freshLocal = loadLocalItems();
        if (!sbItems || sbItems.length === 0) {
          if (freshLocal.length > 0) {
            setItems(freshLocal);
            migrateAndSync(freshLocal, setItems, flashSync);
          } else {
            setSyncStatus("idle");
          }
          return;
        }
        const merged = mergeItems(sbItems, freshLocal);
        setItems(merged);
        saveLocalItems(merged);

        // Push up only the local-only items still flagged pending_sync.
        // Without this filter, an aggressive "sync everything local" would
        // re-create items that another device legitimately deleted.
        const sbIds = new Set(sbItems.map(it => it.id));
        const pendingLocalOnly = freshLocal.filter(it => !sbIds.has(it.id) && it.pending_sync);
        if (pendingLocalOnly.length > 0) {
          migrateAndSync(pendingLocalOnly, setItems, flashSync);
        }

        // Migrate any base64 images in the merged set to Storage
        const needsMigration = merged.filter(it => it.image?.startsWith("data:"));
        if (needsMigration.length > 0) {
          migrateImages(needsMigration, setItems, saveLocalItems);
        }

        flashSync("synced");
      })
      .catch(() => setSyncStatus("error"));
  }, []);

  // ── On mount: ensure Storage bucket exists, pull from Supabase, merge with local
  useEffect(() => {
    const local = loadLocalItems();
    if (local.length > 0) setItems(local);

    sb.ensureBucket().catch(() => {});
    sb.fetchFavorites().then(setFavorites).catch(() => {});

    // F2 — load aggregate feedback scores so sampler can weight future picks
    fetchItemFeedbackScores().then(setFeedbackScores).catch(() => {});

    // F2 — compute items worn in last 3 days from outfit_logs
    sb.fetchOutfitLogs().then(logs => {
      const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const ids = new Set();
      (logs || []).forEach(log => {
        if (log.date_worn && log.date_worn >= cutoff) {
          (log.garment_ids || []).forEach(id => ids.add(id));
        }
      });
      setRecentlyWornItems([...ids]);
    }).catch(() => {});

    // Load sets metadata from Supabase (falls back to localStorage)
    sb.fetchSets().then(sbSets => {
      if (sbSets && sbSets.length > 0) {
        const meta = { ...loadSetsMeta() };
        sbSets.forEach(s => { meta[s.id] = { name: s.name, tags: s.tags || [], created_at: s.created_at }; });
        setSetsMeta(meta);
        saveSetsMeta(meta);
      }
    }).catch(() => {});

    // Try to load API keys from Supabase (cross-device sync)
    sb.getSettings().then(settings => {
      if (settings?.anthropicKey && !loadApiKey()) {
        saveApiKey(settings.anthropicKey);
        setApiKey(settings.anthropicKey);
      }
      if (settings?.rmbgKey && !loadRmbgKey()) {
        saveRmbgKey(settings.rmbgKey);
        setRmbgKey(settings.rmbgKey);
      }
    }).catch(() => {});

    reloadFromSupabase();
  }, [reloadFromSupabase]);

  // ── Persist to both localStorage and Supabase
  const persistItems = useCallback((updated) => {
    saveLocalItems(updated);
    setItems(updated);
  }, []);

  // ── Sets metadata helpers ──
  const updateSetMeta = useCallback((setId, data) => {
    setSetsMeta(prev => {
      const next = { ...prev, [setId]: { ...(prev[setId] || {}), ...data } };
      saveSetsMeta(next);
      sb.upsertSet({ id: setId, name: next[setId].name || "", tags: next[setId].tags || [] }).catch(() => {});
      return next;
    });
  }, []);

  const deleteSetMeta = useCallback((setId) => {
    setSetsMeta(prev => {
      const next = { ...prev };
      delete next[setId];
      saveSetsMeta(next);
      sb.deleteSet(setId).catch(() => {});
      return next;
    });
    // Unlink all items from this set
    const updated = items.map(it => it.set_id === setId ? { ...it, set_id: null, is_separable: false } : it);
    persistItems(updated);
    updated.filter(it => it.set_id === null && items.find(o => o.id === it.id)?.set_id === setId)
      .forEach(it => sb.upsert(it).catch(() => {}));
  }, [items, persistItems]);

  const getSetName = useCallback((setId, index) => {
    return setsMeta[setId]?.name || `Set ${index + 1}`;
  }, [setsMeta]);

  const addItems = useCallback(async (newItems) => {
    // Mark every new item pending_sync until Supabase confirms it. The merge
    // logic uses this flag to preserve local-only items on reload — without
    // it, an item uploaded optimistically could be dropped as "deleted
    // elsewhere" if the user reloads before upsert finishes.
    const pendingNew = newItems.map(it => ({ ...it, pending_sync: true }));
    const optimistic = [...items, ...pendingNew];
    setItems(optimistic);
    saveLocalItems(optimistic);
    flashSync("syncing");

    const BATCH = 5;
    const saved = [...items];
    let failedImages = [];
    let anyFailed = false;

    for (let i = 0; i < pendingNew.length; i += BATCH) {
      const batch = pendingNew.slice(i, i + BATCH);
      await Promise.all(batch.map(async (item) => {
        try {
          let toSave = item;
          if (item.image?.startsWith("data:")) {
            try {
              const url = await sb.uploadImage(item.id, item.image);
              toSave = { ...item, image: url };
            } catch (imgErr) {
              console.error("Image upload failed for", item.name, imgErr);
              failedImages.push(item.name);
              // Keep base64 in localStorage so it survives reload and can be retried
              toSave = item;
            }
          }
          await sb.upsert(toSave);
          // Upsert confirmed — strip the pending flag so future merges treat
          // the item as "lives in Supabase" rather than "local-only retry".
          const { pending_sync, ...confirmed } = toSave;
          void pending_sync;
          saved.push(confirmed);
          setItems(prev => prev.map(it => it.id === toSave.id ? confirmed : it));
        } catch(e) {
          console.error("Failed to save item to Supabase:", item.name, e);
          saved.push(item); // keep pending_sync: true; retry on next reload
          anyFailed = true;
        }
      }));
      if (i + BATCH < pendingNew.length) await new Promise(r => setTimeout(r, 300));
    }

    saveLocalItems(saved);
    if (failedImages.length > 0) {
      flashSync("error");
      setTimeout(() => alert(`⚠️ Photos failed to upload for ${failedImages.length} item(s):\n\n${failedImages.join("\n")}\n\nThe items were saved but without photos. Go to Settings → Force Sync to retry, or re-upload photos by editing each item.`), 300);
    } else {
      anyFailed ? flashSync("error") : flashSync("synced");
    }
  }, [items]);

  const updateItem = useCallback(async (id, fields) => {
    let resolvedFields = { ...fields };
    let imageUploadFailed = false;
    if (fields.image?.startsWith("data:")) {
      try {
        const url = await sb.uploadImage(id, fields.image);
        resolvedFields = { ...fields, image: url };
      } catch (imgErr) {
        console.error("Image upload failed during edit:", imgErr);
        imageUploadFailed = true;
      }
    }
    const updated = items.map(it => it.id === id ? {...it, ...resolvedFields} : it);
    persistItems(updated);
    flashSync("syncing");
    try {
      const item = updated.find(it => it.id === id);
      await sb.upsert(item);
      if (imageUploadFailed) {
        flashSync("error");
        alert("⚠️ Your changes were saved, but the photo failed to upload. The photo is stored locally — try editing the item again or use Settings → Force Sync.");
      } else {
        flashSync("synced");
      }
    } catch(e) {
      console.error("Failed to update item in Supabase:", e);
      flashSync("error");
    }
  }, [items, persistItems]);

  // Force-sync ALL items currently in React state to Supabase — used after bulk upload failures
  // Reads from live state (has base64 images), uploads them, saves URLs back
  const forceSyncAll = useCallback(async (onProgress) => {
    flashSync("syncing");
    let done = 0, failed = 0, imgFailed = 0;
    const updated = [...items];
    for (let i = 0; i < updated.length; i++) {
      const item = updated[i];
      try {
        let toSave = item;
        if (item.image?.startsWith("data:")) {
          try {
            const url = await sb.uploadImage(item.id, item.image);
            toSave = { ...item, image: url };
            updated[i] = toSave;
            setItems(prev => prev.map(it => it.id === toSave.id ? toSave : it));
          } catch (imgErr) {
            console.error("Force sync image upload failed for", item.name, imgErr);
            imgFailed++;
          }
        }
        await sb.upsert(toSave);
        done++;
      } catch { failed++; }
      if (onProgress) onProgress(i + 1, updated.length, failed);
      await new Promise(r => setTimeout(r, 150));
    }
    saveLocalItems(updated);
    const anyProblems = failed > 0 || imgFailed > 0;
    anyProblems ? flashSync("error") : flashSync("synced");
    if (imgFailed > 0) {
      setTimeout(() => alert(`⚠️ ${imgFailed} photo(s) failed to upload to cloud storage. Item data was saved but those photos are only stored locally.`), 300);
    }
    return { done, failed };
  }, [items]);

  const deleteItem = useCallback(async (id) => {
    const updated = items.filter(it => it.id !== id);
    persistItems(updated);
    flashSync("syncing");
    try {
      await sb.remove(id);
      sb.removeImage(id).catch(() => {}); // best-effort Storage cleanup
      flashSync("synced");
    } catch { flashSync("error"); }
  }, [items, persistItems]);

  const isFav = useCallback((type, refId) =>
    favorites.some(f => f.type === type && f.reference_id === refId),
  [favorites]);

  const toggleFav = useCallback(async (type, refId) => {
    const existing = favorites.find(f => f.type === type && f.reference_id === refId);
    if (existing) {
      setFavorites(prev => prev.filter(f => f.id !== existing.id));
      await sb.removeFavorite(type, refId);
    } else {
      const result = await sb.addFavorite(type, refId);
      setFavorites(prev => [...result, ...prev]);
    }
  }, [favorites]);

  const normalizeLooks = (looks, fallbackOccasion) => looks.map(look => ({
    ...look,
    items: (look.items || []).map(item =>
      typeof item === "object" ? item.id : String(item).replace(/^ID:/i, "").trim()
    ),
    itemRoles: (look.items || []).reduce((acc, item) => {
      if (typeof item === "object" && item.id && item.role) acc[item.id] = item.role;
      return acc;
    }, {}),
    mood: look.vibe || look.mood || "",
    occasion: look.occasion || fallbackOccasion,
    styling: look.rationale || look.styling || "",
    colorStory: look.color_strategy || look.colorStory || "",
    reasoning: look.rationale || look.reasoning || "",
  }));

  const handleGenerateForDay = async (dayOccasion = "Work") => {
    if (!apiKey) throw new Error("Add your Anthropic API key in Settings first.");
    if (items.length < 3) throw new Error(`Add at least 3 items first (you have ${items.length}).`);
    const result = await generateOutfit(items, dayOccasion, weather, "", apiKey, allLooks, loadStylePrefs(), loadAboutMe(), styleExcludes, { mood, feedbackScores, recentlyWornItems });
    const looks = result?.looks;
    if (!looks || !Array.isArray(looks) || looks.length === 0) {
      throw new Error(result?.notes || "AI returned no looks — try again.");
    }
    const normalized = normalizeLooks(looks, dayOccasion);
    setAllLooks(prev => [...prev, ...normalized].slice(-30));
    return normalized;
  };

  const handleStyle = async () => {
    if (!apiKey) { setStyleErr("Add your Anthropic API key in Settings first."); return; }
    if (items.length < 3) { setStyleErr(`Add at least 3 items first (you have ${items.length}).`); return; }
    setStyling(true); setStyleErr(""); setOutfits(null); setOutfitNotes(null);
    try {
      const result = await generateOutfit(items, occasion, weather, request, apiKey, allLooks, loadStylePrefs(), loadAboutMe(), styleExcludes, { mood, feedbackScores, recentlyWornItems });
      console.log("Generation result:", JSON.stringify(result).slice(0, 500));
      const looks = result?.looks;
      // Capture notes for partial results
      if (result?.notes) setOutfitNotes(result.notes);
      if (!looks || !Array.isArray(looks) || looks.length === 0) {
        // If notes explain why fewer than 3 looks, show that
        if (result?.notes) {
          throw new Error(result.notes);
        }
        throw new Error("AI returned no looks — try again.");
      }
      const normalizedLooks = normalizeLooks(looks, occasion);
      setOutfits(normalizedLooks);
      setAllLooks(prev => [...prev, ...normalizedLooks].slice(-30));
      setView("style");
    } catch(e) {
      setStyleErr(e.message || "Styling failed — check your API key.");
      console.error("Generation error:", e);
    } finally { setStyling(false); }
  };

  // Apply multi-select filters
  const isSetView = activeFilters.category?.includes("Sets");
  const setGroupsRaw = isSetView ? (() => {
    const groups = {};
    items.filter(it => it.set_id).forEach(it => {
      if (!groups[it.set_id]) groups[it.set_id] = [];
      groups[it.set_id].push(it);
    });
    return Object.entries(groups).map(([setId, groupItems]) => ({
      setId,
      items: groupItems,
      name: setsMeta[setId]?.name || "",
      tags: setsMeta[setId]?.tags || [],
      created_at: setsMeta[setId]?.created_at || groupItems[0]?.created_at || "",
    }));
  })() : null;

  // Filter + sort sets
  const setGroups = setGroupsRaw ? (() => {
    let result = [...setGroupsRaw];
    // Search filter
    if (setsSearch.trim()) {
      const q = setsSearch.toLowerCase().trim();
      result = result.filter(g =>
        g.name.toLowerCase().includes(q) ||
        g.items.some(it => it.name.toLowerCase().includes(q) || (it.brand || "").toLowerCase().includes(q))
      );
    }
    // Tag filter
    if (setsTagFilter) {
      result = result.filter(g => g.tags.includes(setsTagFilter));
    }
    // Sort
    if (setsSort === "alpha") {
      result.sort((a, b) => (a.name || "Set").localeCompare(b.name || "Set"));
    } else if (setsSort === "count") {
      result.sort((a, b) => b.items.length - a.items.length);
    } else {
      result.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    return result;
  })() : null;

  const filtered = (() => {
    let base = items;
    const cats = activeFilters.category?.filter(c => c !== "Sets") || [];
    if (cats.length)  base = base.filter(it => cats.includes(it.category));
    if (activeFilters.subcategory?.length) base = base.filter(it => activeFilters.subcategory.includes(it.subcategory));
    // Sleeve length filter — uses subcategory mapping for Tops, sleeve_length field for Dresses
    if (activeFilters.sleeveLength) {
      const sl = activeFilters.sleeveLength;
      const TOPS_SLEEVE_MAP = {
        "Tanks": "Sleeveless",
        "T-Shirts": "Short Sleeve", "Polos": "Short Sleeve", "Short Sleeve": "Short Sleeve",
        "Blouses": "Long Sleeve", "Shirts": "Long Sleeve", "Tops": "Long Sleeve",
        "Light Knit Tops": "Long Sleeve",
      };
      base = base.filter(it => {
        if (it.category === "Tops") return TOPS_SLEEVE_MAP[it.subcategory] === sl;
        if (it.category === "Dresses") return (it.sleeve_length || "").toLowerCase() === sl.toLowerCase();
        return true;   // don't filter non-Tops/Dresses items
      });
    }
    if (activeFilters.brand?.length)  base = base.filter(it => activeFilters.brand.includes(it.brand));
    if (activeFilters.color?.length) {
      base = base.filter(it => {
        const itemColor = (it.color || "").toLowerCase();
        const itemFamily = (it.color_family || "").toLowerCase();
        return activeFilters.color.some(c => {
          const cl = c.toLowerCase();
          return itemColor.includes(cl) || itemFamily.includes(cl) || itemColor === cl;
        });
      });
    }
    // Sets filter
    if (activeFilters.sets === "Sets Only") base = base.filter(it => it.set_id);
    if (activeFilters.sets === "Separates Only") base = base.filter(it => !it.set_id);
    if (activeFilters.sets === "Part of a Set") base = base.filter(it => it.set_id && it.is_separable);
    // Last Worn filter
    if (activeFilters.lastWorn) {
      const now = new Date();
      const days = parseInt(activeFilters.lastWorn);
      if (days > 0) {
        const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        base = base.filter(it => !it.last_worn || new Date(it.last_worn) < cutoff);
      }
    }
    // Global search filter — matches name, brand, color, subcategory, notes
    if (closetSearch.trim()) {
      const q = closetSearch.toLowerCase().trim();
      base = base.filter(it => {
        const fields = [it.name, it.brand, it.color, it.color_family, it.subcategory, it.category, it.notes].filter(Boolean);
        return fields.some(f => f.toLowerCase().includes(q));
      });
    }
    return isSetView ? [] : [...base].sort(defaultSortComparator);
  })();

  // Sync status indicator
  const syncLabel = syncStatus === "syncing" ? "⟳ syncing"
    : syncStatus === "synced"  ? "✓ saved"
    : syncStatus === "error"   ? "⚠ offline"
    : null;
  const syncColor = syncStatus === "error" ? "var(--color-danger)"
    : syncStatus === "synced" ? "var(--color-success)" : "var(--color-accent)";

  // Style Me generator — rendered on both Closet and Style views via
  // `{stylePanelNode}` below. Position:fixed, so DOM location doesn't
  // matter. Extracted so the Style view has a panel to open (previously
  // the nav chip would land on an empty "go back and try again" state).
  const stylePanelNode = (
    <div style={s.stylePanel}>
      {!stylePanelOpen ? (
        /* ── Collapsed: one-tap button ── */
        <button style={{...s.btnPrimary, width:"100%", padding:"14px 20px"}}
          onClick={() => setStylePanelOpen(true)}>
          <Icon path={icons.sparkle} size={15}/> Style Me
        </button>
      ) : (
        /* ── Expanded: full controls ── */
        <>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
            <div style={s.panelLabel}>✦ STYLE ME</div>
            <button onClick={() => setStylePanelOpen(false)}
              style={{background:"none", border:"none", color:"var(--color-text-muted)", fontSize:18, cursor:"pointer", padding:"0 4px", lineHeight:1}}>✕</button>
          </div>

          {/* WHERE ARE YOU GOING? — occasion pills */}
          <div style={{fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", marginBottom:6}}>WHERE ARE YOU GOING?</div>
          <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
            {OCCASIONS.map(o => (
              <button key={o}
                style={occasion === o
                  ? {...s.chip, ...s.chipActive, fontSize:11, padding:"6px 12px"}
                  : {...s.chip, fontSize:11, padding:"6px 12px"}}
                onClick={() => {
                  setOccasion(o);
                  // Auto-set smart defaults per occasion
                  if (o === "Interview" || o === "Executive") {
                    setStyleExcludes(new Set(["no-jeans","trousers-only"]));
                  } else if (o === "Work") {
                    setStyleExcludes(new Set(["no-jeans"]));
                  } else {
                    setStyleExcludes(new Set());
                  }
                }}>
                {o}
              </button>
            ))}
          </div>

          {/* WHAT'S THE WEATHER? */}
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6}}>
            <div style={{fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)"}}>WHAT'S THE WEATHER?</div>
            <button
              onClick={async () => {
                setWeatherLoading(true);
                try {
                  const label = await getLocalWeatherLabel();
                  setWeather(label);
                } catch (err) {
                  console.warn("[F2] auto-weather failed:", err);
                } finally {
                  setWeatherLoading(false);
                }
              }}
              disabled={weatherLoading}
              style={{background:"none", border:"none", color:"var(--color-text)", fontSize:10, letterSpacing:"0.1em", textDecoration:"underline", cursor:"pointer", padding:0}}>
              {weatherLoading ? "locating…" : "✦ use my location"}
            </button>
          </div>
          <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
            {[
              ["","Any"],["Hot (85°F+)","Hot"],["Warm (70-84°F)","Warm"],
              ["Mild (55-69°F)","Mild"],["Cool (40-54°F)","Cool"],
              ["Cold (below 40°F)","Cold"],["Rainy","Rainy"],
            ].map(([val,label]) => (
              <button key={val}
                style={weather === val
                  ? {...s.chip, ...s.chipActive, fontSize:11, padding:"5px 11px"}
                  : {...s.chip, fontSize:11, padding:"5px 11px"}}
                onClick={() => setWeather(val)}>
                {label}
              </button>
            ))}
          </div>

          {/* MOOD — F2 */}
          <div style={{fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", marginBottom:6}}>MOOD (OPTIONAL)</div>
          <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
            <button
              style={mood === ""
                ? {...s.chip, ...s.chipActive, fontSize:11, padding:"5px 11px"}
                : {...s.chip, fontSize:11, padding:"5px 11px"}}
              onClick={() => setMood("")}>
              None
            </button>
            {MOODS.map(m => (
              <button key={m.key}
                style={mood === m.key
                  ? {...s.chip, ...s.chipActive, fontSize:11, padding:"5px 11px"}
                  : {...s.chip, fontSize:11, padding:"5px 11px"}}
                onClick={() => setMood(m.key)}>
                {m.label}
              </button>
            ))}
          </div>

          {/* DON'T INCLUDE — user exclusion toggles */}
          <div style={{fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", marginBottom:6}}>DON'T INCLUDE</div>
          <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
            {[
              ["no-jeans","No Jeans"],
              ["no-skirts","No Skirts"],
              ["no-dresses","No Dresses"],
              ["trousers-only","Trousers Only"],
              ["no-boots","No Boots"],
              ["heels-only","Heels Only"],
              ["no-knits","No Knits"],
            ].map(([key,label]) => (
              <button key={key}
                style={styleExcludes.has(key)
                  ? {...s.chip, background:"var(--color-danger)", borderColor:"var(--color-danger)", color:"#fff", fontSize:11, padding:"5px 11px", fontWeight:500}
                  : {...s.chip, fontSize:11, padding:"5px 11px"}}
                onClick={() => setStyleExcludes(prev => {
                  const next = new Set(prev);
                  // Handle mutual exclusivity
                  if (key === "trousers-only" && !next.has(key)) { next.delete("no-skirts"); }
                  if (key === "heels-only" && !next.has(key)) { next.delete("no-boots"); }
                  next.has(key) ? next.delete(key) : next.add(key);
                  return next;
                })}>
                {label}
              </button>
            ))}
          </div>

          {/* ANYTHING SPECIFIC? */}
          <input placeholder="Anything specific? (e.g. 'use my red blazer', 'all black', 'navy and brown')"
            value={request} onChange={e=>setRequest(e.target.value)}
            style={{...s.input, width:"100%", fontSize:12, marginBottom:8}}/>

          {styleErr && <p style={s.err}>{styleErr}</p>}
          <button style={{...s.btnPrimary, width:"100%"}}
            onClick={() => { handleStyle(); }}
            disabled={styling}>
            {styling
              ? <><span style={s.spinnerSm}/> Styling…</>
              : <><Icon path={icons.sparkle} size={15}/> Generate 3 Looks</>}
          </button>
        </>
      )}
    </div>
  );

  return (
    <div style={s.app}>
      {/* GLOBAL KEYFRAMES */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=DM+Serif+Display&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box; }
        input, select, button { font-family: inherit; }
      `}</style>

      {/* ── HEADER ── */}
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.brand}>
            <span style={s.brandMark}>✦</span>
            <span style={s.brandName}>ATELIER</span>
            {syncLabel && (
              <span
                style={{...s.savedPill, background: syncColor, cursor: syncStatus === "error" ? "pointer" : "default"}}
                title={syncStatus === "error" ? "Tap to retry loading your wardrobe" : undefined}
                onClick={syncStatus === "error" ? reloadFromSupabase : undefined}
              >{syncStatus === "error" ? "⚠ offline — tap to retry" : syncLabel}</span>
            )}
          </div>
          <nav style={s.nav}>
            {[["home","Home"],["closet","Closet"],["style","Style Me"],["planner","Planner"],["favorites","Saved"]].map(([v,label]) => (
              <button key={v} onClick={() => {
                setView(v);
                // Clicking the Style Me nav always opens the generator
                // panel — matches the home CTA behavior so there's no
                // dead-end landing on the Style view with no panel open.
                if (v === "style") setStylePanelOpen(true);
              }}
                style={{...s.navBtn, ...(view===v ? s.navActive : {})}}>
                {label}
                {v==="closet" && items.length > 0 &&
                  <span style={s.badge}>{items.length}</span>}
              </button>
            ))}
            <button
              onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
              style={s.navBtn}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              <Icon path={theme === "dark" ? icons.sun : icons.moon} size={15}/>
            </button>
            <button onClick={() => setView("settings")}
              style={{...s.navBtn, ...(view==="settings" ? s.navActive : {})}}>
              <Icon path={icons.settings} size={15}/>
            </button>
          </nav>
        </div>
      </header>

      {/* ── CLOSET ── */}
      {view === "home" && (
        <div style={s.page}>
          <div style={{ ...s.pageHeader, justifyContent: "center" }}>
            <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Atelier</h2>
          </div>
          <HomeView
            items={items}
            onOpenPlanner={() => setView("planner")}
            onOpenStyle={() => { setView("style"); setStylePanelOpen(true); }}
            onOpenWear={() => setView("favorites")}
            onGenerateForDay={handleGenerateForDay}
            onPinLookToDate={async (iso, look) => {
              await sb.saveOutfitLog({
                garment_ids: look.items || [],
                date_worn: null,
                occasion: look.occasion || "Work",
                notes: null,
                collage_url: JSON.stringify({ look_name: look.name, mood: look.mood, styling: look.styling || look.why }),
              });
              await savePlan({ date: iso, items: look.items || [], source: "ai", occasion: look.occasion || "Work", notes: null });
            }}
          />
        </div>
      )}

      {view === "closet" && (
        <div style={s.page}>
          <FilterBar items={items} activeFilters={activeFilters} onChange={setActiveFilters}/>

          {/* Global search bar */}
          <div style={{ position:"relative", marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Search by brand, color, item type..."
              value={closetSearch}
              onChange={e => setClosetSearch(e.target.value)}
              style={{
                width:"100%", padding:"10px 14px 10px 36px", boxSizing:"border-box",
                border:"1px solid var(--color-border)", borderRadius:8, fontSize:13,
                fontFamily:"'DM Sans',Inter,system-ui,sans-serif",
                background:"#FDFBF9", color:"#2C2420", outline:"none",
              }}
            />
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
              stroke="var(--color-text-muted)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            {closetSearch && (
              <button onClick={() => setClosetSearch("")}
                style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
                  background:"none", border:"none", color:"var(--color-text-muted)", cursor:"pointer", fontSize:16, padding:"0 4px" }}>
                ✕
              </button>
            )}
          </div>
          {closetSearch.trim() && (
            <div style={{ fontSize:11, color:"var(--color-text-muted)", marginBottom:8 }}>
              {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{closetSearch.trim()}"
            </div>
          )}

          {/* Sets visual grid view */}
          {isSetView && (<>
            {/* Sets search + filter bar */}
            <div style={ss.filterBar}>
              <div style={ss.searchRow}>
                <input
                  style={ss.searchInput}
                  placeholder="Search sets…"
                  value={setsSearch}
                  onChange={e => setSetsSearch(e.target.value)}
                />
                <select style={ss.sortSelect} value={setsSort} onChange={e => setSetsSort(e.target.value)}>
                  <option value="recent">Recently Created</option>
                  <option value="alpha">A – Z</option>
                  <option value="count">Most Items</option>
                </select>
              </div>
              <div style={ss.tagRow}>
                {SET_TAGS.map(tag => (
                  <button key={tag}
                    style={setsTagFilter === tag ? {...s.chip,...s.chipActive} : s.chip}
                    onClick={() => setSetsTagFilter(prev => prev === tag ? "" : tag)}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Sets grid */}
            {setGroups?.length === 0 ? (
              <div style={s.empty}>
                <div style={s.emptyMark}>✦</div>
                <p style={s.emptyText}>
                  {setsSearch || setsTagFilter
                    ? "No sets match your search."
                    : "No coord sets yet. Link pieces as a set in Edit Item."}
                </p>
              </div>
            ) : (
              <>
                <div style={ss.countLabel}>{setGroups.length} set{setGroups.length !== 1 ? "s" : ""}</div>
                <div style={ss.grid}>
                  {setGroups.map((group, gi) => (
                    <SetCard
                      key={group.setId}
                      group={group}
                      index={gi}
                      onEdit={() => setEditingSet(group.setId)}
                      onOpen={() => {
                        // Navigate to view showing this set's items
                        setActiveFilters(f => ({ ...f, category: [], subcategory: [], sets: "Sets Only" }));
                        // We'll just open the edit modal for now
                        setEditingSet(group.setId);
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Set Edit Modal */}
            {editingSet && (
              <SetEditModal
                setId={editingSet}
                meta={setsMeta[editingSet] || { name: "", tags: [] }}
                groupItems={items.filter(it => it.set_id === editingSet)}
                allItems={items}
                onSave={(data) => { updateSetMeta(editingSet, data); setEditingSet(null); }}
                onDelete={() => { deleteSetMeta(editingSet); setEditingSet(null); }}
                onClose={() => setEditingSet(null)}
                onEditItem={(item) => { setEditItem(item); setView("edit"); setEditingSet(null); }}
              />
            )}
          </>)}

          {/* Landing view: Recently Added + uncategorized when no filters active */}
          {!isSetView && !activeFilters.category?.length && !activeFilters.subcategory?.length && !activeFilters.color?.length && !activeFilters.brand?.length && !activeFilters.sets && !activeFilters.lastWorn && (() => {
            const now = Date.now();
            const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
            const recentItems = items
              .filter(it => it.created_at && (now - new Date(it.created_at).getTime()) < TWO_WEEKS)
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            const uncategorized = items.filter(it => !it.subcategory);
            const showRecent = recentItems.length > 0;
            const showUncat = uncategorized.length > 0;
            if (!showRecent && !showUncat) return null;
            return (
              <div>
                {showRecent && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", color: "var(--color-text-2)", marginBottom: 10, textTransform: "uppercase" }}>
                      Recently Added
                    </div>
                    <div style={s.grid}>
                      {recentItems.map(item => (
                        <ItemCard key={item.id} item={item} allItems={items}
                          onDelete={deleteItem}
                          onEdit={() => { setEditItem(item); setView("edit"); }}
                          isFavorited={isFav("piece", item.id)}
                          onToggleFav={() => toggleFav("piece", item.id)}/>
                      ))}
                    </div>
                  </div>
                )}
                {showUncat && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", color: "var(--color-text-2)", marginBottom: 10, textTransform: "uppercase" }}>
                      Needs Categorizing
                    </div>
                    <div style={s.grid}>
                      {uncategorized.map(item => (
                        <ItemCard key={item.id} item={item} allItems={items}
                          onDelete={deleteItem}
                          onEdit={() => { setEditItem(item); setView("edit"); }}
                          isFavorited={isFav("piece", item.id)}
                          onToggleFav={() => toggleFav("piece", item.id)}/>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Regular grid — when a category/filter is selected OR search is active */}
          {!isSetView && (closetSearch.trim() || activeFilters.category?.length > 0 || activeFilters.subcategory?.length > 0 || activeFilters.color?.length > 0 || activeFilters.brand?.length > 0 || !!activeFilters.sets || !!activeFilters.lastWorn) && (filtered.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyMark}>✦</div>
              <p style={s.emptyText}>No items match your filters.</p>
            </div>
          ) : (
            <div style={s.grid}>
              {filtered.map(item => (
                <ItemCard key={item.id} item={item} allItems={items}
                  onDelete={deleteItem}
                  onEdit={() => { setEditItem(item); setView("edit"); }}
                  isFavorited={isFav("piece", item.id)}
                  onToggleFav={() => toggleFav("piece", item.id)}/>
              ))}
            </div>
          ))}

          {/* Empty wardrobe state */}
          {items.length === 0 && (
            <div style={s.empty}>
              <div style={s.emptyMark}>✦</div>
              <p style={s.emptyText}>Your wardrobe is empty — add your first piece.</p>
              <button style={s.btnPrimary} onClick={() => setView("add")}>
                <Icon path={icons.plus} size={15}/> Add Items
              </button>
            </div>
          )}

          {stylePanelNode}

          {/* FAB */}
          <button style={s.fab} onClick={() => setView("add")}>
            <Icon path={icons.plus} size={22}/>
          </button>
        </div>
      )}

      {/* ── ADD ── */}
      {view === "add" && (
        <BulkAddView onAdd={addItems} onBack={() => setView("closet")} rmbgKey={rmbgKey} apiKey={apiKey}/>
      )}

      {/* ── EDIT ── */}
      {view === "edit" && editItem && (
        <EditItemView
          item={editItem}
          allItems={items}
          setsMeta={setsMeta}
          onSave={(fields) => { updateItem(editItem.id, fields); setView("closet"); }}
          onDelete={() => { deleteItem(editItem.id); setView("closet"); }}
          onBack={() => setView("closet")}/>
      )}

      {/* ── LOOKS ── */}
      {view === "style" && (
        <div style={s.page}>
          <div style={s.pageHeader}>
            <button style={s.backBtn} onClick={() => setView("closet")}>← Back</button>
            <h2 style={s.pageTitle}>Your Looks</h2>
          </div>
          {styling && (
            <div style={s.empty}>
              <span style={s.spinner}/>
              <p style={s.emptyText}>Styling your wardrobe…</p>
            </div>
          )}
          {/* Notes when fewer than 3 looks generated */}
          {outfitNotes && outfits && outfits.length < 3 && (
            <div style={{background:"var(--color-bg)", border:"1px solid #E8D9BE", borderRadius:8, padding:"12px 16px", margin:"0 16px 16px", fontSize:12, color:"#6B4E1A", lineHeight:1.5}}>
              <span style={{fontWeight:600}}>Note:</span> {outfitNotes}
            </div>
          )}
          {outfits && outfits.map((look, i) => (
            <LookCard key={i} look={look} items={items} apiKey={apiKey}
              onRate={async (lk, rating) => {
                try {
                  const itemIds = (lk.items || []).map(it => typeof it === "object" ? it.id : it);
                  await saveLookFeedback({
                    lookHash: lookHash({ occasion: lk.occasion || occasion, itemIds, mood }),
                    rating,
                    itemIds,
                    occasion: lk.occasion || occasion,
                    mood: mood || null,
                  });
                  // refresh aggregate scores so next generation reflects the new rating
                  const scores = await fetchItemFeedbackScores().catch(() => null);
                  if (scores) setFeedbackScores(scores);
                } catch (err) {
                  console.warn("[F2] saveLookFeedback failed:", err);
                }
              }}
              onSaveLook={async (log) => {
                await sb.saveOutfitLog(log);
                const dateWorn = log.date_worn;
                const ids = log.garment_ids || [];
                if (dateWorn) {
                  await Promise.all(ids.map(id => sb.updateItemLastWorn(id, dateWorn)));
                  bumpWearCounts(ids); // F6 — track wear count
                  const updated = items.map(it =>
                    ids.includes(it.id)
                      ? {...it, last_worn: dateWorn, wear_count: (it.wear_count || 0) + 1}
                      : it
                  );
                  persistItems(updated);
                }
                flashSync("synced");
              }}/>
          ))}
          {!outfits && !styling && (
            <div style={s.empty}>
              <div style={s.emptyMark}>✦</div>
              <p style={s.emptyText}>Ready when you are — pick an occasion and generate your first looks.</p>
              <button style={{...s.btnPrimary, padding:"12px 24px"}}
                onClick={() => setStylePanelOpen(true)}>
                <Icon path={icons.sparkle} size={15}/> Open Style Me
              </button>
            </div>
          )}
          {stylePanelNode}
        </div>
      )}

      {/* ── COLOR ADVISOR ── */}
      {view === "color" && (
        <ColorAdvisorView items={items} apiKey={apiKey}/>
      )}

      {/* ── PLANNER (F3) ── */}
      {view === "planner" && (
        <div style={s.page}>
          <div style={s.pageHeader}>
            <button style={s.backBtn} onClick={() => setView("closet")}>← Back</button>
            <h2 style={s.pageTitle}>Planner</h2>
          </div>
          <PlannerWrapper items={items} onGoToStyleMe={() => setView("style")}/>
        </div>
      )}

      {/* ── SAVED (Looks / History / Favorites) ── */}
      {view === "favorites" && (
        <SavedView
          items={items}
          apiKey={apiKey}
          favorites={favorites}
          toggleFav={toggleFav}
          isFav={isFav}
          onEditItem={(item) => { setEditItem(item); setView("edit"); }}
          onDeleteLog={async (id) => { await sb.deleteOutfitLog(id); }}
          onUnlog={async (id) => {
            // F6 — decrement wear counts when unlogging
            const log = (await sb.fetchOutfitLogs()).find(l => l.id === id);
            const ids = log?.garment_ids || [];
            await sb.updateOutfitLog(id, { date_worn: null });
            unbumpWearCounts(ids);
            const updated = items.map(it =>
              ids.includes(it.id) ? {...it, wear_count: Math.max(0, (it.wear_count || 0) - 1)} : it
            );
            persistItems(updated);
          }}
          onLogAsWorn={async (id, date) => {
            await sb.updateOutfitLog(id, { date_worn: date });
            // Also update per-item last_worn so rotation tracking sees the wear
            const log = (await sb.fetchOutfitLogs()).find(l => l.id === id);
            const ids = log?.garment_ids || [];
            await Promise.all(ids.map(gid => sb.updateItemLastWorn(gid, date)));
            bumpWearCounts(ids); // F6
            const updated = items.map(it =>
              ids.includes(it.id)
                ? {...it, last_worn: date, wear_count: (it.wear_count || 0) + 1}
                : it
            );
            persistItems(updated);
            flashSync("synced");
          }}
          onWearAgain={async (log) => {
            const today = new Date().toISOString().slice(0, 10);
            const newLog = {
              garment_ids: log.garment_ids,
              date_worn: today,
              occasion: log.occasion,
              notes: null,
              collage_url: log.collage_url,
            };
            await sb.saveOutfitLog(newLog);
            const ids = log.garment_ids || [];
            await Promise.all(ids.map(id => sb.updateItemLastWorn(id, today)));
            bumpWearCounts(ids); // F6
            const updated = items.map(it =>
              ids.includes(it.id)
                ? {...it, last_worn: today, wear_count: (it.wear_count || 0) + 1}
                : it
            );
            persistItems(updated);
            flashSync("synced");
          }}
          onSaveLook={async (log) => {
            await sb.saveOutfitLog(log);
            // F6 — if the save included date_worn, bump counts too
            if (log.date_worn) {
              bumpWearCounts(log.garment_ids || []);
            }
          }}
          onStyleItem={(it) => {
            setRequest(`use my ${it.color ? it.color + " " : ""}${it.subcategory || it.category} "${it.name}"`);
            setView("style");
            setStylePanelOpen(true);
          }}
        />
      )}

      {/* ── INSIGHTS ── */}
      {view === "insights" && (
        <StyleInsightsView items={items} apiKey={apiKey} onBack={() => setView("closet")}/>
      )}

      {/* ── SHOPPING ── */}
      {view === "shop" && (
        <ShoppingView items={items} apiKey={apiKey} onBack={() => setView("closet")}/>
      )}

      {/* ── SETTINGS ── */}
      {view === "settings" && (
        <SettingsView
          apiKey={apiKey}
          rmbgKey={rmbgKey}
          items={items}
          onUpdateItem={updateItem}
          onSave={(k, rk) => {
            saveApiKey(k);  setApiKey(k);
            saveRmbgKey(rk); setRmbgKey(rk);
            sb.saveSettings({ anthropicKey: k, rmbgKey: rk }).catch(() => {});
            setView("closet");
          }}
          onAddItems={addItems}
          onForceSync={forceSyncAll}
          onBack={() => setView("closet")}/>
      )}
    </div>
  );
}

// ── FILTER BAR ────────────────────────────────────────────────────────────────
function FilterBar({ items, activeFilters, onChange }) {
  const [expandedColor, setExpandedColor] = useState(null);
  const [showBrand, setShowBrand] = useState(false);
  const [brandSearch, setBrandSearch] = useState("");
  const [showMore, setShowMore] = useState(false);

  const toggle = (type, value) => {
    if (type === "category") {
      // Single-select for categories: toggle off if already selected, otherwise switch
      const current = activeFilters.category || [];
      const next = current.includes(value) ? [] : [value];
      onChange({ ...activeFilters, category: next, subcategory: [], sleeveLength: "" });
    } else {
      const current = activeFilters[type] || [];
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      onChange({ ...activeFilters, [type]: next });
    }
  };

  const setSingle = (type, value) => {
    onChange({ ...activeFilters, [type]: activeFilters[type] === value ? "" : value });
  };

  const isActive = (type, value) => (activeFilters[type] || []).includes(value);
  const clearAll = () => onChange({ category: [], subcategory: [], color: [], brand: [], sleeveLength: "", sets: "", lastWorn: "" });
  const hasActive = Object.values(activeFilters).some(v => Array.isArray(v) ? v.length > 0 : !!v);

  // Unique brands from wardrobe
  const brands = [...new Set(items.map(it => it.brand).filter(Boolean))].sort();
  const filteredBrands = brands.filter(b => b.toLowerCase().includes(brandSearch.toLowerCase()));

  // Subcategories: only show when exactly one category is selected (scoped to that category)
  const selectedCats = activeFilters.category?.filter(c => c !== "Sets") || [];
  const subcatOptions = (() => {
    if (selectedCats.length !== 1) return [];   // only show for single-category selection
    const cat = selectedCats[0];
    const subs = [];
    (TAXONOMY[cat] || []).forEach(sub => {
      // Only show subcategories that actually have items
      if (items.some(it => it.category === cat && it.subcategory === sub)) subs.push(sub);
      // Also check L3 subcategories
      (SUBCATEGORY_L3[sub] || []).forEach(l3 => {
        if (items.some(it => it.category === cat && it.subcategory === l3)) subs.push(l3);
      });
    });
    return subs;   // preserve TAXONOMY order instead of sorting alphabetically
  })();

  return (
    <div style={s.filterBar}>
      {/* Category chips */}
      <div style={s.filterSection}>
        <div style={s.filterRow}>
          {["All", ...CATEGORY_ORDER].map(cat => (
            <button key={cat}
              onClick={() => cat === "All" ? onChange({ ...activeFilters, category: [], subcategory: [], sleeveLength: "" }) : toggle("category", cat)}
              style={{
                ...s.chip,
                ...((cat === "All" && !activeFilters.category?.length) || isActive("category", cat) ? s.chipActive : {}),
              }}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Subcategory chips — single-select, scoped to selected category */}
      {subcatOptions.length > 0 && (
        <div style={s.filterSection}>
          <div style={s.filterRow}>
            {subcatOptions.map(sub => (
              <button key={sub}
                onClick={() => {
                  // Single-select: toggle off if already selected, otherwise switch to this one
                  const current = activeFilters.subcategory || [];
                  const next = current.includes(sub) ? [] : [sub];
                  onChange({ ...activeFilters, subcategory: next });
                }}
                style={{...s.chip, ...(isActive("subcategory", sub) ? s.chipActive : {})}}>
                {sub}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sleeve length filter — only when Tops or Dresses is selected */}
      {(() => {
        const cat = selectedCats.length === 1 ? selectedCats[0] : null;
        if (cat !== "Tops" && cat !== "Dresses") return null;
        const SLEEVE_OPTIONS = ["Sleeveless", "Short Sleeve", "Long Sleeve"];
        // For Tops: map subcategories to sleeve lengths
        const TOPS_SLEEVE_MAP = {
          "Tanks": "Sleeveless",
          "T-Shirts": "Short Sleeve", "Polos": "Short Sleeve", "Short Sleeve": "Short Sleeve",
          "Blouses": "Long Sleeve", "Shirts": "Long Sleeve", "Tops": "Long Sleeve",
          "Light Knit Tops": "Long Sleeve",
        };
        return (
          <div style={s.filterSection}>
            <div style={s.filterSectionLabel}>Sleeve Length</div>
            <div style={s.filterRow}>
              {SLEEVE_OPTIONS.map(sl => (
                <button key={sl}
                  onClick={() => onChange({ ...activeFilters, sleeveLength: activeFilters.sleeveLength === sl ? "" : sl })}
                  style={{...s.chip, ...(activeFilters.sleeveLength === sl ? s.chipActive : {})}}>
                  {sl}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Denim wash filter — only when Jeans subcategory is explicitly selected */}
      {(() => {
        if (!(activeFilters.subcategory || []).includes("Jeans")) return null;
        const WASH_ORDER = ["Light Wash", "Medium Wash", "Dark Wash", "Black Wash"];
        return (
          <div style={s.filterSection}>
            <div style={s.filterSectionLabel}>Wash</div>
            <div style={s.filterRow}>
              {WASH_ORDER.map(wash => (
                <button key={wash}
                  onClick={() => {
                    const current = activeFilters.color || [];
                    const next = current.includes(wash) ? current.filter(v => v !== wash) : [...current, wash];
                    onChange({ ...activeFilters, color: next });
                  }}
                  style={{...s.chip, ...(isActive("color", wash) ? s.chipActive : {})}}>
                  {wash}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Color swatches */}
      <div style={s.filterSection}>
        <div style={s.filterSectionLabel}>Color</div>
        <div style={s.filterRow}>
          {COLOR_FAMILIES.map(family => (
            <div key={family.name} style={{position:"relative"}}>
              <button
                onClick={() => setExpandedColor(expandedColor === family.name ? null : family.name)}
                style={{
                  ...s.swatchBtn,
                  background: family.hex,
                  boxShadow: isActive("color", family.name)
                    ? `0 0 0 2px var(--color-ink), 0 0 0 4px ${family.hex}`
                    : expandedColor === family.name
                    ? `0 0 0 2px var(--color-accent)`
                    : "none",
                  border: family.name === "White" || family.name === "Neutral" ? "1px solid var(--color-border)" : "none",
                }}
                title={family.name}
              />
              {/* Shade expansion */}
              {expandedColor === family.name && family.shades.length > 1 && (
                <div style={s.shadePopover}>
                  {family.shades.map(shade => (
                    <button key={shade.name}
                      onClick={() => { toggle("color", shade.name); setExpandedColor(null); }}
                      style={{
                        ...s.shadeSwatch,
                        background: shade.hex,
                        boxShadow: isActive("color", shade.name) ? `0 0 0 2px var(--color-ink)` : "none",
                        border: shade.name === "White" || shade.name === "Ivory" || shade.name === "Neutral" ? "1px solid var(--color-border)" : "none",
                      }}
                      title={shade.name}
                    />
                  ))}
                </div>
              )}
              {expandedColor === family.name && family.shades.length === 1 && (() => {
                toggle("color", family.name);
                setExpandedColor(null);
                return null;
              })()}
            </div>
          ))}
        </div>
      </div>

      {/* Brand filter */}
      <div style={s.filterSection}>
        <button style={s.filterToggleBtn} onClick={() => setShowBrand(v => !v)}>
          Brand {activeFilters.brand?.length > 0 ? `(${activeFilters.brand.length})` : ""} {showBrand ? "▲" : "▼"}
        </button>
        {showBrand && (
          <div style={s.brandPanel}>
            <input style={{...s.input, marginBottom:8, fontSize:12, padding:"6px 8px"}}
              placeholder="Search brands…" value={brandSearch}
              onChange={e => setBrandSearch(e.target.value)}/>
            <div style={{display:"flex", flexWrap:"wrap", gap:6}}>
              {filteredBrands.map(brand => (
                <button key={brand}
                  onClick={() => toggle("brand", brand)}
                  style={{...s.chip, ...(isActive("brand", brand) ? s.chipActive : {}), fontSize:10}}>
                  {brand}
                </button>
              ))}
              {filteredBrands.length === 0 && (
                <span style={{fontSize:11, color:"var(--color-text-muted)"}}>No brands found</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* More: Sets + Last Worn */}
      <div style={s.filterSection}>
        <button style={s.filterToggleBtn} onClick={() => setShowMore(v => !v)}>
          More Filters {showMore ? "▲" : "▼"}
        </button>
      </div>

      {showMore && (
        <>
          <div style={s.filterSection}>
            <div style={s.filterSectionLabel}>Sets</div>
            <div style={s.filterRow}>
              {["Sets Only","Separates Only","Part of a Set"].map(opt => (
                <button key={opt}
                  onClick={() => setSingle("sets", opt)}
                  style={{...s.chip, fontSize:10, ...(activeFilters.sets === opt ? s.chipActive : {})}}>
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div style={s.filterSection}>
            <div style={s.filterSectionLabel}>Last Worn</div>
            <div style={s.filterRow}>
              {[{label:"Not worn in 30 days", val:"30"},{label:"60 days", val:"60"},{label:"90 days", val:"90"}].map(opt => (
                <button key={opt.val}
                  onClick={() => setSingle("lastWorn", opt.val)}
                  style={{...s.chip, fontSize:10, ...(activeFilters.lastWorn === opt.val ? s.chipActive : {})}}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Active filter pills + clear */}
      {hasActive && (
        <div style={s.activePills}>
          {Object.entries(activeFilters).flatMap(([type, values]) => {
            if (Array.isArray(values)) {
              return values.map(val => (
                <button key={`${type}-${val}`}
                  onClick={() => toggle(type, val)}
                  style={s.activePill}>
                  {val} ✕
                </button>
              ));
            } else if (values) {
              return [(
                <button key={`${type}-${values}`}
                  onClick={() => setSingle(type, values)}
                  style={s.activePill}>
                  {type === "lastWorn" ? `Not worn ${values}d` : values} ✕
                </button>
              )];
            }
            return [];
          })}
          <button onClick={clearAll} style={s.clearAllBtn}>Clear all</button>
        </div>
      )}
    </div>
  );
}

// ── SET CARD — 2-column grid card with mini collage ──────────────────────────
function SetCard({ group, index, onEdit, onOpen }) {
  const thumbItems = group.items.slice(0, 4);
  const name = group.name || `Set ${index + 1}`;
  return (
    <div style={ss.card} onClick={onEdit}>
      {/* Mini collage of first 4 items */}
      <div style={ss.collage}>
        {thumbItems.map((it, i) => (
          <div key={it.id} style={{
            ...ss.collageTile,
            ...(thumbItems.length === 1 ? { width: "100%", height: "100%" } :
                thumbItems.length === 2 ? { width: "50%", height: "100%" } :
                thumbItems.length === 3 && i === 0 ? { width: "50%", height: "100%" } :
                thumbItems.length === 3 ? { width: "50%", height: "50%" } :
                { width: "50%", height: "50%" }),
          }}>
            {it.image
              ? <img src={it.image} alt={it.name} style={ss.collageImg}/>
              : <div style={ss.collagePlaceholder}>{(it.category || "?")[0]}</div>}
          </div>
        ))}
        {thumbItems.length === 0 && (
          <div style={ss.collagePlaceholder}>✦</div>
        )}
      </div>
      {/* Info */}
      <div style={ss.cardBody}>
        <div style={ss.cardName}>{name}</div>
        <div style={ss.cardCount}>{group.items.length} piece{group.items.length !== 1 ? "s" : ""}</div>
        {group.tags.length > 0 && (
          <div style={ss.cardTags}>
            {group.tags.map(t => <span key={t} style={ss.tagChip}>{t}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── SET EDIT MODAL — name + tags + item list ─────────────────────────────────
function SetEditModal({ setId, meta, groupItems, allItems, onSave, onDelete, onClose, onEditItem }) {
  const [name, setName] = useState(meta.name || "");
  const [tags, setTags] = useState(meta.tags || []);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggleTag = (tag) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={{...s.modalCard, maxWidth: 440}} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <div style={s.modalTitle}>Edit Set</div>
          <button style={s.modalClose} onClick={onClose}>×</button>
        </div>

        <div style={{ padding: "16px 22px" }}>
          {/* Name */}
          <div style={{ marginBottom: 16 }}>
            <div style={s.modalLabel}>SET NAME</div>
            <input
              style={s.modalInput}
              placeholder="e.g. Navy Work Set, Weekend Linen"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Tags */}
          <div style={{ marginBottom: 16 }}>
            <div style={s.modalLabel}>TAGS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SET_TAGS.map(tag => (
                <button key={tag}
                  style={tags.includes(tag) ? {...s.chip,...s.chipActive} : s.chip}
                  onClick={() => toggleTag(tag)}>
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Pieces in this set */}
          <div style={{ marginBottom: 16 }}>
            <div style={s.modalLabel}>PIECES IN THIS SET ({groupItems.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 200, overflowY: "auto" }}>
              {groupItems.map(it => (
                <div key={it.id} style={ss.modalItem} onClick={() => onEditItem(it)}>
                  {it.image
                    ? <img src={it.image} alt={it.name} style={ss.modalItemThumb}/>
                    : <div style={{...ss.modalItemThumb, background:"var(--color-surface-3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"var(--color-border-muted)"}}>{(it.category || "?")[0]}</div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                    <div style={{ fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.06em" }}>{it.category}{it.subcategory ? ` · ${it.subcategory}` : ""}</div>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--color-border-muted)" }}>→</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ padding: "0 22px 22px", display: "flex", flexDirection: "column", gap: 8 }}>
          <button style={s.modalSaveBtn} onClick={() => onSave({ name, tags })}>
            Save Set
          </button>
          <button
            style={{ background: "none", border: "none", fontSize: 11, color: confirmDelete ? "var(--color-danger)" : "var(--color-text-muted)", cursor: "pointer", padding: "6px 0", letterSpacing: "0.04em" }}
            onClick={() => confirmDelete ? onDelete() : setConfirmDelete(true)}>
            {confirmDelete ? "Tap again to confirm — this unlinks all pieces" : "Delete Set"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SET PANEL — shows partner pieces when "Part of Set" badge is tapped ───────
function SetPanel({ item, allItems, onClose }) {
  const partners = allItems.filter(it => it.set_id && it.set_id === item.set_id && it.id !== item.id);
  return (
    <div style={s.setPanel}>
      <div style={s.setPanelHeader}>
        <span style={s.setPanelTitle}>Coord Set</span>
        <button style={s.setPanelClose} onClick={onClose}>✕</button>
      </div>
      <div style={s.setPanelItems}>
        {[item, ...partners].map(it => (
          <div key={it.id} style={s.setPanelItem}>
            {it.image
              ? <img src={it.image} alt={it.name} style={s.setPanelThumb}/>
              : <div style={{...s.setPanelThumb, background:"var(--color-surface-3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:"var(--color-border-muted)"}}>{it.category?.[0]}</div>}
            <div style={s.setPanelName}>{it.name}</div>
            <div style={s.setPanelCat}>{it.category}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ITEM CARD ─────────────────────────────────────────────────────────────────
function ItemCard({ item, allItems, onDelete, onEdit, isFavorited, onToggleFav }) {
  const [confirm,  setConfirm]  = useState(false);
  const [showSet,  setShowSet]  = useState(false);
  const isPartOfSet = item.set_id && item.is_separable;
  return (
    <div style={s.card}>
      <div style={s.cardImg} onClick={onEdit}>
        {item.image
          ? <img src={item.image} alt={item.name} style={s.cardPhoto}/>
          : <div style={s.cardPlaceholder}>{item.category?.[0] || "?"}</div>}
        {isPartOfSet && (
          <button style={s.setBadge}
            onClick={e => { e.stopPropagation(); setShowSet(v => !v); }}>
            Part of Set
          </button>
        )}
      </div>
      {showSet && <SetPanel item={item} allItems={allItems} onClose={() => setShowSet(false)}/>}
      <div style={s.cardBody}>
        <div style={s.cardCat}>
          {item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}
        </div>
        <div style={s.cardName}>{item.name}</div>
        {item.brand && <div style={{...s.cardColor,fontStyle:"italic"}}>{item.brand}</div>}
        {item.color && <div style={s.cardColor}>{item.color}</div>}
        {item.notes && <div style={s.cardNotes}>{item.notes}</div>}
      </div>
      <div style={s.cardActions}>
        {onToggleFav && (
          <button style={s.iconBtn} onClick={onToggleFav} title="Favorite">
            <svg width={13} height={13} viewBox="0 0 24 24"
              fill={isFavorited ? "var(--color-danger)" : "none"}
              stroke={isFavorited ? "var(--color-danger)" : "currentColor"}
              strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d={icons.heart}/>
            </svg>
          </button>
        )}
        <button style={s.iconBtn} onClick={onEdit} title="Edit">
          <Icon path={icons.edit} size={13}/>
        </button>
        <button style={{...s.iconBtn, color: confirm ? "var(--color-danger)" : "var(--color-border-muted)"}}
          onClick={() => confirm ? onDelete(item.id) : setConfirm(true)}
          title={confirm ? "Confirm" : "Delete"}>
          {confirm ? "✓" : <Icon path={icons.trash} size={13}/>}
        </button>
      </div>
    </div>
  );
}

// ── BULK ADD VIEW ─────────────────────────────────────────────────────────────
function BulkAddView({ onAdd, onBack, rmbgKey, apiKey }) {
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
          material: "", pattern: "", tags: [], has_bg: false,
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

// ── EDIT ITEM VIEW ────────────────────────────────────────────────────────────
function EditItemView({ item, allItems, onSave, onDelete, onBack, setsMeta: setsMetaProp }) {
  const [form, setForm] = useState({
    name: item.name, category: item.category, subcategory: item.subcategory || "",
    brand: item.brand || "", color: item.color || "", notes: item.notes || "",
    image: item.image || "", set_id: item.set_id || "", is_separable: item.is_separable || false,
    // F1 fields — editable inline
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

        {/* ── F1 — auto-detected fields (all editable) ─────────────── */}
        <div style={{display:"flex",gap:10}}>
          <div style={{flex:1}}>
            <div style={s.fieldLabel}>Color hex</div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {form.primary_color_hex && (
                <span style={{width:26,height:26,borderRadius:4,border:"1px solid var(--color-border-strong)",background:form.primary_color_hex,flexShrink:0}}/>
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

        {/* F6 — purchase price for cost-per-wear */}
        <div>
          <div style={s.fieldLabel}>Purchase price (USD, optional)</div>
          <input type="number" min="0" step="1" style={{...s.input,width:"100%"}}
            placeholder="e.g. 450"
            value={form.price_paid}
            onChange={e => setForm(f => ({...f, price_paid: e.target.value ? Number(e.target.value) : ""}))}/>
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
              setForm(f => ({ ...f, set_id: newId }));
            } else {
              setForm(f => ({ ...f, set_id: val }));
            }
          }}>
          <option value="">— Not part of a set —</option>
          <option value="__new__">+ Create new set</option>
          {(() => {
            // Build unique set IDs from items
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
          <label style={{display:"flex", alignItems:"center", gap:8, fontSize:12, color:"var(--color-text)", cursor:"pointer"}}>
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
      <button style={{...s.btnSecondary,width:"100%",color:confirm?"var(--color-danger)":"var(--color-text-muted)"}}
        onClick={() => confirm ? onDelete() : setConfirm(true)}>
        {confirm ? "Tap again to confirm delete" : "Delete Item"}
      </button>
    </div>
  );
}

// ── SETTINGS VIEW ─────────────────────────────────────────────────────────────
// STYLE_PREFS_KEY / ABOUT_ME_KEY live in utils/storage.js so they're migrated
// with the rest of the namespaced keys.
function loadStylePrefs() {
  try { return JSON.parse(localStorage.getItem(STYLE_PREFS_KEY)) || STYLE_PREFS; }
  catch { return STYLE_PREFS; }
}
function saveStylePrefsLocal(prefs) { localStorage.setItem(STYLE_PREFS_KEY, JSON.stringify(prefs)); }

function loadAboutMe() {
  try { return JSON.parse(localStorage.getItem(ABOUT_ME_KEY)) || {}; }
  catch { return {}; }
}
function saveAboutMe(data) { localStorage.setItem(ABOUT_ME_KEY, JSON.stringify(data)); }

function SettingsView({ apiKey, rmbgKey, onSave, onBack, items = [], onUpdateItem, onAddItems, onForceSync }) {
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
    if (!apiKey || orphans.length === 0) return;
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
            "x-api-key": apiKey,
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

  const updatePrefs = (updated) => { setPrefs(updated); saveStylePrefsLocal(updated); };
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
                  onClick={handleAiCategorize} disabled={aiCatRunning || !apiKey}>
                  {aiCatRunning ? (
                    <><span style={s.spinnerSm}/>  Categorizing...</>
                  ) : apiKey ? "AI Categorize All" : "Add API key above"}
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

// ── EDITORIAL FLAT-LAY COLLAGE ────────────────────────────────────────────────
// Positions pieces as floating, slightly overlapping items on a clean background
// Layout: clothing anchored left/center, shoes bottom-left, bag bottom-right, accessories scattered
function EditorialCollage({ lookItems, suggestionSlots = [] }) {
  const order = ["Outerwear","Dresses","Tops","Bottoms","Shoes","Bags","Accessories","Belts","Scarves"];
  const sorted = [...lookItems]
    .sort((a,b) => (order.indexOf(a.category)??99) - (order.indexOf(b.category)??99));

  // Assign editorial positions based on category and count
  // Each slot: { item, x, y, w, h, rotate, zIndex }
  const slots = buildCollageLayout(sorted, suggestionSlots);

  return (
    <div style={s.collageCanvas}>
      {slots.map((slot, i) => (
        <div key={slot.id || i} style={{
          position: "absolute",
          left: `${slot.x}%`,
          top: `${slot.y}%`,
          width: `${slot.w}%`,
          height: `${slot.h}%`,
          transform: `rotate(${slot.rotate}deg)`,
          zIndex: slot.zIndex,
          filter: "drop-shadow(0 4px 14px rgba(28,24,20,0.18))",
        }}>
          {slot.isSuggestion ? (
            <div style={s.elevSlotPh}>
              <div style={s.elevSlotBrand}>{slot.item?.split(" ").slice(0,2).join(" ")}</div>
              <div style={s.elevSlotItem}>{slot.item?.split(" ").slice(2).join(" ")}</div>
              <div style={s.elevSlotPrice}>{slot.price}</div>
              <div style={s.elevSlotBadge}>{slot.type === "swap" ? "SWAP" : "ADD"}</div>
            </div>
          ) : slot.image ? (
            <img src={slot.image} alt={slot.name}
              style={{width:"100%", height:"100%", objectFit:"contain", objectPosition:"center top", display:"block"}}/>
          ) : (
            <div style={{...s.collagePh, height:"100%"}}>
              <span style={s.collageCat}>{slot.category?.[0]}</span>
              <span style={s.collageName}>{slot.name}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Build layout positions based on item categories
function buildCollageLayout(items, suggestionSlots = []) {
  const all = [...items, ...suggestionSlots.map(s => ({...s, isSuggestion:true}))];

  const BAG_SUBS = new Set(["Bags","Clutch","Crossbody","Shoulder","Tote","Pouch","Minaudière","Wristlet","Baguette"]);
  const BAG_RE   = /\b(bag|purse|tote|clutch|handbag|satchel|hobo|pouch|wristlet|baguette)\b/i;

  const getRole = (item) => {
    const cat  = item.category    || "";
    const sub  = item.subcategory || "";
    const name = item.name        || "";
    if (cat === "Outerwear") return "layer";
    if (cat === "Knits")     return "layer";  // Cardigans & pullovers are layers
    if (cat === "Bottoms")   return "bottom";
    if (cat === "Shoes")     return "shoes";
    if (cat === "Dresses" || cat === "Jumpsuits" || (cat === "Occasionwear" && /dress|gown/i.test(sub))) return "dress";
    if (cat === "Bags") return "bag";
    if (cat === "Belts") return "belt";
    if (cat === "Accessories" && (BAG_SUBS.has(sub) || BAG_RE.test(name))) return "bag";
    if (cat === "Accessories" && /\bbelt\b/i.test(name)) return "belt";
    if (cat === "Accessories") return "accessory";
    return "top";
  };

  // Deduplicate: keep only the first item per role (prevents 2 shoes, 2 bags, etc.)
  const seenRoles = new Set();
  const deduped = [];
  all.forEach(item => {
    const role = getRole(item);
    // Allow multiple tops and accessories, but only one of: shoes, bag, belt, bottom, dress, layer
    const singletonRoles = new Set(["shoes", "bag", "belt"]);
    if (singletonRoles.has(role) && seenRoles.has(role)) return;
    seenRoles.add(role);
    deduped.push(item);
  });

  const g = { layer:[], top:[], dress:[], bottom:[], shoes:[], bag:[], belt:[], accessory:[] };
  deduped.forEach(item => { const r = getRole(item); if (g[r]) g[r].push(item); });

  // ── Dynamic layout engine ──
  // Determines layout based on whether outfit is dress-based or separates-based
  const hasDress = g.dress.length > 0;
  const hasBottom = g.bottom.length > 0;
  const hasTop = g.top.length > 0;
  const hasLayer = g.layer.length > 0;
  const hasBelt = g.belt.length > 0;
  const hasBag = g.bag.length > 0;
  const hasShoes = g.shoes.length > 0;

  const slots = [];
  const zMap = { layer:5, top:4, dress:4, bottom:2, shoes:8, bag:7, belt:10, accessory:11 };
  const place = (role, pos) => {
    if (g[role].length > 0) {
      slots.push({ ...g[role][0], x:pos.x, y:pos.y, w:pos.w, h:pos.h, rotate:0, zIndex: zMap[role] || 6 });
    }
  };

  if (hasDress) {
    // ── DRESS-BASED LAYOUT ──
    if (hasLayer) {
      // Dress + Layer (cardigan/blazer over dress)
      place("layer",  { x:1,  y:1,  w:44, h:50 });
      place("dress",  { x:47, y:1,  w:48, h:56 });
      if (hasBelt) place("belt", { x:20, y:52, w:40, h:14 });
      if (hasShoes) place("shoes", { x:1, y:56, w:30, h:28 });
      if (hasBag) place("bag", { x:55, y:62, w:32, h:28 });
    } else if (hasTop) {
      // Dress + Top (e.g. bodysuit under dress, or top layered)
      place("top",    { x:1,  y:1,  w:40, h:44 });
      place("dress",  { x:43, y:1,  w:52, h:56 });
      if (hasBelt) place("belt", { x:20, y:52, w:40, h:14 });
      if (hasShoes) place("shoes", { x:1, y:56, w:30, h:28 });
      if (hasBag) place("bag", { x:55, y:62, w:32, h:28 });
    } else {
      // Dress only (no layer or top)
      place("dress",  { x:18, y:1,  w:52, h:58 });
      if (hasBelt) place("belt", { x:14, y:52, w:44, h:14 });
      if (hasShoes) place("shoes", { x:1, y:64, w:32, h:28 });
      if (hasBag) place("bag", { x:55, y:64, w:32, h:28 });
    }
  } else {
    // ── SEPARATES-BASED LAYOUT (top + bottom) ──
    if (hasLayer && hasTop) {
      // Layer + Top + Bottom
      place("layer",  { x:1,  y:1,  w:46, h:44 });
      place("top",    { x:49, y:1,  w:46, h:40 });
      if (hasBelt) place("belt", { x:1, y:43, w:46, h:14 });
      place("bottom", { x:1,  y:48, w:44, h:46 });
      if (hasBag) place("bag", { x:47, y:48, w:30, h:26 });
      if (hasShoes) place("shoes", { x:47, y:74, w:30, h:24 });
    } else if (hasLayer) {
      // Layer + Bottom (no separate top — layer IS the top)
      place("layer",  { x:14, y:1,  w:52, h:44 });
      if (hasBelt) place("belt", { x:4, y:40, w:46, h:14 });
      place("bottom", { x:1,  y:48, w:44, h:46 });
      if (hasBag) place("bag", { x:47, y:48, w:30, h:26 });
      if (hasShoes) place("shoes", { x:47, y:74, w:30, h:24 });
    } else {
      // Top + Bottom (no layer)
      place("top",    { x:14, y:1,  w:52, h:44 });
      if (hasBelt) place("belt", { x:4, y:40, w:46, h:14 });
      place("bottom", { x:1,  y:48, w:44, h:46 });
      if (hasBag) place("bag", { x:47, y:48, w:30, h:26 });
      if (hasShoes) place("shoes", { x:47, y:74, w:30, h:24 });
    }
  }

  // ── Skip extra items — never stack duplicates. The validator limits these,
  // but if any slip through, we just don't render them in the collage.

  // ── Accessories: place in remaining corners ──
  if (g.accessory.length > 0) {
    const accPositions = [
      { x:80, y:1,  w:16, h:16 },
      { x:2,  y:1,  w:16, h:16 },
      { x:80, y:82, w:16, h:14 },
    ];
    // Only place if the corner isn't already occupied by a main item
    const isOccupied = (pos) => slots.some(s =>
      Math.abs(s.x - pos.x) < 20 && Math.abs(s.y - pos.y) < 20
    );
    let accIdx = 0;
    g.accessory.forEach(item => {
      while (accIdx < accPositions.length && isOccupied(accPositions[accIdx])) accIdx++;
      if (accIdx < accPositions.length) {
        slots.push({ ...item, ...accPositions[accIdx], rotate:0, zIndex:11 + accIdx });
        accIdx++;
      }
    });
  }

  return slots.map((slot, i) => ({ ...slot, id: slot.id || `slot-${i}` }));
}

// ── LOOK CARD — EDITORIAL FLAT-LAY ───────────────────────────────────────────
function LookCard({ look, items, apiKey, onSaveLook, onRate }) {
  const [expanded,  setExpanded]  = useState(false);
  const [elevating, setElevating] = useState(false);
  const [elevation, setElevation] = useState(null);
  const [elevErr,   setElevErr]   = useState("");
  const [showSave,  setShowSave]  = useState(false);
  const [rated,     setRated]     = useState(0); // 0 = unrated, -1/+1 = rated

  const order = ["Outerwear","Dresses","Tops","Bottoms","Shoes","Bags","Accessories","Belts","Scarves"];
  const lookItems = (look.items || [])
    .map(id => items.find(i => i.id === id) || items.find(i => String(i.id) === String(id)))
    .filter(Boolean)
    .sort((a,b) => (order.indexOf(a.category)??99) - (order.indexOf(b.category)??99));

  const handleElevate = async () => {
    if (!apiKey) { setElevErr("Add your Anthropic API key in Settings."); return; }
    setElevating(true); setElevErr(""); setElevation(null);
    try {
      const result = await generateElevation(look, lookItems, apiKey);
      setElevation(result);
    } catch(e) {
      setElevErr(e.message || "Elevation failed — try again.");
    } finally { setElevating(false); }
  };

  const elevatedItems = elevation ? (() => {
    const swapTargets = elevation.elevations
      .filter(e => e.type === "swap")
      .map(e => e.swapTarget?.toLowerCase());
    const base = lookItems.filter(it =>
      !swapTargets.some(t => it.name.toLowerCase().includes(t))
    );
    const suggestions = elevation.elevations.map(e => ({
      ...e, isSuggestion:true, id:`sug-${e.item}`, category: e.category,
    }));
    return { base, suggestions };
  })() : null;

  // Identify the hero item for visual badge
  const heroId = look.itemRoles ? Object.entries(look.itemRoles).find(([, role]) => role === "hero")?.[0] : null;

  return (
    <div style={s.lookCard}>
      <div style={s.lookHeader}>
        <div>
          <div style={s.lookName}>{look.name}</div>
          <div style={s.lookOcc}>
            {look.occasion?.toUpperCase()}
            {(look.vibe || look.mood) && <span style={s.lookMood}> · {(look.vibe || look.mood).toUpperCase()}</span>}
          </div>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:6}}>
          {/* F2 — thumbs feedback */}
          {onRate && (
            <>
              <button
                title="Love it"
                onClick={() => {
                  if (rated !== 0) return;
                  setRated(1);
                  onRate(look, 1);
                }}
                style={{background: rated === 1 ? "var(--color-success)" : "none", border:"1px solid " + (rated === 1 ? "var(--color-success)" : "var(--color-border-strong)"), color: rated === 1 ? "#fff" : "var(--color-text)", fontSize:14, padding:"4px 9px", borderRadius:16, cursor: rated === 0 ? "pointer" : "default", lineHeight:1}}>
                ♥
              </button>
              <button
                title="Not for me"
                onClick={() => {
                  if (rated !== 0) return;
                  setRated(-1);
                  onRate(look, -1);
                }}
                style={{background: rated === -1 ? "var(--color-danger)" : "none", border:"1px solid " + (rated === -1 ? "var(--color-danger)" : "var(--color-border-strong)"), color: rated === -1 ? "#fff" : "var(--color-text)", fontSize:14, padding:"4px 9px", borderRadius:16, cursor: rated === 0 ? "pointer" : "default", lineHeight:1}}>
                ✕
              </button>
            </>
          )}
          <button style={s.expandBtn} onClick={()=>setExpanded(e=>!e)}>
            {expanded ? "Hide" : "Details"}
          </button>
        </div>
      </div>

      <EditorialCollage lookItems={lookItems}/>

      {/* Rationale / styling teaser — use rationale (new) or styling (legacy) */}
      {(look.rationale || look.styling || look.jewelry) && (
        <div style={s.lookTeaser}>
          <span style={s.teaserDiamond}>✦</span> {look.rationale || look.styling || look.jewelry}
        </div>
      )}

      {expanded && (
        <div style={s.lookMeta}>
          {/* New styling fields */}
          {look.color_strategy && (
            <div style={s.metaRow}><span style={{...s.metaIcon, color:"#8B6F5E"}}>COLOR</span><span style={{fontSize:12,color:"var(--color-text)"}}>{look.color_strategy}</span></div>
          )}
          {look.silhouette && (
            <div style={s.metaRow}><span style={{...s.metaIcon, color:"#8B6F5E"}}>SILHOUETTE</span><span style={{fontSize:12,color:"var(--color-text)"}}>{look.silhouette}</span></div>
          )}
          {look.texture_story && (
            <div style={s.metaRow}><span style={{...s.metaIcon, color:"#8B6F5E"}}>TEXTURE</span><span style={{fontSize:12,color:"var(--color-text)"}}>{look.texture_story}</span></div>
          )}
          {look.focal_point && (
            <div style={s.metaRow}><span style={{...s.metaIcon, color:"#8B6F5E"}}>FOCAL POINT</span><span style={{fontSize:12,color:"var(--color-text)"}}>{look.focal_point}</span></div>
          )}
          {/* Legacy fields */}
          {look.accessories && <div style={s.metaRow}><span style={s.metaIcon}>✦</span><span>{look.accessories}</span></div>}
          {look.why         && <div style={{...s.metaRow,fontStyle:"italic",color:"var(--color-text-2)"}}>{look.why}</div>}
        </div>
      )}

      {!elevation && (
        <div style={s.elevateBar}>
          {elevErr && <p style={{...s.err,marginBottom:6}}>{elevErr}</p>}
          <div style={{ display:"flex", gap:8 }}>
            <button style={{...s.elevateBtn, flex:1}} onClick={handleElevate} disabled={elevating}>
              {elevating ? <><span style={s.spinnerElevate}/> Elevating…</> : <>✦ Elevate this Look</>}
            </button>
            {onSaveLook && (
              <button style={s.saveBtn} onClick={() => setShowSave(true)}>Save</button>
            )}
          </div>
        </div>
      )}

      {showSave && onSaveLook && (
        <SaveLookModal look={look} lookItems={lookItems} onSave={onSaveLook} onClose={() => setShowSave(false)}/>
      )}

      {elevation && (
        <div style={s.elevatedSection}>
          <div style={s.elevDivider}>
            <div style={s.elevDividerLine}/>
            <span style={s.elevDividerLabel}>ELEVATED</span>
            <div style={s.elevDividerLine}/>
          </div>
          <div style={s.elevHeader}>
            <div style={s.elevName}>{elevation.elevatedLookName}</div>
            {elevation.elevatedWhy && <div style={s.elevWhy}>{elevation.elevatedWhy}</div>}
          </div>
          <EditorialCollage lookItems={elevatedItems.base}/>
          <div style={s.elevSuggestions}>
            {elevation.elevations?.map((e, i) => (
              <div key={i} style={s.elevSuggestionCard}>
                <div style={s.elevSugHeader}>
                  <span style={s.elevSugBadge(e.type)}>{e.type==="swap" ? "↔ SWAP" : "+ ADD"}</span>
                  <span style={s.elevSugPrice}>{e.price}</span>
                </div>
                <div style={s.elevSugItem}>{e.item}</div>
                <div style={s.elevSugDesc}>{e.description}</div>
                {e.swapTarget && <div style={s.elevSugSwap}>Replaces: {e.swapTarget}</div>}
                <div style={s.elevSugWhy}>{e.why}</div>
                <div style={s.elevSugColor}>✓ {e.colorNote}</div>
                <a href={`https://www.google.com/search?q=${encodeURIComponent(e.item)}`}
                  target="_blank" rel="noreferrer"
                  style={{display:"inline-block",marginTop:8,fontSize:11,color:"var(--color-ink)",fontWeight:500,letterSpacing:"0.05em",textDecoration:"none",borderBottom:"1px solid var(--color-ink)"}}>
                  Search this item →
                </a>
              </div>
            ))}
          </div>
          <button style={{...s.elevateBtn,margin:"0 16px 16px",width:"calc(100% - 32px)"}}
            onClick={handleElevate} disabled={elevating}>
            {elevating ? "Elevating…" : "✦ Generate New Elevation"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── SAVE LOOK MODAL ──────────────────────────────────────────────────────────
function SaveLookModal({ look, lookItems, onSave, onClose }) {
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
        notes: notes.trim() || null,
        collage_url: JSON.stringify({ look_name: look.name, mood: look.mood, styling: look.styling || look.why }),
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
              <div style={s.modalLookName}>{look.name}</div>
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

// ── SAVED LOOK CARD (shared skeleton for LooksView / History / Favorites) ───
function SavedLookCard({ log, items, subtitle, headerRight, notes, actions }) {
  const logItems = (log.garment_ids || []).map(id => items.find(i => i.id === id)).filter(Boolean);
  const meta = (() => { try { return JSON.parse(log.collage_url); } catch { return {}; } })();
  return (
    <div style={s.histCard}>
      <div style={s.histCardHeader}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10}}>
          <div>
            {meta.look_name && <div style={s.histLookName}>{meta.look_name}</div>}
            {subtitle && <div style={s.histDate}>{subtitle}</div>}
          </div>
          {headerRight}
        </div>
      </div>
      <div style={s.histThumbs}>
        {logItems.map(it => (
          <div key={it.id} style={s.histThumb}>
            {it.image ? <img src={it.image} alt={it.name} style={s.histThumbImg}/>
              : <div style={s.histThumbPh}>{it.category?.[0]}</div>}
            <div style={s.histThumbName}>{it.name}</div>
          </div>
        ))}
      </div>
      {notes && <div style={s.histNotes}>{notes}</div>}
      {actions && <div style={s.histActions}>{actions}</div>}
    </div>
  );
}

// ── OUTFIT HISTORY ───────────────────────────────────────────────────────────
function OutfitHistory({ items, onWearAgain, onDelete, onUnlog, isFav, toggleFav, nested }) {
  const [logs,       setLogs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filterOcc,  setFilterOcc]  = useState("All");
  const [wearingId,  setWearingId]  = useState(null);
  const [deleteId,   setDeleteId]   = useState(null);
  const [unloggingId, setUnloggingId] = useState(null);

  useEffect(() => {
    sb.fetchOutfitLogs()
      .then(data => { setLogs(data.filter(l => l.date_worn)); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = filterOcc === "All" ? logs : logs.filter(l => l.occasion === filterOcc);
  const grouped = {};
  filtered.forEach(log => {
    const d = log.date_worn || log.created_at?.slice(0, 10) || "Unknown";
    const month = d.slice(0, 7);
    if (!grouped[month]) grouped[month] = [];
    grouped[month].push(log);
  });

  const formatMonth = (ym) => {
    try { const [y, m] = ym.split("-"); return new Date(y, m - 1).toLocaleDateString("en-US", { month:"long", year:"numeric" }); }
    catch { return ym; }
  };
  const formatDate = (d) => {
    try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }); }
    catch { return d; }
  };
  const parseMeta = (url) => { try { return JSON.parse(url); } catch { return {}; } };

  const handleWearAgain = async (log) => {
    setWearingId(log.id);
    try { await onWearAgain(log); const fresh = await sb.fetchOutfitLogs(); setLogs(fresh); }
    catch (e) { console.error(e); }
    finally { setWearingId(null); }
  };
  const handleDelete = async (id) => {
    try { await onDelete(id); setLogs(prev => prev.filter(l => l.id !== id)); setDeleteId(null); }
    catch (e) { console.error(e); }
  };
  const handleUnlog = async (id) => {
    setUnloggingId(id);
    try { await onUnlog(id); setLogs(prev => prev.filter(l => l.id !== id)); }
    catch (e) { console.error(e); }
    finally { setUnloggingId(null); }
  };

  const occasions = ["All", ...new Set(logs.map(l => l.occasion).filter(Boolean))];
  const Wrap = nested ? "div" : "div";
  const wrapStyle = nested ? {} : s.page;

  return (
    <Wrap style={wrapStyle}>
      {!nested && <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Outfit History</h2>}
      {logs.length > 0 && occasions.length > 1 && (
        <div style={s.filterRow}>
          {occasions.map(o => (
            <button key={o} onClick={() => setFilterOcc(o)}
              style={{...s.chip, ...(filterOcc === o ? s.chipActive : {})}}>{o}</button>
          ))}
        </div>
      )}
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading outfit history…</p></div>}
      {!loading && logs.length === 0 && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>No outfits logged yet. Save a look to start your history.</p></div>
      )}
      {!loading && Object.keys(grouped).map(month => (
        <div key={month} style={{ marginBottom:28 }}>
          <div style={s.histMonthLabel}>{formatMonth(month)}</div>
          {grouped[month].map(log => {
            const meta = parseMeta(log.collage_url);
            const subtitle = (
              <>
                {formatDate(log.date_worn)}
                {log.occasion && <span style={s.histOcc}> · {log.occasion}</span>}
                {meta.mood && <span style={s.histMood}> · {meta.mood}</span>}
              </>
            );
            return (
              <SavedLookCard key={log.id} log={log} items={items} subtitle={subtitle} notes={log.notes}
                actions={
                  <>
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)}>
                        <svg width={15} height={15} viewBox="0 0 24 24"
                          fill={isFav("outfit", log.id) ? "var(--color-danger)" : "none"}
                          stroke={isFav("outfit", log.id) ? "var(--color-danger)" : "var(--color-border-muted)"}
                          strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                      </button>
                      <button style={s.histWearBtn} onClick={() => handleWearAgain(log)} disabled={wearingId === log.id}>
                        {wearingId === log.id ? <><span style={s.spinnerElevate}/> Logging…</> : "Wear this again"}
                      </button>
                      <button style={s.histDeleteBtn} onClick={() => handleUnlog(log.id)} disabled={unloggingId === log.id}
                        title="Move back to Looks (clears the wear date)">
                        {unloggingId === log.id ? "…" : "Unlog"}
                      </button>
                    </div>
                    {deleteId === log.id ? (
                      <div style={{ display:"flex", gap:6 }}>
                        <button style={{...s.histDeleteBtn, color:"var(--color-danger)"}} onClick={() => handleDelete(log.id)}>Confirm</button>
                        <button style={s.histDeleteBtn} onClick={() => setDeleteId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button style={s.histDeleteBtn} onClick={() => setDeleteId(log.id)}>Remove</button>
                    )}
                  </>
                }
              />
            );
          })}
        </div>
      ))}
    </Wrap>
  );
}

// ── OUTFIT BUILDER (manual look assembly) ────────────────────────────────────
function OutfitBuilder({ items, onSave, onClose }) {
  const [builderFilters, setBuilderFilters] = useState({ category: [], subcategory: [], color: [], brand: [], sleeveLength: "", sets: "", lastWorn: "" });
  const [builderSearch, setBuilderSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [lookName, setLookName] = useState("");
  const [occasion, setOccasion] = useState("Work");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggleItem = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const filtered = (() => {
    let base = items;
    const cats = builderFilters.category?.filter(c => c !== "Sets") || [];
    if (cats.length) base = base.filter(it => cats.includes(it.category));
    if (builderFilters.subcategory?.length) base = base.filter(it => builderFilters.subcategory.includes(it.subcategory));
    if (builderFilters.sleeveLength) {
      const sl = builderFilters.sleeveLength;
      const TOPS_SLEEVE_MAP = {
        "Tanks": "Sleeveless", "T-Shirts": "Short Sleeve", "Polos": "Short Sleeve", "Short Sleeve": "Short Sleeve",
        "Blouses": "Long Sleeve", "Shirts": "Long Sleeve", "Tops": "Long Sleeve", "Light Knit Tops": "Long Sleeve",
      };
      base = base.filter(it => {
        if (it.category === "Tops") return TOPS_SLEEVE_MAP[it.subcategory] === sl;
        if (it.category === "Dresses") return (it.sleeve_length || "").toLowerCase() === sl.toLowerCase();
        return true;
      });
    }
    if (builderFilters.brand?.length) base = base.filter(it => builderFilters.brand.includes(it.brand));
    if (builderFilters.color?.length) {
      base = base.filter(it => {
        const itemColor = (it.color || "").toLowerCase();
        const itemFamily = (it.color_family || "").toLowerCase();
        return builderFilters.color.some(c => {
          const cl = c.toLowerCase();
          return itemColor.includes(cl) || itemFamily.includes(cl) || itemColor === cl;
        });
      });
    }
    if (builderSearch.trim()) {
      const q = builderSearch.toLowerCase().trim();
      base = base.filter(it => {
        const fields = [it.name, it.brand, it.color, it.color_family, it.subcategory, it.category, it.notes].filter(Boolean);
        return fields.some(f => f.toLowerCase().includes(q));
      });
    }
    return base;
  })();

  const selectedItems = selected.map(id => items.find(i => i.id === id)).filter(Boolean);
  const categoriesInOutfit = [...new Set(selectedItems.map(i => i.category))];

  const handleSave = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      await onSave({
        garment_ids: selected,
        date_worn: null,
        occasion,
        notes: null,
        collage_url: JSON.stringify({ look_name: lookName.trim() || "My Look", mood: null, styling: null }),
      });
      setSaved(true);
      setTimeout(onClose, 1000);
    } catch (e) {
      console.error(e);
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div style={s.page}>
        <div style={{ ...s.empty, padding: "120px 20px" }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>✓</div>
          <div style={{ fontSize: 14, color: "var(--color-success)", letterSpacing: "0.06em" }}>Saved to your looks</div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ ...s.pageTitle, fontFamily: "'DM Serif Display',Georgia,serif", margin: 0 }}>Build a Look</h2>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--color-text-muted)", fontSize: 24, cursor: "pointer", padding: 0, lineHeight: 1 }}>&times;</button>
      </div>

      {/* Selection tray */}
      {selected.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 16px", marginBottom: 16, boxShadow: "0 2px 12px rgba(28,24,20,0.04)" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.18em", color: "var(--color-text-muted)", marginBottom: 8, fontFamily: "sans-serif" }}>
            YOUR LOOK · {selected.length} {selected.length === 1 ? "PIECE" : "PIECES"}
          </div>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
            {selectedItems.map(it => (
              <div key={it.id} style={{ flexShrink: 0, width: 56, textAlign: "center", position: "relative", cursor: "pointer" }}
                onClick={() => toggleItem(it.id)}>
                {it.image
                  ? <img src={it.image} alt={it.name} style={{ width: 56, height: 68, objectFit: "contain", borderRadius: 6, background: "var(--color-surface)" }} />
                  : <div style={{ width: 56, height: 68, borderRadius: 6, background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "var(--color-border-muted)" }}>{it.category?.[0]}</div>
                }
                <div style={{ position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: "50%", background: "var(--color-ink)", color: "var(--color-surface)", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>✕</div>
                <div style={{ fontSize: 8, color: "var(--color-text-muted)", marginTop: 3, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
              </div>
            ))}
          </div>
          {/* Category coverage hints */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {CATEGORY_ORDER.filter(c => ["Tops", "Knits", "Bottoms", "Dresses", "Outerwear", "Shoes", "Bags"].includes(c)).map(cat => (
              <span key={cat} style={{
                fontSize: 9, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 10,
                background: categoriesInOutfit.includes(cat) ? "#E8F5EC" : "var(--color-surface)",
                color: categoriesInOutfit.includes(cat) ? "var(--color-success)" : "var(--color-border-muted)",
                border: `1px solid ${categoriesInOutfit.includes(cat) ? "#B8D9C0" : "var(--color-border)"}`,
              }}>{cat}</span>
            ))}
          </div>
        </div>
      )}

      {/* Save form — inline when items selected */}
      {selected.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 9, letterSpacing: "0.18em", color: "var(--color-text-muted)", display: "block", marginBottom: 5, fontFamily: "sans-serif" }}>NAME</label>
              <input value={lookName} onChange={e => setLookName(e.target.value)}
                placeholder="e.g. Monday Power Look"
                style={{ ...s.modalInput, fontSize: 12 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 9, letterSpacing: "0.18em", color: "var(--color-text-muted)", display: "block", marginBottom: 5, fontFamily: "sans-serif" }}>OCCASION</label>
              <select value={occasion} onChange={e => setOccasion(e.target.value)}
                style={{ ...s.modalInput, fontSize: 12 }}>
                {OCCASIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <button onClick={handleSave} disabled={saving}
            style={{ ...s.btnPrimary, width: "100%", padding: "11px 20px" }}>
            {saving ? <><span style={s.spinnerSm} /> Saving…</> : "Save Look"}
          </button>
        </div>
      )}

      {/* Browse items */}
      <FilterBar items={items} activeFilters={builderFilters} onChange={setBuilderFilters} />
      <div style={{ position: "relative", marginBottom: 12 }}>
        <input type="text" placeholder="Search by brand, color, item type..."
          value={builderSearch} onChange={e => setBuilderSearch(e.target.value)}
          style={{
            width: "100%", padding: "10px 14px 10px 36px", boxSizing: "border-box",
            border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 13,
            fontFamily: "'DM Sans',Inter,system-ui,sans-serif",
            background: "#FDFBF9", color: "#2C2420", outline: "none",
          }} />
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
          stroke="var(--color-text-muted)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        {builderSearch && (
          <button onClick={() => setBuilderSearch("")}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>
            ✕
          </button>
        )}
      </div>
      {builderSearch.trim() && (
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{builderSearch.trim()}"
        </div>
      )}

      {/* Item grid */}
      {filtered.length === 0 ? (
        <div style={s.empty}>
          <div style={s.emptyMark}>✦</div>
          <p style={s.emptyText}>No items match your filters.</p>
        </div>
      ) : (
        <div style={s.grid}>
          {filtered.map(item => {
            const isSelected = selected.includes(item.id);
            return (
              <div key={item.id}
                onClick={() => toggleItem(item.id)}
                style={{
                  ...s.card, cursor: "pointer", position: "relative",
                  border: isSelected ? "2px solid var(--color-ink)" : "1px solid var(--color-border)",
                  boxShadow: isSelected ? "0 2px 12px rgba(28,24,20,0.12)" : "none",
                }}>
                {isSelected && (
                  <div style={{
                    position: "absolute", top: 8, right: 8, width: 22, height: 22,
                    borderRadius: "50%", background: "var(--color-ink)", color: "var(--color-surface)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 600, zIndex: 2, fontFamily: "sans-serif",
                  }}>{selected.indexOf(item.id) + 1}</div>
                )}
                <div style={s.cardImg}>
                  {item.image
                    ? <img src={item.image} alt={item.name} style={s.cardPhoto} />
                    : <div style={s.cardPlaceholder}>{item.category?.[0]}</div>
                  }
                </div>
                <div style={s.cardBody}>
                  <div style={s.cardCat}>{item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}</div>
                  <div style={s.cardName}>{item.name}</div>
                  {item.brand && <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontStyle: "italic" }}>{item.brand}</div>}
                  {item.color && <div style={s.cardColor}>{item.color}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom spacer for fixed save bar */}
      <div style={{ height: 20 }} />
    </div>
  );
}

// ── LOOKS VIEW (saved outfits without a wear date) ──────────────────────────
function LooksView({ items, onDelete, onLogAsWorn, isFav, toggleFav, onSaveLook, apiKey }) {
  const [logs,      setLogs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [loggingId, setLoggingId] = useState(null);
  const [deleteId,  setDeleteId]  = useState(null);
  const [dateById,  setDateById]  = useState({});
  const [showBuilder, setShowBuilder] = useState(false);

  const loadLogs = () => {
    sb.fetchOutfitLogs()
      .then(data => { setLogs(data.filter(l => !l.date_worn)); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(loadLogs, []);

  const parseMeta = (url) => { try { return JSON.parse(url); } catch { return {}; } };
  const today = new Date().toISOString().slice(0, 10);

  const handleLog = async (id) => {
    const date = dateById[id] || today;
    setLoggingId(id);
    try { await onLogAsWorn(id, date); setLogs(prev => prev.filter(l => l.id !== id)); }
    catch (e) { console.error(e); }
    finally { setLoggingId(null); }
  };
  const handleDelete = async (id) => {
    try { await onDelete(id); setLogs(prev => prev.filter(l => l.id !== id)); setDeleteId(null); }
    catch (e) { console.error(e); }
  };

  if (showBuilder) {
    return (
      <SilhouetteBuilder
        items={items}
        apiKey={apiKey}
        onSave={async (log) => {
          await onSaveLook(log);
          setShowBuilder(false);
          setLoading(true);
          loadLogs();
        }}
        onClose={() => setShowBuilder(false)}
      />
    );
  }

  return (
    <div>
      {/* Build a Look button */}
      {!loading && (
        <button onClick={() => setShowBuilder(true)}
          style={{ ...s.btnSecondary, width: "100%", marginBottom: 16, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.plus}/></svg>
          Build a Look
        </button>
      )}
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading your looks…</p></div>}
      {!loading && logs.length === 0 && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>No looks saved yet. Build one manually or generate an outfit in Style Me.</p></div>
      )}
      {!loading && logs.map(log => {
        const meta = parseMeta(log.collage_url);
        const pickedDate = dateById[log.id] || today;
        const subtitle = (
          <>
            {log.occasion && <span>{log.occasion}</span>}
            {meta.mood && <span style={s.histMood}>{log.occasion ? " · " : ""}{meta.mood}</span>}
          </>
        );
        return (
          <SavedLookCard key={log.id} log={log} items={items} subtitle={subtitle} notes={log.notes}
            actions={
              <>
                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                  <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)}>
                    <svg width={15} height={15} viewBox="0 0 24 24"
                      fill={isFav("outfit", log.id) ? "var(--color-danger)" : "none"}
                      stroke={isFav("outfit", log.id) ? "var(--color-danger)" : "var(--color-border-muted)"}
                      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                  </button>
                  <input type="date" value={pickedDate}
                    onChange={e => setDateById(d => ({ ...d, [log.id]: e.target.value }))}
                    style={{ fontSize:12, padding:"4px 6px", border:"1px solid var(--color-border)", borderRadius:6, background:"#FDFBF9", fontFamily:"inherit", color:"#2C2420" }}/>
                  <button style={s.histWearBtn} onClick={() => handleLog(log.id)} disabled={loggingId === log.id}>
                    {loggingId === log.id ? <><span style={s.spinnerElevate}/> Logging…</> : "Log as worn"}
                  </button>
                </div>
                {deleteId === log.id ? (
                  <div style={{ display:"flex", gap:6 }}>
                    <button style={{...s.histDeleteBtn, color:"var(--color-danger)"}} onClick={() => handleDelete(log.id)}>Confirm</button>
                    <button style={s.histDeleteBtn} onClick={() => setDeleteId(null)}>Cancel</button>
                  </div>
                ) : (
                  <button style={s.histDeleteBtn} onClick={() => setDeleteId(log.id)}>Remove</button>
                )}
              </>
            }
          />
        );
      })}
    </div>
  );
}

// ── SAVED VIEW (wrapper with sub-tabs: Looks | History | Favorites) ─────────
function SavedView({ items, favorites, toggleFav, onEditItem, onWearAgain, onDeleteLog, onUnlog, onLogAsWorn, isFav, onSaveLook, apiKey, onStyleItem }) {
  const [tab, setTab] = useState("looks");
  return (
    <div style={s.page}>
      <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Saved</h2>
      <div style={s.filterRow}>
        {[["looks","Looks"],["boards","Boards"],["wear","Wear"],["history","History"],["favorites","Favorites"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{...s.chip, ...(tab === key ? s.chipActive : {})}}>{label}</button>
        ))}
      </div>
      {tab === "looks" && (
        <LooksView items={items} apiKey={apiKey} onDelete={onDeleteLog} onLogAsWorn={onLogAsWorn} isFav={isFav} toggleFav={toggleFav} onSaveLook={onSaveLook}/>
      )}
      {tab === "boards" && (
        <MoodboardView items={items}/>
      )}
      {tab === "wear" && (
        <WearView items={items} onStyleItem={onStyleItem} onEditItem={onEditItem}/>
      )}
      {tab === "history" && (
        <OutfitHistory nested items={items} onWearAgain={onWearAgain} onDelete={onDeleteLog} onUnlog={onUnlog} isFav={isFav} toggleFav={toggleFav}/>
      )}
      {tab === "favorites" && (
        <FavoritesView nested items={items} favorites={favorites} toggleFav={toggleFav} onEditItem={onEditItem}/>
      )}
    </div>
  );
}

// ── FAVORITES VIEW ──────────────────────────────────────────────────────────
function FavoritesView({ items, favorites, toggleFav, onEditItem, nested }) {
  const [tab, setTab] = useState("outfits");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sb.fetchOutfitLogs().then(data => { setLogs(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const favOutfitIds = new Set(favorites.filter(f => f.type === "outfit").map(f => f.reference_id));
  const favPieceIds  = new Set(favorites.filter(f => f.type === "piece").map(f => f.reference_id));
  const favOutfits = logs.filter(l => favOutfitIds.has(l.id));
  const favPieces  = items.filter(i => favPieceIds.has(i.id));

  const parseMeta = (url) => { try { return JSON.parse(url); } catch { return {}; } };
  const formatDate = (d) => {
    try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }); }
    catch { return d; }
  };
  const tabs = [["outfits","Outfits",favOutfits.length],["pieces","Pieces",favPieces.length],["shopping","Shopping",0]];

  return (
    <div style={nested ? {} : s.page}>
      {!nested && <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Favorites</h2>}
      <div style={s.filterRow}>
        {tabs.map(([key, label, count]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{...s.chip, ...(tab === key ? s.chipActive : {})}}>
            {label}{count > 0 && <span style={{ marginLeft:5, opacity:0.6 }}>{count}</span>}
          </button>
        ))}
      </div>
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading favorites…</p></div>}
      {!loading && tab === "outfits" && (
        favOutfits.length === 0
          ? <div style={s.empty}><p style={s.emptyText}>No favorite outfits yet. Tap the heart on any outfit in History.</p></div>
          : favOutfits.map(log => {
              const subtitle = (
                <>
                  {formatDate(log.date_worn)}{log.occasion && <span style={s.histOcc}> · {log.occasion}</span>}
                </>
              );
              return (
                <SavedLookCard key={log.id} log={log} items={items} subtitle={subtitle} notes={log.notes}
                  headerRight={
                    <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)}>
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="var(--color-danger)" stroke="var(--color-danger)"
                        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                    </button>
                  }
                />
              );
            })
      )}
      {!loading && tab === "pieces" && (
        favPieces.length === 0
          ? <div style={s.empty}><p style={s.emptyText}>No favorite pieces yet. Tap the heart on any item.</p></div>
          : <div style={s.grid}>
              {favPieces.map(item => (
                <div key={item.id} style={s.card}>
                  <div style={s.cardImg} onClick={() => onEditItem(item)}>
                    {item.image ? <img src={item.image} alt={item.name} style={s.cardPhoto}/> : <div style={s.cardPlaceholder}>{item.category?.[0]}</div>}
                  </div>
                  <div style={s.cardBody}>
                    <div style={s.cardCat}>{item.category}</div>
                    <div style={s.cardName}>{item.name}</div>
                    {item.color && <div style={s.cardColor}>{item.color}</div>}
                  </div>
                  <div style={s.cardActions}>
                    <button style={s.heartBtn} onClick={() => toggleFav("piece", item.id)}>
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="var(--color-danger)" stroke="var(--color-danger)"
                        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
      )}
      {!loading && tab === "shopping" && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>Shopping favorites coming soon.</p></div>
      )}
    </div>
  );
}

// ── STYLE INSIGHTS ANALYSIS ──────────────────────────────────────────────────
function analyzeWardrobe(items, outfitLogs) {
  const results = {};
  const catCounts = {};
  items.forEach(it => { catCounts[it.category] = (catCounts[it.category] || 0) + 1; });
  const coreCats = ["Tops","Knits","Bottoms","Dresses","Shoes"];
  const maxCore = Math.max(...coreCats.map(c => catCounts[c] || 0), 1);
  results.categoryGaps = coreCats
    .filter(c => (catCounts[c] || 0) < 3 && (catCounts[c] || 0) < maxCore * 0.4)
    .map(c => ({ category: c, count: catCounts[c] || 0, maxCategory: coreCats.reduce((a, b) => (catCounts[a] || 0) > (catCounts[b] || 0) ? a : b), maxCount: maxCore }));
  results.catCounts = catCounts;

  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  results.underutilized = items.filter(it => {
    if (it.is_active_rotation === false) return false;
    if (!it.last_worn) return true;
    return (now - new Date(it.last_worn).getTime()) > thirtyDays;
  }).slice(0, 8);

  const pairMap = {};
  outfitLogs.forEach(log => {
    const ids = log.garment_ids || [];
    const logItems = ids.map(id => items.find(it => it.id === id)).filter(Boolean);
    const colors = [...new Set(logItems.map(it => it.color_family || it.color).filter(Boolean))];
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const key = [colors[i], colors[j]].sort().join(" + ");
        pairMap[key] = (pairMap[key] || 0) + 1;
      }
    }
  });
  results.colorPairs = Object.entries(pairMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([pair, count]) => ({ pair, count }));
  results.signaturePairs = results.colorPairs.filter(p => p.count >= 3);
  const wearCounts = {};
  outfitLogs.forEach(log => { (log.garment_ids || []).forEach(id => { wearCounts[id] = (wearCounts[id] || 0) + 1; }); });
  results.wardrobeAnchors = Object.entries(wearCounts).filter(([, c]) => c >= 5).sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ item: items.find(it => it.id === id), count })).filter(a => a.item);
  results.totalOutfits = outfitLogs.length;
  return results;
}



// ── STYLE INSIGHTS VIEW ───────────────────────────────────────────────────
function StyleInsightsView({ items, apiKey, onBack }) {
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState(null);
  const [outfitLogs, setOutfitLogs] = useState([]);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileErr, setProfileErr] = useState("");
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(INSIGHTS_DISMISSED_KEY) || "[]"); } catch { return []; }
  });
  const dismiss = (key) => { const next = [...dismissed, key]; setDismissed(next); localStorage.setItem(INSIGHTS_DISMISSED_KEY, JSON.stringify(next)); };
  const isDismissed = (key) => dismissed.includes(key);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const logs = await sb.fetchOutfitLogs().catch(() => []);
      if (cancelled) return;
      setOutfitLogs(logs);
      setAnalysis(analyzeWardrobe(items, logs));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [items]);

  const handleGenerateProfile = async () => {
    if (!apiKey) { setProfileErr("Add your Anthropic API key in Settings."); return; }
    setProfileLoading(true); setProfileErr(""); setProfile("");
    try {
      const final = await streamStyleProfile(items, outfitLogs, analysis, apiKey, (partial) => {
        setProfile(partial);
      });
      setProfile(final);
    } catch (e) { setProfileErr(e.message); }
    finally { setProfileLoading(false); }
  };

  if (loading) return (
    <div style={s.page}><div style={s.pageHeader}><button style={s.backBtn} onClick={onBack}>← Back</button>
    <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Style Intelligence</h2></div>
    <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Analyzing your wardrobe…</p></div></div>
  );
  if (!items.length) return (
    <div style={s.page}><div style={s.pageHeader}><button style={s.backBtn} onClick={onBack}>← Back</button>
    <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Style Intelligence</h2></div>
    <div style={s.empty}><div style={{fontSize:42,color:"#DDD5CC",marginBottom:8}}>✦</div>
    <p style={{...s.emptyText,maxWidth:280}}>Add items to unlock your style intelligence</p></div></div>
  );

  const hasLogs = outfitLogs.length > 0;
  return (
    <div style={s.page}>
      <div style={s.pageHeader}><button style={s.backBtn} onClick={onBack}>← Back</button>
      <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Style Intelligence</h2></div>

      {!isDismissed("profile") && <div style={si.profileCard}>
        <div style={si.cardDismiss} onClick={() => dismiss("profile")}>✕</div>
        <div style={si.sectionLabel}>MONTHLY PROFILE</div>
        {profile ? <div style={si.profileText}>{profile}</div>
          : <p style={si.profilePlaceholder}>{apiKey ? "Generate an AI-written style profile." : "Add your API key in Settings."}</p>}
        {profileErr && <p style={s.err}>{profileErr}</p>}
        <button style={si.profileBtn} onClick={handleGenerateProfile} disabled={profileLoading || !apiKey}>
          {profileLoading ? <><span style={s.spinnerSm}/> Writing…</> : profile ? "✦ Regenerate" : "✦ Generate Profile"}
        </button>
      </div>}

      {hasLogs && analysis.signaturePairs.length > 0 && !isDismissed("signatures") && <div style={si.card}>
        <div style={si.cardDismiss} onClick={() => dismiss("signatures")}>✕</div>
        <div style={si.sectionHeader}>Signature Patterns</div>
        {analysis.signaturePairs.map((p, i) => (
          <div key={i} style={si.insightRow}>
            <div style={si.swatchPair}><span style={{...si.swatchDot, background:colorHex(p.pair.split(" + ")[0])}}/><span style={{...si.swatchDot, background:colorHex(p.pair.split(" + ")[1])}}/></div>
            <div style={si.insightText}>You've worn <strong>{p.pair}</strong> together {p.count} times — signature.</div>
          </div>
        ))}
        {analysis.wardrobeAnchors.length > 0 && <>
          <div style={si.divider}/><div style={{...si.sectionLabel,marginBottom:8}}>WARDROBE ANCHORS</div>
          {analysis.wardrobeAnchors.map((a, i) => (
            <div key={i} style={si.insightRow}>
              <div style={si.anchorThumb}>{a.item.image ? <img src={a.item.image} alt="" style={si.anchorImg}/> : <span style={{color:"var(--color-border-muted)"}}>{a.item.category?.[0]}</span>}</div>
              <div style={si.insightText}><strong>{a.item.name}</strong> — worn {a.count} times.</div>
            </div>
          ))}
        </>}
      </div>}

      {!isDismissed("gaps") && <div style={si.card}>
        <div style={si.cardDismiss} onClick={() => dismiss("gaps")}>✕</div>
        <div style={si.sectionHeader}>Category Breakdown</div>
        <div style={si.barContainer}>
          {CATEGORY_ORDER.map(cat => {
            const count = analysis.catCounts[cat] || 0;
            const max = Math.max(...Object.values(analysis.catCounts), 1);
            return (<div key={cat} style={si.barRow}><div style={si.barLabel}>{cat}</div>
              <div style={si.barTrack}><div style={{...si.barFill, width:`${Math.max((count/max)*100,2)}%`}}/></div>
              <div style={si.barCount}>{count}</div></div>);
          })}
        </div>
        {analysis.categoryGaps.length > 0 && <><div style={si.divider}/>
          {analysis.categoryGaps.map((g, i) => <div key={i} style={si.gapAlert}>You have {analysis.catCounts[g.maxCategory]||0} {g.maxCategory.toLowerCase()} but only {g.count} {g.category.toLowerCase()} — consider filling this gap.</div>)}
        </>}
      </div>}

      {analysis.underutilized.length > 0 && !isDismissed("underutilized") && <div style={si.card}>
        <div style={si.cardDismiss} onClick={() => dismiss("underutilized")}>✕</div>
        <div style={si.sectionHeader}>Underutilized Pieces</div>
        <p style={si.subtleNote}>Active items you haven't worn in 30+ days</p>
        <div style={si.underutilGrid}>
          {analysis.underutilized.map(item => {
            const days = item.last_worn ? Math.floor((Date.now() - new Date(item.last_worn).getTime()) / 86400000) : null;
            return (<div key={item.id} style={si.underutilCard}><div style={si.underutilImg}>
              {item.image ? <img src={item.image} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/> : <span style={{color:"var(--color-border-muted)",fontSize:22}}>{item.category?.[0]}</span>}
            </div><div style={si.underutilMeta}><div style={{fontSize:10,letterSpacing:"0.1em",color:"var(--color-text-muted)"}}>{item.category}</div>
              <div style={{fontSize:12,marginTop:2}}>{item.name}</div>
              <div style={{fontSize:10,color:"var(--color-accent)",marginTop:3}}>{days ? `${days} days ago` : "Never worn"}</div>
            </div></div>);
          })}
        </div>
      </div>}

      {hasLogs && analysis.colorPairs.length > 0 && !isDismissed("colorpairs") && <div style={si.card}>
        <div style={si.cardDismiss} onClick={() => dismiss("colorpairs")}>✕</div>
        <div style={si.sectionHeader}>Color Pair Frequency</div>
        <div style={si.pairGrid}>
          {analysis.colorPairs.map((p, i) => { const [a, b] = p.pair.split(" + "); return (
            <div key={i} style={si.pairChip}><span style={{...si.swatchDot, background:colorHex(a), width:18, height:18}}/>
              <span style={{fontSize:10,color:"var(--color-text-muted)"}}>+</span><span style={{...si.swatchDot, background:colorHex(b), width:18, height:18}}/>
              <span style={{fontSize:11,marginLeft:4}}>{p.count}×</span></div>
          ); })}
        </div>
      </div>}

      {!hasLogs && <div style={si.card}><div style={{...si.sectionLabel,marginBottom:8}}>OUTFIT DATA</div>
        <p style={si.subtleNote}>Log outfits from the Looks tab to unlock signature patterns, color pair analysis, and AI style profiles.</p>
      </div>}
    </div>
  );
}


// ── SHOPPING VIEW ───────────────────────────────────────────────────────────
function ShoppingView({ items, apiKey, onBack }) {
  const [mode, setMode] = useState("gap");
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState("");

  const toggleItem = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleAnalyze = async () => {
    if (!apiKey) { setErr("Add your Anthropic API key in Settings."); return; }
    if (mode === "complete" && selectedIds.length === 0) { setErr("Select at least one piece."); return; }
    setLoading(true); setErr(""); setResults(null);
    try {
      const data = await generateShoppingRecs(items, apiKey, mode, selectedIds);
      setResults(data);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
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
          <button key={m} onClick={() => { setMode(m); setResults(null); setErr(""); }}
            style={{...s.modeTab, ...(mode === m ? s.modeTabActive : {})}}>{label}</button>
        ))}
      </div>

      {mode === "gap" && (
        <div style={s.advisorNote}>Analyzes your wardrobe against the full taxonomy to find missing and thin categories, then suggests specific pieces to buy.</div>
      )}

      {mode === "complete" && (
        <>
          <div style={s.advisorNote}>Select pieces from your wardrobe, and AI will suggest what to buy to complete or elevate the outfit.</div>
          <div style={{...s.grid, marginBottom:20}}>
            {items.filter(it => it.image).slice(0, 30).map(item => (
              <div key={item.id} style={{...s.card, border: selectedIds.includes(item.id) ? "2px solid var(--color-ink)" : "1px solid var(--color-border)", cursor:"pointer"}}
                onClick={() => toggleItem(item.id)}>
                <div style={{...s.cardImg, height:120}}>
                  <img src={item.image} alt={item.name} style={s.cardPhoto}/>
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
      <button style={{...s.btnPrimary, width:"100%", marginBottom:20}} onClick={handleAnalyze} disabled={loading}>
        {loading ? <><span style={s.spinnerSm}/> Analyzing…</> : <><Icon path={icons.sparkle} size={15}/> {mode === "gap" ? "Run Gap Analysis" : `Find Pieces (${selectedIds.length} selected)`}</>}
      </button>

      {results && mode === "gap" && results.gaps && (
        <div>
          <div style={{fontSize:11,letterSpacing:"0.2em",color:"var(--color-text-muted)",marginBottom:16,fontFamily:"sans-serif"}}>
            {results.gaps.length} GAPS FOUND
          </div>
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
            </div>
          ))}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PLANNER WRAPPER (F3) ─────────────────────────────────────────────────────
// Fetches saved outfit_logs on mount and passes them to CalendarView so the
// "pick a saved look" tab inside the day modal has something to show.
function PlannerWrapper({ items, onGoToStyleMe }) {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    sb.fetchOutfitLogs().then(setLogs).catch(() => {});
  }, []);
  return <CalendarView items={items} outfitLogs={logs} onGoToStyleMe={onGoToStyleMe}/>;
}
