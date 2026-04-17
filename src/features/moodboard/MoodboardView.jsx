// ── F5 — MOODBOARD VIEW ──────────────────────────────────────────────────────
// List of saved boards + editor for the active board.

import { useEffect, useState } from "react";
import BoardCanvas from "./BoardCanvas.jsx";
import {
  listMoodboards, fetchMoodboard, upsertMoodboard, deleteMoodboard, uploadInspoImage,
} from "./moodboardApi.js";

const PALETTE = {
  ink:   "#1C1814",
  soft:  "#4A3E36",
  muted: "#9A8E84",
  bg:    "#F5F1EC",
  cream: "#FDF8F0",
  line:  "#D6CDC1",
};

export default function MoodboardView({ items }) {
  const [mode, setMode] = useState("list"); // "list" | "edit"
  const [boards, setBoards] = useState([]);
  const [active, setActive] = useState(null);

  useEffect(() => {
    listMoodboards().then(setBoards).catch(() => setBoards([]));
  }, []);

  async function openNew() {
    const blank = {
      name: "",
      layers: [],
    };
    const saved = await upsertMoodboard(blank).catch(() => null);
    const row = saved?.[0] || saved;
    if (row?.id) {
      setActive({ ...blank, id: row.id });
      setMode("edit");
    }
  }

  async function open(id) {
    const row = await fetchMoodboard(id);
    if (row) {
      setActive({ ...row, layers: row.layers || [] });
      setMode("edit");
    }
  }

  if (mode === "edit" && active) {
    return (
      <BoardEditor
        board={active}
        items={items}
        onBack={async () => {
          await listMoodboards().then(setBoards).catch(() => {});
          setActive(null); setMode("list");
        }}
        onChange={(patch) => setActive(a => ({ ...a, ...patch }))}
      />
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <button onClick={openNew}
        style={{ width: "100%", padding: 14, background: PALETTE.ink, color: PALETTE.bg, border: "none", borderRadius: 8, fontSize: 12, letterSpacing: "0.1em", cursor: "pointer", marginBottom: 16 }}>
        ✦ New moodboard
      </button>

      {boards.length === 0 && (
        <div style={{ textAlign: "center", color: PALETTE.muted, padding: 40, fontSize: 13 }}>
          No moodboards yet. Start one to build a visual reference for a vibe, a trip, or a season.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
        {boards.map(b => (
          <button key={b.id} onClick={() => open(b.id)}
            style={{ aspectRatio: "4/5", border: `1px solid ${PALETTE.line}`, borderRadius: 8, background: "#fff", padding: 0, overflow: "hidden", cursor: "pointer", position: "relative" }}>
            {b.cover_url
              ? <img src={b.cover_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
              : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: PALETTE.muted, fontSize: 11 }}>{(b.layers?.length || 0)} layers</div>}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(28,24,20,0.65)", color: PALETTE.bg, padding: 6, fontSize: 11, letterSpacing: "0.05em" }}>
              {b.name || "Untitled"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function BoardEditor({ board, items, onBack }) {
  const [name, setName] = useState(board.name || "");
  const [layers, setLayers] = useState(board.layers || []);
  const [selected, setSelected] = useState(null);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  function addItemLayer(item) {
    const id = `L-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const maxZ = Math.max(0, ...layers.map(l => l.z || 0));
    setLayers(ls => [...ls, {
      id, kind: "item", ref_id: item.id, image: item.image || "",
      x: 40, y: 40, w: 180, h: 180, rotation: 0, z: maxZ + 1,
    }]);
    setSelected(id);
  }

  async function addInspoFromFile(file) {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const raw = ev.target.result;
      const url = await uploadInspoImage(board.id, raw).catch(() => raw);
      const id = `L-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const maxZ = Math.max(0, ...layers.map(l => l.z || 0));
      setLayers(ls => [...ls, {
        id, kind: "inspo", image: url,
        x: 60, y: 60, w: 220, h: 220, rotation: 0, z: maxZ + 1,
      }]);
      setSelected(id);
    };
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await upsertMoodboard({
        id: board.id,
        name,
        layers,
      });
      onBack();
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm("Delete this moodboard?")) return;
    await deleteMoodboard(board.id);
    onBack();
  }

  function removeSelected() {
    if (!selected) return;
    setLayers(ls => ls.filter(l => l.id !== selected));
    setSelected(null);
  }

  return (
    <div style={{ padding: "16px 16px 120px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: PALETTE.soft, fontSize: 13, cursor: "pointer" }}>← Back</button>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="Board name"
          style={{ flex: 1, margin: "0 10px", padding: 8, border: "none", borderBottom: `1px solid ${PALETTE.line}`, background: "transparent", fontSize: 14, color: PALETTE.ink, textAlign: "center" }}/>
        <button onClick={handleDelete} style={{ background: "none", border: "none", color: PALETTE.muted, fontSize: 11, cursor: "pointer" }}>Delete</button>
      </div>

      <BoardCanvas layers={layers} onChange={setLayers} selected={selected} onSelect={setSelected}/>

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button onClick={() => setPicker(true)} style={buttonSecondary}>+ Add from closet</button>
        <label style={{ ...buttonSecondary, display: "inline-flex", alignItems: "center", gap: 6 }}>
          + Paste inspo
          <input type="file" accept="image/*" style={{ display: "none" }}
            onChange={e => e.target.files[0] && addInspoFromFile(e.target.files[0])}/>
        </label>
        {selected && (
          <button onClick={removeSelected} style={{ ...buttonSecondary, color: "#C0392B", borderColor: "#C0392B" }}>Remove layer</button>
        )}
        <button onClick={handleSave} disabled={saving}
          style={{ ...buttonPrimary, marginLeft: "auto" }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {picker && <ClosetPicker items={items} onPick={(it) => { addItemLayer(it); setPicker(false); }} onClose={() => setPicker(false)}/>}
    </div>
  );
}

function ClosetPicker({ items, onPick, onClose }) {
  const [q, setQ] = useState("");
  const filtered = items.filter(it => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (it.name || "").toLowerCase().includes(s)
      || (it.color || "").toLowerCase().includes(s)
      || (it.category || "").toLowerCase().includes(s)
      || (it.subcategory || "").toLowerCase().includes(s);
  });
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: PALETTE.bg, width: "100%", maxWidth: 520, maxHeight: "80vh", overflowY: "auto", borderRadius: "14px 14px 0 0", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: PALETTE.ink, fontFamily: "serif" }}>Pick a piece</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PALETTE.muted, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search"
          style={{ width: "100%", padding: 8, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 13, marginBottom: 10, background: "#fff" }}/>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {filtered.slice(0, 80).map(it => (
            <button key={it.id} onClick={() => onPick(it)}
              style={{ aspectRatio: "1", background: PALETTE.cream, borderRadius: 4, overflow: "hidden", border: `1px solid ${PALETTE.line}`, padding: 0, cursor: "pointer" }}>
              {it.image && <img src={it.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const buttonSecondary = {
  padding: "8px 12px",
  background: "transparent",
  border: `1px solid ${PALETTE.line}`,
  borderRadius: 6,
  color: PALETTE.soft,
  fontSize: 11,
  cursor: "pointer",
};

const buttonPrimary = {
  padding: "8px 16px",
  background: PALETTE.ink,
  color: PALETTE.bg,
  border: "none",
  borderRadius: 6,
  fontSize: 11,
  letterSpacing: "0.1em",
  cursor: "pointer",
};
