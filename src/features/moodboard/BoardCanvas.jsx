// ── F5 — MOODBOARD CANVAS ────────────────────────────────────────────────────
// Self-contained drag/resize/rotate on a mobile-friendly absolute-positioned
// canvas. No external deps — pointer events + touchaction: none.
// Each layer is { id, kind: "item"|"inspo", ref_id?, image, x, y, w, h, rotation, z }.

import { useEffect, useRef, useState } from "react";

const PALETTE = {
  ink:   "#1C1814",
  soft:  "#4A3E36",
  muted: "#9A8E84",
  bg:    "#F5F1EC",
  cream: "#FDF8F0",
  line:  "#D6CDC1",
};

export default function BoardCanvas({ layers, onChange, selected, onSelect }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Observe the canvas element's size so layers can snap into it.
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      const box = entries[0].contentRect;
      setSize({ w: box.width, h: box.height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  function updateLayer(id, patch) {
    onChange(layers.map(l => l.id === id ? { ...l, ...patch } : l));
  }

  function startDrag(e, layer) {
    e.preventDefault();
    e.stopPropagation();
    onSelect(layer.id);
    const startX = e.clientX;
    const startY = e.clientY;
    const { x, y } = layer;

    function onMove(ev) {
      updateLayer(layer.id, {
        x: x + (ev.clientX - startX),
        y: y + (ev.clientY - startY),
      });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startResize(e, layer, corner) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const { w, h } = layer;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const nw = Math.max(40, w + (corner.includes("e") ? dx : -dx));
      const nh = Math.max(40, h + (corner.includes("s") ? dy : -dy));
      updateLayer(layer.id, { w: nw, h: nh });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startRotate(e, layer) {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startRotation = layer.rotation || 0;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);

    function onMove(ev) {
      const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      const deg = ((angle - startAngle) * 180) / Math.PI;
      updateLayer(layer.id, { rotation: startRotation + deg });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div ref={ref}
      onClick={() => onSelect(null)}
      style={{ position: "relative", width: "100%", aspectRatio: "4/5", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 10, overflow: "hidden", touchAction: "none" }}>
      {layers.map(layer => (
        <LayerBox key={layer.id} layer={layer} selected={selected === layer.id}
          onDragStart={(e) => startDrag(e, layer)}
          onResizeStart={(e, c) => startResize(e, layer, c)}
          onRotateStart={(e) => startRotate(e, layer)}/>
      ))}
    </div>
  );
}

function LayerBox({ layer, selected, onDragStart, onResizeStart, onRotateStart }) {
  const style = {
    position: "absolute",
    left: layer.x,
    top: layer.y,
    width: layer.w,
    height: layer.h,
    transform: `rotate(${layer.rotation || 0}deg)`,
    zIndex: layer.z || 0,
    cursor: "grab",
    border: selected ? "2px dashed " + PALETTE.ink : "none",
    background: "transparent",
  };
  return (
    <div style={style} onPointerDown={onDragStart}>
      {layer.image && (
        <img src={layer.image} alt="" draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}/>
      )}
      {selected && (
        <>
          <Handle pos={{ right: -8, bottom: -8 }} cursor="nwse-resize" onPointerDown={(e) => onResizeStart(e, "se")}/>
          <Handle pos={{ left: -8, bottom: -8 }} cursor="nesw-resize" onPointerDown={(e) => onResizeStart(e, "sw")}/>
          <Handle pos={{ right: -8, top: -8 }}   cursor="nesw-resize" onPointerDown={(e) => onResizeStart(e, "ne")}/>
          <Handle pos={{ left: -8, top: -8 }}    cursor="nwse-resize" onPointerDown={(e) => onResizeStart(e, "nw")}/>
          <button
            onPointerDown={onRotateStart}
            style={{ position: "absolute", top: -28, left: "50%", transform: "translateX(-50%)", width: 22, height: 22, borderRadius: 11, border: `1px solid ${PALETTE.ink}`, background: PALETTE.bg, cursor: "grab", fontSize: 11, lineHeight: 1 }}
            aria-label="rotate">↻</button>
        </>
      )}
    </div>
  );
}

function Handle({ pos, cursor, onPointerDown }) {
  return (
    <div onPointerDown={onPointerDown}
      style={{ position: "absolute", width: 14, height: 14, borderRadius: 7, background: PALETTE.bg, border: `1.5px solid ${PALETTE.ink}`, cursor, ...pos }}/>
  );
}
