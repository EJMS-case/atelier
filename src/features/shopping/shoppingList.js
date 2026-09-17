// ── HER SHOPPING LIST ───────────────────────────────────────────────────────
// The list she writes and checks off herself. Owner, 2026-09-17: "I don't
// think the gap analysis is particularly useful. Think it might be better to
// keep it as an area I write and check off etc myself."
//
// What makes a hand-written list useful in THIS app is that everything reads
// it and one thing writes back to it:
//   · every AI surface reads it through personalGrounding() (a look that
//     would be finished by a piece on her list says so; Style Me never
//     places one; Complete-a-Look shops for it first);
//   · a closet add that answers an open entry checks it off, with the piece
//     named as the evidence (answerList — category + colour family + form,
//     the same read verifyGaps makes when it drops an owned piece);
//   · the numbers panel and the AI's ideas ADD to it, never replace it.
// Stored cross-device in user_settings (key shopping_list), local mirror for
// the first paint — the store is shoppingListStore.js (Home's row reads it at
// mount, so it rides the boot chunk; this module does not). Pure composition
// exported for scripts/shopping.test.mjs.

import { familyForColorString, effectiveColorFamily } from "../../constants/color.js";
import { canonicalCategory, suggestionFamily, namedForms, norm } from "./verifyGaps.js";
import { cleanList, loadShoppingList, saveShoppingList, newId } from "./shoppingListStore.js";

export { SHOPPING_LIST_KEY, SOURCES, cleanList, loadShoppingList, saveShoppingList } from "./shoppingListStore.js";
export const RECENT_BUY_DAYS = 45;

/** Pure: append an entry unless an OPEN one already says the same thing. */
export function addEntry(list, { text, category = "", color = "", note = "", url = "", source = "me" } = {}, { now = new Date() } = {}) {
  const base = cleanList(list);
  const key = norm(text);
  if (!key) return base;
  if (base.some(e => e.status === "open" && norm(e.text) === key)) return base;
  return cleanList([...base, {
    id: newId(), text, category, color, note, url, source,
    status: "open", addedAt: now.toISOString(),
  }]);
}

/** Pure: check an entry off (or back on). `bought` names the piece that answered it. */
export function setDone(list, id, done, { bought = null, now = new Date() } = {}) {
  return cleanList(list).map(e => e.id !== id ? e : {
    ...e,
    status: done ? "done" : "open",
    doneAt: done ? now.toISOString() : "",
    boughtId: done && bought ? String(bought.id || "") : "",
    boughtName: done && bought ? [bought.brand, bought.name].filter(Boolean).join(" ") : "",
  });
}

export function removeEntry(list, id) {
  return cleanList(list).filter(e => e.id !== id);
}

/** An AI suggestion (gap or completion) as a list entry she can keep. */
export function entryFromGap(gap, source = "atelier") {
  return {
    text: String(gap?.suggestion || "").trim(),
    category: canonicalCategory(gap?.category) || String(gap?.category || ""),
    color: suggestionFamily(gap),
    note: String(gap?.reason || gap?.why || "").trim(),
    url: "",
    source,
  };
}

/**
 * Does this piece answer this entry? Category (her chip, or the one the text
 * names) must match; then the colour family when the entry names one, and
 * the form ("tote", "loafer") when it names one. An entry that names neither
 * a colour nor a form is too loose to check off by itself ("a new bag" would
 * be answered by any bag) — she ticks those herself.
 */
export function entryAnswers(entry, item) {
  if (!entry || !item || entry.status === "done") return false;
  const cat = entry.category || canonicalCategory(entry.text);
  if (!cat || item.category !== cat) return false;
  const fam = (entry.color && familyForColorString(entry.color)) || suggestionFamily({ suggestion: entry.text });
  const forms = namedForms(entry.text);
  if (!fam && !forms.length) return false;
  if (fam && effectiveColorFamily(item) !== fam) return false;
  if (forms.length) {
    const itSub = norm(item.subcategory);
    const itName = norm(item.name);
    if (!forms.some(f => itSub.includes(f) || itName.includes(f))) return false;
  }
  return true;
}

/**
 * Pure: check off every open entry one of these pieces answers.
 * @returns {{ list: Object[], answered: {entry:Object, item:Object}[] }}
 */
export function answerList(list, items, { now = new Date() } = {}) {
  let next = cleanList(list);
  const answered = [];
  for (const entry of next) {
    if (entry.status !== "open") continue;
    const hit = (items || []).find(it => entryAnswers(entry, it));
    if (!hit) continue;
    next = setDone(next, entry.id, true, { bought: hit, now });
    answered.push({ entry, item: hit });
  }
  return { list: next, answered };
}

/** Closet adds call this: the list learns what she bought, every surface reads it next tap. */
export async function answerShoppingList(newItems) {
  const list = await loadShoppingList();
  if (!list.some(e => e.status === "open")) return [];
  const { list: next, answered } = answerList(list, newItems);
  if (answered.length) await saveShoppingList(next).catch(() => {});
  return answered;
}

const recentBuys = (list, now) => {
  const since = now.getTime() - RECENT_BUY_DAYS * 86400000;
  return list.filter(e => e.status === "done" && e.doneAt && new Date(e.doneAt).getTime() >= since);
};

/**
 * The list as one prompt block: what she is looking for, and what she just
 * bought (a piece on the list that a closet add answered is a piece she
 * wants to see styled). Pure; "" when there is nothing to say.
 */
export function describeShoppingList(list, { max = 8, now = new Date() } = {}) {
  const c = cleanList(list);
  const open = c.filter(e => e.status === "open").slice(-max);
  const bought = recentBuys(c, now).slice(-4);
  const parts = [];
  if (open.length) {
    parts.push(`Pieces she is looking for (her own list): ${open.map(e => `${e.text}${e.category ? ` [${e.category}]` : ""}`).join("; ")}. When a look would be finished by one of them, say so — it is a real option on her horizon, not a piece she owns. Never propose one of these as if it were new.`);
  }
  if (bought.length) {
    parts.push(`Just bought, from that list: ${bought.map(e => `${e.boughtName || "a piece"} (for "${e.text}")`).join("; ")} — new to the closet and worth a look that uses it.`);
  }
  return parts.join("\n");
}
