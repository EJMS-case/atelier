// ── STYLE PROFILE ────────────────────────────────────────────────────────────
// Roadmap B (owner survey 2026-08-08; placement "Inside Home" chosen by her
// 2026-08-19): the taste surfaces move OUT of Settings into one place that
// reads like her stylist's file on her —
//   · Style Fingerprint ("your stylist's read") + refresh, now with a
//     freshness line (how many new looks since the last read),
//   · Color pairings editor + SUGGESTED pairs derived from her loved looks
//     (deterministic, zero AI calls — families that co-occur in looks she
//     hearted and aren't already on her list),
//   · Style modes, and About Me (body + context fields).
// Settings keeps only plumbing (keys, photo tools, data tools) and a pointer
// here. All persistence is unchanged: prefs/About Me in localStorage via
// storage.js (per-device, same as before), fingerprint in user_settings.

import { useMemo, useState } from "react";
import { s } from "../../ui/styles.js";
import { sb } from "../../lib/supabase.js";
import { loadStylePrefs, saveStylePrefs, loadAboutMe, saveAboutMe } from "../../utils/storage.js";
import { generateStyleFingerprint } from "../stylist/styleFingerprint.js";
import { fetchAllPlans } from "../planner/plannerApi.js";
import { familyForColorString } from "../../constants/color.js";
import { resolveItemIds } from "../../utils/item-helpers.js";
import { PALETTE } from "../../constants/palette.js";

// Families that ground a look rather than color-block it — suggestions pair
// the actual colors, so neutrals sit out.
const NEUTRAL_FAMILIES = new Set(["Black", "Gray", "Brown", "Neutrals", "White"]);

