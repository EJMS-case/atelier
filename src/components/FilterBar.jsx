import { useMemo, useState } from "react";
import { s } from "../ui/styles.js";
import { CATEGORY_ORDER, TAXONOMY, getL3Options, getSubcatL2 } from "../constants/taxonomy.js";
import { COLOR_FAMILIES } from "../constants/color.js";

export default function FilterBar({ items, activeFilters, onChange }) {
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

  // Unique brands from wardrobe — memoized: brandSearch is local state, so
  // every keystroke re-renders this component and used to re-scan + re-sort
  // the whole closet.
  const brands = useMemo(
    () => [...new Set(items.map(it => it.brand).filter(Boolean))].sort(),
    [items],
  );
  const filteredBrands = brands.filter(b => b.toLowerCase().includes(brandSearch.toLowerCase()));

  // Subcategories: TWO-LEVEL (owner request 2026-08-13 — "sub categories
  // should expand when I select it, not prematurely"). Row 1 shows only the
  // L2 parents that have items — counting rows stored under L3 child labels,
  // since legacy dual-labeling means e.g. every hosiery row is
  // Sheer/Semi-Opaque/Opaque and every skirt is Mini/Midi/Maxi. Row 2 (the
  // children) appears only once a parent with owned children is selected.
  // Selecting a parent shows EVERYTHING under it — the filter predicate in
  // App.jsx is subcatMatches (getSubcatL2-aware), not literal equality.
  const selectedCats = activeFilters.category?.filter(c => c !== "Sets") || [];
  const singleCat = selectedCats.length === 1 ? selectedCats[0] : null;
  const selectedSub = (activeFilters.subcategory || [])[0] || "";
  // The selected value's L2 parent — equals the value itself when it IS an L2.
  const selectedL2 = singleCat && selectedSub
    ? (getSubcatL2(singleCat, selectedSub) || selectedSub)
    : "";
  const subcatOptions = (() => {
    if (!singleCat) return [];   // only show for single-category selection
    return (TAXONOMY[singleCat] || []).filter(sub =>
      items.some(it => it.category === singleCat &&
        (it.subcategory === sub || getL3Options(singleCat, sub).includes(it.subcategory)))
    );   // preserve TAXONOMY order instead of sorting alphabetically
  })();
  const childOptions = (() => {
    if (!singleCat || !selectedL2) return [];
    // getL3Options is category-aware: Athleisure "Skirts" has no Mini/Midi/
    // Maxi children — that axis belongs to Bottoms alone.
    return getL3Options(singleCat, selectedL2).filter(l3 =>
      items.some(it => it.category === singleCat && it.subcategory === l3)
    );
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

      {/* Subcategory chips — single-select L2 parents; a parent's L3 children
          expand on their own row below only while that parent is selected.
          Tapping a selected parent clears; tapping a selected child collapses
          back to the parent (everything under it stays showing). */}
      {subcatOptions.length > 0 && (
        <div style={s.filterSection}>
          <div style={s.filterRow}>
            {subcatOptions.map(sub => (
              <button key={sub}
                onClick={() => {
                  const next = sub === selectedL2 ? [] : [sub];
                  onChange({ ...activeFilters, subcategory: next });
                }}
                style={{...s.chip, ...(sub === selectedL2 ? s.chipActive : {})}}>
                {sub}
              </button>
            ))}
          </div>
        </div>
      )}
      {childOptions.length > 0 && (
        <div style={s.filterSection}>
          <div style={s.filterRow}>
            {childOptions.map(l3 => (
              <button key={l3}
                onClick={() => {
                  const next = l3 === selectedSub ? [selectedL2] : [l3];
                  onChange({ ...activeFilters, subcategory: next });
                }}
                style={{...s.chip, fontSize: 10, ...(l3 === selectedSub ? s.chipActive : {})}}>
                {l3}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sleeve length filter — only when Tops is selected. (Dropped for
          Dresses: it keyed off a sleeve_length field most dresses never had,
          so it filtered to nothing.) */}
      {(() => {
        const cat = selectedCats.length === 1 ? selectedCats[0] : null;
        if (cat !== "Tops") return null;
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
            <button
              key={family.name}
              onClick={() => toggle("color", family.name)}
              style={{
                ...s.swatchBtn,
                background: family.hex,
                boxShadow: isActive("color", family.name)
                  ? `0 0 0 2px var(--color-ink), 0 0 0 4px ${family.hex}`
                  : "none",
                border: ["White", "Neutrals", "Yellow"].includes(family.name) ? "1px solid var(--color-border)" : "none",
              }}
              title={family.name}
            />
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
