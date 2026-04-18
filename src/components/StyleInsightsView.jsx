import { useState, useEffect } from "react";
import { s, si } from "../ui/styles.js";
import { sb } from "../lib/supabase.js";
import { generateStyleProfile, colorHex } from "../lib/ai/stylist.js";
import { CATEGORY_ORDER } from "../constants/taxonomy.js";
import { loadInsightsDismissed, saveInsightsDismissed } from "../utils/storage.js";

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

export default function StyleInsightsView({ items, apiKey, onBack }) {
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState(null);
  const [outfitLogs, setOutfitLogs] = useState([]);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileErr, setProfileErr] = useState("");
  const [dismissed, setDismissed] = useState(() => loadInsightsDismissed());
  const dismiss = (key) => { const next = [...dismissed, key]; setDismissed(next); saveInsightsDismissed(next); };
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
    setProfileLoading(true); setProfileErr("");
    try { setProfile(await generateStyleProfile(items, outfitLogs, analysis, apiKey)); }
    catch (e) { setProfileErr(e.message); }
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
              <div style={si.anchorThumb}>{a.item.image ? <img src={a.item.image} alt="" style={si.anchorImg}/> : <span style={{color:"#C8BFB4"}}>{a.item.category?.[0]}</span>}</div>
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
              {item.image ? <img src={item.image} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/> : <span style={{color:"#C8BFB4",fontSize:22}}>{item.category?.[0]}</span>}
            </div><div style={si.underutilMeta}><div style={{fontSize:10,letterSpacing:"0.1em",color:"#9A8E84"}}>{item.category}</div>
              <div style={{fontSize:12,marginTop:2}}>{item.name}</div>
              <div style={{fontSize:10,color:"#C4A882",marginTop:3}}>{days ? `${days} days ago` : "Never worn"}</div>
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
              <span style={{fontSize:10,color:"#9A8E84"}}>+</span><span style={{...si.swatchDot, background:colorHex(b), width:18, height:18}}/>
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
