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

/* ---- feedback ---- */
export function getFeedback(doc, no) {
  const d = normalizeDoc(doc);
  const fb = d.recipes[String(no)];
  return fb ? { made: !!fb.made, stars: fb.stars|0, note: fb.note || '' }
            : { made: false, stars: 0, note: '' };
}

export function setFeedback(doc, no, patch, now) {
  const d = normalizeDoc(doc);
  const key = String(no);
  const cur = d.recipes[key] || { made:false, stars:0, note:'' };
  const next = {
    made:  ('made'  in patch) ? !!patch.made                            : !!cur.made,
    stars: ('stars' in patch) ? Math.max(0, Math.min(5, patch.stars|0)) : (cur.stars|0),
    note:  ('note'  in patch) ? String(patch.note)                      : (cur.note || ''),
    updated: now
  };
  return { ...d, updated: now, recipes: { ...d.recipes, [key]: next } };
}

/* ---- pantry ---- */
export const PANTRY_STATES = ['none', 'ordered', 'stock'];

export function nextPantryState(cur) {
  const i = PANTRY_STATES.indexOf(cur);
  return PANTRY_STATES[(i + 1) % PANTRY_STATES.length];
}

export function getPantryState(doc, key) {
  return normalizeDoc(doc).pantry.items[key] || 'none';
}

export function setPantryState(doc, key, state, now) {
  const d = normalizeDoc(doc);
  const items = { ...d.pantry.items };
  if (state === 'none') delete items[key]; else items[key] = state;
  return { ...d, updated: now, pantry: { updated: now, items } };
}

export function setPantryMany(doc, keys, state, now) {
  const d = normalizeDoc(doc);
  const items = { ...d.pantry.items };
  for (const k of keys) { if (state === 'none') delete items[k]; else items[k] = state; }
  return { ...d, updated: now, pantry: { updated: now, items } };
}

export function recipeRequiredKeys(recipe, basics) {
  return recipe.ing.filter(x => !x[2] && !basics[x[0]]).map(x => x[0]);
}

export function canMake(recipe, pantryItems, basics) {
  return recipeRequiredKeys(recipe, basics).every(k => pantryItems[k] === 'stock');
}

/* ---- sort + feedback filter ---- */
function starsOf(doc, no) { return (normalizeDoc(doc).recipes[String(no)] || {}).stars || 0; }
function madeOf(doc, no)  { return (normalizeDoc(doc).recipes[String(no)] || {}).made ? 1 : 0; }

export function sortRecipes(list, mode, doc) {
  const arr = list.slice();
  const byNo = (a, b) => a.no - b.no;
  switch (mode) {
    case 'rating':  arr.sort((a,b) => (starsOf(doc,b.no)-starsOf(doc,a.no)) || byNo(a,b)); break;
    case 'made':    arr.sort((a,b) => (madeOf(doc,b.no)-madeOf(doc,a.no))   || byNo(a,b)); break;
    case 'protein': arr.sort((a,b) => (b.protein-a.protein)                 || byNo(a,b)); break;
    case 'kcal':    arr.sort((a,b) => (a.kcal-b.kcal)                       || byNo(a,b)); break;
    default:        arr.sort(byNo);
  }
  return arr;
}

export function feedbackMatch(recipe, fbFilters, doc) {
  if (!fbFilters || fbFilters.size === 0) return true;
  const fb = normalizeDoc(doc).recipes[String(recipe.no)] || null;
  const rated = !!(fb && (fb.made || (fb.stars|0) > 0 || (fb.note && fb.note.trim())));
  for (const f of fbFilters) {
    if (f === 'made'    && !(fb && fb.made)) return false;
    if (f === 'fav'     && !(fb && (fb.stars|0) >= 4)) return false;
    if (f === 'unrated' && rated) return false;
  }
  return true;
}

/* ---- PKCE + Dropbox auth helpers (use Web Crypto, available in browsers and Node 22) ---- */
export function base64UrlFromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomVerifier(len = 64) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return base64UrlFromBytes(bytes);
}

export async function pkceChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlFromBytes(new Uint8Array(digest));
}

export function buildAuthUrl({ appKey, redirectUri, challenge, scope }) {
  const p = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    token_access_type: 'offline',
    scope
  });
  return 'https://www.dropbox.com/oauth2/authorize?' + p.toString();
}

export function tokenExchangeBody({ code, verifier, appKey, redirectUri }) {
  return new URLSearchParams({
    code, grant_type: 'authorization_code',
    code_verifier: verifier, client_id: appKey, redirect_uri: redirectUri
  });
}

export function tokenRefreshBody({ refreshToken, appKey }) {
  return new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: appKey
  });
}
