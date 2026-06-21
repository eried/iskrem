// frost-store.js — pure logic for FROST feedback + pantry.
// Loads in the browser (as an ES module) and in Node (for tests). No dependencies.

export const DOC_VERSION = 1;

export function emptyDoc() {
  return { version: DOC_VERSION, updated: 0, recipes: {}, pantry: { updated: 0, items: {} } };
}

export function normalizeDoc(doc) {
  const d = (doc && typeof doc === 'object') ? doc : {};
  const p = (d.pantry && typeof d.pantry === 'object') ? d.pantry : {};
  return {
    version: DOC_VERSION,
    updated: Number(d.updated) || 0,
    recipes: (d.recipes && typeof d.recipes === 'object') ? d.recipes : {},
    pantry: {
      updated: Number(p.updated) || 0,
      items: (p.items && typeof p.items === 'object') ? p.items : {}
    }
  };
}

export function merge(localDoc, remoteDoc) {
  const a = normalizeDoc(localDoc), b = normalizeDoc(remoteDoc);
  const recipes = {};
  const keys = new Set([...Object.keys(a.recipes), ...Object.keys(b.recipes)]);
  for (const k of keys) {
    const ra = a.recipes[k], rb = b.recipes[k];
    if (!ra) recipes[k] = rb;
    else if (!rb) recipes[k] = ra;
    else recipes[k] = ((rb.updated || 0) > (ra.updated || 0)) ? rb : ra;
  }
  const pantry = (b.pantry.updated > a.pantry.updated) ? b.pantry : a.pantry;
  return { version: DOC_VERSION, updated: Math.max(a.updated, b.updated), recipes, pantry };
}