// Pairs of non-neutral color families that co-occur inside looks she LOVED,
// most-frequent first, excluding pairs (in either order) already on her list.
function suggestPairsFromLoved(lovedLooks, items, existingPairs) {
  const existing = new Set(
    (existingPairs || []).map(p =>
      p.toLowerCase().split("+").map(x => x.trim()).sort().join("+")
    )
  );
  const counts = new Map();
  (lovedLooks || []).forEach(ll => {
    const fams = [...new Set(
      resolveItemIds(items, ll.garment_ids)
        .map(it => familyForColorString(it.color || ""))
        .filter(f => f && !NEUTRAL_FAMILIES.has(f))
    )].sort();
    for (let i = 0; i < fams.length; i++) {
      for (let j = i + 1; j < fams.length; j++) {
        const key = `${fams[i]}+${fams[j]}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  });
  return [...counts.entries()]
    .filter(([key]) => !existing.has(key.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => key.replace("+", " + "));
}

export default function StyleProfileView({
  items = [], apiKey, styleFingerprint, setStyleFingerprint,
  lovedLooks = [], logCount = null, onBack,
}) {
  const [prefs, setPrefs] = useState(() => loadStylePrefs());
  const [newPair, setNewPair] = useState("");
  const [aboutMe, setAboutMe] = useState(() => loadAboutMe());
  const [fpRunning, setFpRunning] = useState(false);
  const [fpError, setFpError] = useState("");

  const updatePrefs = (updated) => { setPrefs(updated); saveStylePrefs(updated); };
  const updateAboutMe = (updated) => { setAboutMe(updated); saveAboutMe(updated); };
  const removePair = (i) => updatePrefs({ ...prefs, colorPairs: prefs.colorPairs.filter((_, idx) => idx !== i) });
  const addPair = (pair) => {
    const v = (pair ?? newPair).trim();
    if (!v) return;
    updatePrefs({ ...prefs, colorPairs: [...prefs.colorPairs, v] });
    setNewPair("");
  };

  const suggestions = useMemo(
    () => suggestPairsFromLoved(lovedLooks, items, prefs.colorPairs),
    [lovedLooks, items, prefs.colorPairs],
  );

  // "What changed since the last read": outfits logged beyond the count the
  // fingerprint was generated from. The auto-refresh on app load fires at
  // 10+ — this line makes the drift visible before that.
  const newSinceRead = (typeof logCount === "number" && styleFingerprint?.source_count)
    ? Math.max(0, logCount - styleFingerprint.source_count)
    : null;

  const handleRefreshFingerprint = async () => {
    if (!apiKey) { setFpError("Add your Anthropic API key in Settings first."); return; }
    setFpRunning(true); setFpError("");
    try {
      const [logs, plans, edits] = await Promise.all([
        sb.fetchOutfitLogs().catch(() => []),
        fetchAllPlans().catch(() => []),
        sb.fetchLookEdits().catch(() => []),
      ]);
      const fp = await generateStyleFingerprint({ items, logs, plans, edits, apiKey });
      await sb.saveStyleFingerprint(fp);
      setStyleFingerprint?.(fp);
    } catch (e) {
      setFpError(e.message || "Couldn't generate fingerprint.");
    } finally { setFpRunning(false); }
  };

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={s.pageTitle}>Style Profile</h2>
      </div>
      <p style={{ fontSize: 12, color: "var(--color-text-2)", margin: "0 0 16px", lineHeight: 1.5 }}>
        Your stylist's file on you. Everything here quietly shapes every look Style Me builds.
      </p>

      {/* ── Your stylist's read (fingerprint) ── */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>✦ Your Stylist's Read</div>
        <p style={s.settingsSub}>
          Patterns observed across every outfit you've worn or planned — read by Style Me as a soft bias, never a hard rule.
        </p>
        {styleFingerprint?.text ? (
          <div style={{
            background: "var(--color-bg)", border: "1px solid var(--color-border)",
            borderRadius: 6, padding: 12, fontSize: 12, color: "var(--color-text)",
            lineHeight: 1.55, whiteSpace: "pre-wrap", marginBottom: 10,
          }}>
            {styleFingerprint.text}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
            No read yet — log a few outfits, then generate one.
          </div>
        )}
        {styleFingerprint?.generated_at && (
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>
            Last read {new Date(styleFingerprint.generated_at).toLocaleDateString()}
            {styleFingerprint.source_count ? ` · based on ${styleFingerprint.source_count} outfit${styleFingerprint.source_count === 1 ? "" : "s"}` : ""}
            {newSinceRead > 0 && (
              <span style={{ color: PALETTE?.accent || "var(--color-text)" }}>
                {` · ${newSinceRead} new look${newSinceRead === 1 ? "" : "s"} since`}
              </span>
            )}
          </div>
        )}
        <button style={{ ...s.btnPrimary, width: "100%" }}
          onClick={handleRefreshFingerprint}
          disabled={fpRunning || !apiKey}>
          {fpRunning
            ? "Reading your history…"
            : !apiKey
              ? "Add Anthropic key in Settings first"
              : styleFingerprint
                ? "Refresh the Read"
                : "Generate the Read"}
        </button>
        {fpError && (
          <div style={{ fontSize: 11, color: "var(--color-danger)", marginTop: 6 }}>{fpError}</div>
        )}
      </div>

      {/* ── Color pairings ── */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>✦ Color Pairings</div>
        <p style={s.settingsSub}>Hand-picked color-blocking pairs the stylist puts to work in your looks.</p>
        {prefs.colorPairs.map((pair, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ flex: 1, fontSize: 12, color: "var(--color-text)" }}>{pair}</span>
            <button onClick={() => removePair(i)} style={{ background: "none", border: "none", color: "var(--color-border-muted)", cursor: "pointer", fontSize: 13 }}>✕</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input style={{ ...s.input, flex: 1, fontSize: 12 }} placeholder="e.g. Navy + Cool Red"
            value={newPair} onChange={e => setNewPair(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addPair()}/>
          <button style={s.btnPrimary} onClick={() => addPair()}>Add</button>
        </div>
        {suggestions.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={s.fieldLabel}>From looks you've loved</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {suggestions.map(pair => (
                <button key={pair} onClick={() => addPair(pair)}
                  style={{ ...s.btnSecondary, fontSize: 11, padding: "5px 10px" }}>
                  ＋ {pair}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ ...s.fieldLabel, marginTop: 14 }}>Style modes</div>
        {[["monochromaticMode", "Monochromatic looks"], ["tonalPairing", "Tonal pairing (e.g. navy + powder blue)"]].map(([key, label]) => (
          <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--color-text)", cursor: "pointer", marginBottom: 8 }}>
            <input type="checkbox" checked={prefs[key]}
              onChange={e => updatePrefs({ ...prefs, [key]: e.target.checked })}/>
            {label}
          </label>
        ))}
      </div>

      {/* ── About Me ── */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>✦ About Me</div>
        <p style={s.settingsSub}>
          Body descriptors + life context, translated into dress-to-flatter guidance in every generation. Optional — add what's relevant. Stored on this device.
        </p>
        {[
          ["height", "Height", "e.g. 5'7\""],
          ["torsoLength", "Torso length", "e.g. Long torso, short legs"],
          ["fitNotes", "Fit notes", "e.g. Prefer relaxed shoulders, avoid cropped"],
          ["proportions", "Proportions", "e.g. Narrow shoulders, fuller hips"],
          ["ageRange", "Age range", "e.g. Late 30s"],
          ["professionalContext", "Professional context", "e.g. Creative director, client-facing, WFH 3 days/week"],
        ].map(([key, label, placeholder]) => (
          <div key={key}>
            <div style={s.fieldLabel}>{label}</div>
            <input style={{ ...s.input, width: "100%", marginBottom: 10 }} placeholder={placeholder}
              value={aboutMe[key] || ""} onChange={e => updateAboutMe({ ...aboutMe, [key]: e.target.value })}/>
          </div>
        ))}
      </div>
    </div>
  );
}
