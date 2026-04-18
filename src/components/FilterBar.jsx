import { useState } from "react";
import { s } from "../ui/styles.js";
import { CATEGORY_ORDER, TAXONOMY, SUBCATEGORY_L3 } from "../constants/taxonomy.js";
import { COLOR_FAMILIES } from "../constants/color.js";

export default function FilterBar({ items, activeFilters, onChange }) {
  const [expandedColor, setExpandedColor] = useState(null);
  const [showBrand, setShowBrand] = useState(false);
  const [brandSearch, setBrandSearch] = useState("");
  const [showMore, setShowMore] = useState(false);

  const toggle = (type, value) => {
    if (type === "category") {
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

  const brands = [...new Set(items.map(it => it.brand).filter(Boolean))].sort();
  const filteredBrands = brands.filter(b => b.toLowerCase().includes(brandSearch.toLowerCase()));

  const selectedCats = activeFilters.category?.filter(c => c !== "Sets") || [];
  const subcatOptions = (() => {
    if (selectedCats.length !== 1) return [];
    const cat = selectedCats[0];
    const subs = [];
    (TAXONOMY[cat] || []).forEach(sub => {
      if (items.some(it => it.category === cat && it.subcategory === sub)) subs.push(sub);
      (SUBCATEGORY_L3[sub] || []).forEach(l3 => {
        if (items.some(it => it.category === cat && it.subcategory === l3)) subs.push(l3);
      });
    });
    return subs;
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
                    ? `0 0 0 2px #1C1814, 0 0 0 4px ${family.hex}`
                    : expandedColor === family.name
                    ? `0 0 0 2px #C4A882`
                    : "none",
                  border: family.name === "White" || family.name === "Neutral" ? "1px solid #E8E0D8" : "none",
                }}
                title={family.name}
              />
              {expandedColor === family.name && family.shades.length > 1 && (
                <div style={s.shadePopover}>
                  {family.shades.map(shade => (
                    <button key={shade.name}
                      onClick={() => { toggle("color", shade.name); setExpandedColor(null); }}
                      style={{
                        ...s.shadeSwatch,
                        background: shade.hex,
                        boxShadow: isActive("color", shade.name) ? `0 0 0 2px #1C1814` : "none",
                        border: shade.name === "White" || shade.name === "Ivory" || shade.name === "Neutral" ? "1px solid #E8E0D8" : "none",
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
                <span style={{fontSize:11, color:"#9A8E84"}}>No brands found</span>
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
