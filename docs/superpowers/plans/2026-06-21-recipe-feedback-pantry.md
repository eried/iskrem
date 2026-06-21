# Recipe Feedback + Synced Pantry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-recipe feedback (made / 0–5 stars / note) and a tri-state synced pantry (ordered / in stock) to the FROST single-page app, stored local-first and synced to each user's own Dropbox via serverless PKCE OAuth.

**Architecture:** Pure data logic (merge, pantry rules, sort/filter predicates, PKCE) is extracted into a new dependency-free ES module `frost-store.js`, unit-tested with Node's built-in test runner. `index.html` becomes a `<script type="module">` that imports that logic and owns all browser-only concerns: localStorage persistence, Dropbox `fetch` calls, the sync controller, and UI. The app is fully usable local-only; Dropbox is an additive sync layer.

**Tech Stack:** Vanilla JS (no framework, no bundler), HTML, CSS. Node 22 `node --test` + `node:assert` for unit tests (no npm dependencies). Dropbox HTTP API v2 with OAuth 2 Authorization-Code + PKCE.

## Global Constraints

- Deployment is a **static site on GitHub Pages**, served at `https://ried.cl/iskrem/`. **No build step** — files are served as-is.
- Stay **vanilla JS**, no added runtime dependencies. Tests use only Node built-ins.
- `index.html` and `frost-store.js` are the only shipped app files; both must load over `file`-less `http(s)` (ES modules require an origin — never test via `file://`, always via an http server).
- Dropbox config (exact values):
  - `DROPBOX_APP_KEY = "2zmn7d9rz2cdeqr"` (public; PKCE uses **no** secret — the App secret must never appear in any file).
  - `DROPBOX_FILE_PATH = "/frost-feedback.json"` (relative to the App-folder root).
  - `DROPBOX_REDIRECT_URI` = `"http://localhost:8000/"` on `localhost`, else `"https://ried.cl/iskrem/"` (must match a registered redirect URI character-for-character).
  - OAuth scope string: `"files.content.read files.content.write account_info.read"`.
  - Authorize endpoint `https://www.dropbox.com/oauth2/authorize`; token endpoint `https://api.dropboxapi.com/oauth2/token`; content endpoints `https://content.dropboxapi.com/2/files/{download,upload}`.
- Data model is **local-first**: every change writes to `localStorage` synchronously; Dropbox sync is debounced and best-effort and must never block or lose local edits.
- Stars are integers clamped to **0–5**. Pantry states are exactly `"ordered"`, `"stock"`, or absent (none). "Can make" counts only `"stock"`; `"ordered"` does not count as available.
- localStorage keys: document = `"frost.feedback.v1"`, Dropbox tokens = `"frost.dbx.tok.v1"`, PKCE verifier (sessionStorage) = `"frost.pkce"`.

## File Structure

- **Create `frost-store.js`** — pure ES-module logic: document model + `merge`, feedback get/set, pantry get/set + `canMake`, `sortRecipes`, `feedbackMatch`, and PKCE/auth URL helpers. Importable by both the browser and Node.
- **Create `package.json`** — minimal, `{"private":true,"type":"module","scripts":{"test":"node --test"}}`. Marks `.js` as ESM for Node and provides `npm test`.
- **Create `tests/merge.test.mjs`, `tests/pantry.test.mjs`, `tests/sortfilter.test.mjs`, `tests/pkce.test.mjs`** — unit tests.
- **Create `DROPBOX_SETUP.md`** — the one-time owner setup (console steps + which constant to set).
- **Modify `index.html`** — convert the inline `<script>` to `<script type="module">`, import `frost-store.js`, add config constants, localStorage wrappers, Dropbox `fetch` layer, sync controller, and all UI (feedback editor + card badge, My Pantry configurator, sort dropdown, feedback filter chips, connection bar). Rewire "Can make" to read the saved pantry.

---

## Task 1: Project scaffolding + document model + `merge` (pure, TDD)

**Files:**
- Create: `package.json`
- Create: `frost-store.js`
- Test: `tests/merge.test.mjs`

**Interfaces:**
- Produces: `emptyDoc() -> Doc`, `normalizeDoc(any) -> Doc`, `merge(localDoc, remoteDoc) -> Doc`, and `DOC_VERSION:number`.
  - `Doc = { version:number, updated:number, recipes: { [no:string]: {made:boolean,stars:number,note:string,updated:number} }, pantry: { updated:number, items: { [ingKey:string]: "ordered"|"stock" } } }`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write the failing test** — `tests/merge.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDoc, normalizeDoc, merge, DOC_VERSION } from '../frost-store.js';

test('emptyDoc has the full shape', () => {
  const d = emptyDoc();
  assert.equal(d.version, DOC_VERSION);
  assert.deepEqual(d.recipes, {});
  assert.deepEqual(d.pantry, { updated: 0, items: {} });
});

test('normalizeDoc fills missing parts and coerces types', () => {
  const d = normalizeDoc({ recipes: { '1': { stars: 3, updated: 5 } } });
  assert.deepEqual(d.pantry, { updated: 0, items: {} });
  assert.equal(d.recipes['1'].stars, 3);
});

test('merge keeps the newer recipe entry per recipe number', () => {
  const local = { updated: 10, recipes: { '1': { made:true, stars:5, note:'a', updated:10 } }, pantry:{updated:0,items:{}} };
  const remote = { updated: 20, recipes: { '1': { made:false, stars:2, note:'b', updated:20 } }, pantry:{updated:0,items:{}} };
  const m = merge(local, remote);
  assert.equal(m.recipes['1'].stars, 2);
  assert.equal(m.recipes['1'].note, 'b');
});

test('merge unions recipes present on only one side', () => {
  const local = { recipes: { '1': { stars:5, updated:10 } } };
  const remote = { recipes: { '2': { stars:3, updated:5 } } };
  const m = merge(local, remote);
  assert.equal(m.recipes['1'].stars, 5);
  assert.equal(m.recipes['2'].stars, 3);
});

test('merge takes the newer pantry as a whole object', () => {
  const local = { pantry: { updated: 30, items: { allulose: 'stock' } } };
  const remote = { pantry: { updated: 20, items: { oatly: 'ordered' } } };
  const m = merge(local, remote);
  assert.deepEqual(m.pantry.items, { allulose: 'stock' });
});

test('merge of two empties is an empty doc', () => {
  const m = merge(null, undefined);
  assert.deepEqual(m.recipes, {});
  assert.deepEqual(m.pantry.items, {});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/merge.test.mjs`
Expected: FAIL — cannot import from `../frost-store.js` (module/exports missing).

- [ ] **Step 4: Create `frost-store.js` with the model + merge**

```js
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/merge.test.mjs`
Expected: PASS — `# pass 6`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add package.json frost-store.js tests/merge.test.mjs
git commit -m "feat: add doc model + sync merge (pure, tested)"
```

---

## Task 2: Feedback get/set + pantry tri-state + canMake (pure, TDD)

**Files:**
- Modify: `frost-store.js`
- Test: `tests/pantry.test.mjs`

**Interfaces:**
- Produces:
  - `getFeedback(doc, no) -> {made,stars,note}` (defaults when absent).
  - `setFeedback(doc, no, patch, now) -> Doc` (immutable; clamps stars 0–5; stamps `updated`).
  - `PANTRY_STATES = ['none','ordered','stock']`, `nextPantryState(cur) -> state`.
  - `getPantryState(doc, key) -> 'none'|'ordered'|'stock'`.
  - `setPantryState(doc, key, state, now) -> Doc`, `setPantryMany(doc, keys, state, now) -> Doc`.
  - `recipeRequiredKeys(recipe, basics) -> string[]`, `canMake(recipe, pantryItems, basics) -> boolean`.

- [ ] **Step 1: Write the failing test** — `tests/pantry.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getFeedback, setFeedback,
  nextPantryState, getPantryState, setPantryState, setPantryMany,
  recipeRequiredKeys, canMake
} from '../frost-store.js';

const BASICS = { water:1, salt:1, lemon:1, lime:1 };
const recipe = { no:1, ing: [['oatly','330 ml'], ['self-choc','60 g'], ['salt','pinch',1], ['water','splash']] };

test('getFeedback returns defaults when absent', () => {
  assert.deepEqual(getFeedback({}, 1), { made:false, stars:0, note:'' });
});

test('setFeedback clamps stars and stamps updated, immutably', () => {
  const d0 = {};
  const d1 = setFeedback(d0, 1, { stars: 9, made: true }, 1000);
  assert.equal(d1.recipes['1'].stars, 5);
  assert.equal(d1.recipes['1'].made, true);
  assert.equal(d1.recipes['1'].updated, 1000);
  assert.equal(d1.updated, 1000);
  assert.deepEqual(d0, {}); // original untouched
});

test('setFeedback merges a partial patch onto existing fields', () => {
  let d = setFeedback({}, 2, { stars: 4, note: 'good' }, 1);
  d = setFeedback(d, 2, { made: true }, 2);
  assert.equal(d.recipes['2'].stars, 4);
  assert.equal(d.recipes['2'].note, 'good');
  assert.equal(d.recipes['2'].made, true);
});

test('nextPantryState cycles none -> ordered -> stock -> none', () => {
  assert.equal(nextPantryState('none'), 'ordered');
  assert.equal(nextPantryState('ordered'), 'stock');
  assert.equal(nextPantryState('stock'), 'none');
});

test('setPantryState stores ordered/stock and deletes on none', () => {
  let d = setPantryState({}, 'oatly', 'ordered', 5);
  assert.equal(getPantryState(d, 'oatly'), 'ordered');
  assert.equal(d.pantry.updated, 5);
  d = setPantryState(d, 'oatly', 'none', 6);
  assert.equal(getPantryState(d, 'oatly'), 'none');
  assert.equal('oatly' in d.pantry.items, false);
});

test('setPantryMany bulk-sets keys', () => {
  const d = setPantryMany({}, ['oatly','self-choc'], 'stock', 7);
  assert.equal(getPantryState(d, 'oatly'), 'stock');
  assert.equal(getPantryState(d, 'self-choc'), 'stock');
});

test('recipeRequiredKeys excludes optional items and basics', () => {
  assert.deepEqual(recipeRequiredKeys(recipe, BASICS), ['oatly','self-choc']);
});

test('canMake requires all required keys in stock; ordered does not count', () => {
  let d = setPantryMany({}, ['oatly','self-choc'], 'stock', 1);
  assert.equal(canMake(recipe, d.pantry.items, BASICS), true);
  d = setPantryState(d, 'self-choc', 'ordered', 2);
  assert.equal(canMake(recipe, d.pantry.items, BASICS), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/pantry.test.mjs`
Expected: FAIL — named exports not found.

- [ ] **Step 3: Append implementation to `frost-store.js`**

```js
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
    made:  ('made'  in patch) ? !!patch.made                          : !!cur.made,
    stars: ('stars' in patch) ? Math.max(0, Math.min(5, patch.stars|0)) : (cur.stars|0),
    note:  ('note'  in patch) ? String(patch.note)                    : (cur.note || ''),
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/pantry.test.mjs`
Expected: PASS — `# pass 8`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add frost-store.js tests/pantry.test.mjs
git commit -m "feat: add feedback + tri-state pantry + canMake (pure, tested)"
```

---

## Task 3: Sort + feedback-filter predicates (pure, TDD)

**Files:**
- Modify: `frost-store.js`
- Test: `tests/sortfilter.test.mjs`

**Interfaces:**
- Produces:
  - `sortRecipes(list, mode, doc) -> Recipe[]` where `mode` ∈ `'default'|'rating'|'made'|'protein'|'kcal'`. `'default'` sorts ascending by `no`; ties always break by ascending `no`.
  - `feedbackMatch(recipe, fbFilters, doc) -> boolean` where `fbFilters` is a `Set` over `'made'|'fav'|'unrated'`; empty set matches everything; multiple active filters are ANDed.

- [ ] **Step 1: Write the failing test** — `tests/sortfilter.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortRecipes, feedbackMatch, setFeedback } from '../frost-store.js';

const R = [
  { no:1, protein:54, kcal:420 },
  { no:2, protein:39, kcal:330 },
  { no:3, protein:27, kcal:315 }
];
// doc: recipe 2 = 5 stars + made; recipe 1 = 3 stars
let doc = {};
doc = setFeedback(doc, 2, { stars:5, made:true }, 10);
doc = setFeedback(doc, 1, { stars:3 }, 11);

test('default sort is ascending by recipe number', () => {
  assert.deepEqual(sortRecipes(R, 'default', doc).map(r => r.no), [1,2,3]);
});

test('rating sort is highest stars first, unrated last, ties by no', () => {
  assert.deepEqual(sortRecipes(R, 'rating', doc).map(r => r.no), [2,1,3]);
});

test('made sort puts made-it recipes first', () => {
  assert.equal(sortRecipes(R, 'made', doc)[0].no, 2);
});

test('protein sort is descending', () => {
  assert.deepEqual(sortRecipes(R, 'protein', doc).map(r => r.no), [1,2,3]);
});

test('kcal sort is ascending', () => {
  assert.deepEqual(sortRecipes(R, 'kcal', doc).map(r => r.no), [3,2,1]);
});

test('feedbackMatch with empty set matches all', () => {
  assert.equal(feedbackMatch(R[0], new Set(), doc), true);
});

test('feedbackMatch made / fav / unrated', () => {
  assert.equal(feedbackMatch({no:2}, new Set(['made']), doc), true);
  assert.equal(feedbackMatch({no:1}, new Set(['made']), doc), false);
  assert.equal(feedbackMatch({no:2}, new Set(['fav']), doc), true);   // 5 stars
  assert.equal(feedbackMatch({no:1}, new Set(['fav']), doc), false);  // 3 stars
  assert.equal(feedbackMatch({no:3}, new Set(['unrated']), doc), true);
  assert.equal(feedbackMatch({no:2}, new Set(['unrated']), doc), false);
});

test('sortRecipes does not mutate the input array', () => {
  const copy = R.slice();
  sortRecipes(R, 'rating', doc);
  assert.deepEqual(R, copy);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/sortfilter.test.mjs`
Expected: FAIL — `sortRecipes` / `feedbackMatch` not exported.

- [ ] **Step 3: Append implementation to `frost-store.js`**

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/sortfilter.test.mjs`
Expected: PASS — `# pass 8`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add frost-store.js tests/sortfilter.test.mjs
git commit -m "feat: add recipe sort + feedback filter predicates (pure, tested)"
```

---

## Task 4: PKCE + Dropbox auth-URL/body helpers (pure, TDD)

**Files:**
- Modify: `frost-store.js`
- Test: `tests/pkce.test.mjs`

**Interfaces:**
- Produces:
  - `base64UrlFromBytes(Uint8Array) -> string` (no padding, `-`/`_`).
  - `randomVerifier(len=64) -> string`.
  - `async pkceChallenge(verifier) -> string` (base64url of SHA-256).
  - `buildAuthUrl({appKey, redirectUri, challenge, scope}) -> string`.
  - `tokenExchangeBody({code, verifier, appKey, redirectUri}) -> URLSearchParams`.
  - `tokenRefreshBody({refreshToken, appKey}) -> URLSearchParams`.

- [ ] **Step 1: Write the failing test** — `tests/pkce.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  base64UrlFromBytes, pkceChallenge, buildAuthUrl,
  tokenExchangeBody, tokenRefreshBody
} from '../frost-store.js';

test('base64UrlFromBytes is URL-safe and unpadded', () => {
  // 0xFB 0xFF -> base64 "+/8=" -> base64url "-_8"
  assert.equal(base64UrlFromBytes(new Uint8Array([0xFB, 0xFF])), '-_8');
});

test('pkceChallenge matches the RFC 7636 Appendix B test vector', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = await pkceChallenge(verifier);
  assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('buildAuthUrl includes the required PKCE + offline params', () => {
  const url = buildAuthUrl({
    appKey: 'KEY', redirectUri: 'https://ried.cl/iskrem/',
    challenge: 'CHAL', scope: 'files.content.read files.content.write'
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://www.dropbox.com/oauth2/authorize');
  assert.equal(u.searchParams.get('client_id'), 'KEY');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('code_challenge'), 'CHAL');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://ried.cl/iskrem/');
  assert.equal(u.searchParams.get('token_access_type'), 'offline');
});

test('token bodies carry the right grant + fields', () => {
  const ex = tokenExchangeBody({ code:'C', verifier:'V', appKey:'K', redirectUri:'R' });
  assert.equal(ex.get('grant_type'), 'authorization_code');
  assert.equal(ex.get('code'), 'C');
  assert.equal(ex.get('code_verifier'), 'V');
  assert.equal(ex.get('client_id'), 'K');
  assert.equal(ex.get('redirect_uri'), 'R');

  const rf = tokenRefreshBody({ refreshToken:'RT', appKey:'K' });
  assert.equal(rf.get('grant_type'), 'refresh_token');
  assert.equal(rf.get('refresh_token'), 'RT');
  assert.equal(rf.get('client_id'), 'K');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/pkce.test.mjs`
Expected: FAIL — exports not found.

- [ ] **Step 3: Append implementation to `frost-store.js`**

```js
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
```

- [ ] **Step 4: Run the full suite to verify everything passes**

Run: `npm test`
Expected: PASS across all four files — `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add frost-store.js tests/pkce.test.mjs
git commit -m "feat: add PKCE + Dropbox auth URL/body helpers (pure, tested)"
```

---

## Task 5: Load `frost-store.js` into the page + config + local persistence (integration)

Converts the inline script to a module, wires config + localStorage, with **no visible behavior change yet**. This isolates the risky module conversion from feature work.

**Files:**
- Modify: `index.html` — script tag, `index.html:300` (`<script>` open) and the data/state region.

**Interfaces:**
- Consumes: all exports from Task 1–4.
- Produces (in-page globals within the module scope): `DOC` (current document), `loadDoc()`, `saveDocLocal(doc)`, config constants `DROPBOX_APP_KEY`, `DROPBOX_FILE_PATH`, `DROPBOX_REDIRECT_URI`, `OAUTH_SCOPE`.

- [ ] **Step 1: Convert the script tag and import the module**

In `index.html`, change the opening tag at line 300 from `<script>` to:

```html
<script type="module">
import * as Store from './frost-store.js';
```

- [ ] **Step 2: Add config + persistence just below the import (top of the module)**

```js
/* ============================ CONFIG ============================ */
const DROPBOX_APP_KEY = "2zmn7d9rz2cdeqr";          // public (PKCE: no secret)
const DROPBOX_FILE_PATH = "/frost-feedback.json";   // in the App folder
const DROPBOX_REDIRECT_URI =
  location.hostname === "localhost"
    ? "http://localhost:8000/"
    : "https://ried.cl/iskrem/";
const OAUTH_SCOPE = "files.content.read files.content.write account_info.read";

/* ============================ LOCAL STORE ============================ */
const DOC_KEY = "frost.feedback.v1";
function loadDoc() {
  try { return Store.normalizeDoc(JSON.parse(localStorage.getItem(DOC_KEY) || "null")); }
  catch (e) { return Store.emptyDoc(); }
}
let DOC = loadDoc();
function saveDocLocal(doc) {
  DOC = doc;
  try { localStorage.setItem(DOC_KEY, JSON.stringify(doc)); } catch (e) { /* private mode: in-memory only */ }
}
```

- [ ] **Step 3: Serve locally and verify the app still works**

Run (in the project root): `npx --yes http-server -p 8000 -c-1 .`
(Alternative if Python is present: `python -m http.server 8000`.)
Then open `http://localhost:8000/`.
Expected: the page renders all recipes, filters/search/sort-by-tags still work exactly as before, **no console errors**, and `frost-store.js` loads (Network tab shows 200). The module conversion broke nothing.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "refactor: load frost-store module + config + local doc store"
```

---

## Task 6: Feedback editor in the reading view + card badge (integration)

**Files:**
- Modify: `index.html` — CSS block (after `.idx` rules near `index.html:120`), `cardHTML` (`index.html:886`), `openFocus` (`index.html:990`).

**Interfaces:**
- Consumes: `Store.getFeedback`, `Store.setFeedback`, `DOC`, `saveDocLocal`, `Sync.schedule` (defined in Task 10; guard its absence with `window.__sync`-style optional call — see Step 4).
- Produces: `feedbackBadgeHTML(r)`, `feedbackEditorHTML(r)`, `wireFeedbackEditor(r, rootEl)`, `applyFeedback(no, patch)`.

- [ ] **Step 1: Add CSS for the badge, stars, and editor**

Add to the `<style>` block:

```css
.fb-badge{display:flex;align-items:center;gap:8px;margin:10px 0 0;font-size:.74rem;color:var(--ink-faint);}
.fb-badge .stars{color:var(--amber);letter-spacing:1px;font-size:.9rem;}
.fb-badge .made{font-weight:600;color:var(--sage-deep);border:1px solid var(--line);border-radius:30px;padding:2px 9px;letter-spacing:.08em;text-transform:uppercase;font-size:.62rem;}
.fb-editor{margin:16px 0 0;padding:16px 0 0;border-top:1px solid var(--line-soft);}
.fb-editor h4{font-family:var(--font-body);font-weight:600;font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint);margin:0 0 10px;}
.fb-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:10px;}
.fb-made{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:.9rem;color:var(--ink);}
.fb-made input{width:18px;height:18px;accent-color:var(--sage);}
.fb-stars{display:inline-flex;gap:3px;}
.fb-stars button{border:0;background:none;cursor:pointer;font-size:1.4rem;line-height:1;color:var(--line);padding:0;}
.fb-stars button.on{color:var(--amber);}
.fb-clear{border:0;background:none;color:var(--ink-faint);cursor:pointer;font-size:.74rem;border-bottom:1px dotted var(--line);}
.fb-note{width:100%;min-height:64px;border:1px solid var(--line);border-radius:4px;background:var(--white);padding:10px 12px;font-family:var(--font-body);font-size:.9rem;color:var(--ink);resize:vertical;}
.fb-saved{font-size:.7rem;color:var(--sage);margin-left:auto;}
```

- [ ] **Step 2: Add the badge to `cardHTML`**

Define the helper above `cardHTML`:

```js
function feedbackBadgeHTML(r){
  const fb = Store.getFeedback(DOC, r.no);
  if(!fb.made && !fb.stars) return '';
  const stars = fb.stars ? '<span class="stars">'+'★'.repeat(fb.stars)+'<span style="color:var(--line)">'+'☆'.repeat(5-fb.stars)+'</span></span>' : '';
  const made = fb.made ? '<span class="made">✓ Made it</span>' : '';
  return '<div class="fb-badge">'+made+stars+'</div>';
}
```

Then insert it into the card markup in `cardHTML`, immediately before `'<div class="card-spacer">'`:

```js
    +feedbackBadgeHTML(r)
    +'<div class="card-spacer"></div><div class="card-tags">'+tags+'</div>'
```

- [ ] **Step 3: Add the editor builder + wiring**

```js
function feedbackEditorHTML(r){
  const fb = Store.getFeedback(DOC, r.no);
  let stars='';
  for(let i=1;i<=5;i++) stars+='<button type="button" data-star="'+i+'" class="'+(i<=fb.stars?'on':'')+'">★</button>';
  return '<div class="fb-editor" data-no="'+r.no+'">'
    +'<h4>Your feedback</h4>'
    +'<div class="fb-row">'
      +'<label class="fb-made"><input type="checkbox" '+(fb.made?'checked':'')+'> Made it</label>'
      +'<span class="fb-stars">'+stars+'</span>'
      +'<button type="button" class="fb-clear">clear stars</button>'
      +'<span class="fb-saved" hidden>saved</span>'
    +'</div>'
    +'<textarea class="fb-note" placeholder="What did you change? How was it?">'+esc(fb.note)+'</textarea>'
  +'</div>';
}

function applyFeedback(no, patch){
  saveDocLocal(Store.setFeedback(DOC, no, patch, Date.now()));
  if (window.FrostSync) window.FrostSync.schedule(); // no-op until Task 10
}

function wireFeedbackEditor(rootEl){
  const ed = rootEl.querySelector('.fb-editor'); if(!ed) return;
  const no = +ed.dataset.no;
  const saved = ed.querySelector('.fb-saved');
  const flash = () => { saved.hidden=false; clearTimeout(flash._t); flash._t=setTimeout(()=>{saved.hidden=true;},1200); };
  ed.querySelector('.fb-made input').onchange = function(){ applyFeedback(no,{made:this.checked}); flash(); };
  ed.querySelectorAll('.fb-stars button').forEach(function(b){
    b.onclick = function(){
      const v = +b.dataset.star;
      const cur = Store.getFeedback(DOC,no).stars;
      const next = (v===cur) ? v-1 : v;          // click the current top star to step down
      applyFeedback(no,{stars:next});
      ed.querySelectorAll('.fb-stars button').forEach(x=>x.classList.toggle('on', +x.dataset.star<=next));
      flash();
    };
  });
  ed.querySelector('.fb-clear').onclick = function(){
    applyFeedback(no,{stars:0});
    ed.querySelectorAll('.fb-stars button').forEach(x=>x.classList.remove('on'));
    flash();
  };
  let noteT=null;
  ed.querySelector('.fb-note').oninput = function(){
    const val=this.value; clearTimeout(noteT);
    noteT=setTimeout(()=>{ applyFeedback(no,{note:val}); flash(); }, 400);
  };
}
```

- [ ] **Step 4: Render the editor in the focus view**

Change `openFocus` so the editor is appended after the recipe card and wired:

```js
function openFocus(no){
  var r=RECIPES.filter(function(x){return x.no===no;})[0]; if(!r)return;
  document.getElementById('focusInner').innerHTML = cardHTML(r) + feedbackEditorHTML(r);
  wireFeedbackEditor(document.getElementById('focusInner'));
  document.getElementById('focus').hidden=false; document.body.style.overflow='hidden';
}
```

- [ ] **Step 5: Verify locally**

Serve (`npx --yes http-server -p 8000 -c-1 .`) and open `http://localhost:8000/`.
1. Click a recipe → the reading view shows "Your feedback" with checkbox, 5 stars, notes.
2. Tick "Made it", set 4 stars, type a note. Close the modal.
3. The grid card now shows the `✓ Made it` pill + `★★★★☆`.
4. **Reload the page** → reopen the recipe → the checkbox, stars, and note are still there (localStorage persisted).
Expected: all of the above; no console errors.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: per-recipe feedback editor + card badge (local-first)"
```

---

## Task 7: My Pantry configurator + rewire "Can make" (integration)

**Files:**
- Modify: `index.html` — CSS, the filter panel markup (`index.html:266-277`), the data/state region, `buildChips`/`render` wiring, `ingMatch`/`recipeRequires` usage, and the `tickHave` handler (`index.html:983`).

**Interfaces:**
- Consumes: `Store.getPantryState`, `Store.setPantryState`, `Store.setPantryMany`, `Store.nextPantryState`, `Store.canMake`, `DOC`, `saveDocLocal`, `ING`, `BASICS`, `OWNED`.
- Produces: `buildPantry()`, `cyclePantry(key)`, `pantryStock()` (object of in-stock items), updated `ingMatch` make-mode branch.

- [ ] **Step 1: Add CSS for tri-state pantry chips**

```css
.pantry-chip{font-size:.78rem;border:1px solid var(--line);background:var(--white);color:var(--ink-soft);border-radius:30px;padding:5px 12px;cursor:pointer;user-select:none;white-space:nowrap;transition:.12s;}
.pantry-chip[data-st="ordered"]{background:var(--amber);border-color:var(--amber);color:#fff;}
.pantry-chip[data-st="stock"]{background:var(--sage);border-color:var(--sage);color:#fff;}
.pantry-chip .mk{opacity:.85;margin-left:6px;font-size:.66rem;letter-spacing:.04em;}
.pantry-legend{display:flex;gap:14px;align-items:center;font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint);margin:0 0 10px;}
.pantry-legend i{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:5px;vertical-align:-1px;}
.pantry-legend .o{background:var(--amber);} .pantry-legend .s{background:var(--sage);}
```

- [ ] **Step 2: Add the pantry panel markup**

Inside `<div class="filter-groups" id="filterGroups">` (after the ingredient `fgroup`, before the tags `fgroup` at `index.html:273`), add:

```html
      <div class="fgroup">
        <h5>My Pantry — what I've ordered / have in stock
          <span class="mini" id="pantryFill">quick-fill my usual</span> · <span class="mini" id="pantryClear">clear</span></h5>
        <div class="pantry-legend"><span><i class="o"></i>ordered</span><span><i class="s"></i>in stock</span><span>click to cycle</span></div>
        <div class="chips" id="pantryChips"></div>
      </div>
```

- [ ] **Step 3: Add pantry build + cycle logic**

```js
function pantryStock(){
  const items = Store.normalizeDoc(DOC).pantry.items, out={};
  for(const k in items) if(items[k]==='stock') out[k]='stock';
  return out;
}
function buildPantry(){
  var groups={}; Object.keys(ING).forEach(function(k){var g=ING[k].g;(groups[g]=groups[g]||[]).push(k);});
  var html='';
  Object.keys(groups).forEach(function(g){
    html+='<button type="button" class="grouphd" data-pg="'+esc(g)+'">'+esc(g)+'</button>';
    groups[g].forEach(function(k){
      var st=Store.getPantryState(DOC,k);
      var mk= st==='ordered'?'<span class="mk">ordered</span>': st==='stock'?'<span class="mk">in stock</span>':'';
      html+='<span class="pantry-chip" data-k="'+k+'" data-st="'+st+'">'+esc(ING[k].n)+mk+'</span>';
    });
  });
  document.getElementById('pantryChips').innerHTML=html;
  document.querySelectorAll('#pantryChips .pantry-chip').forEach(function(el){
    el.onclick=function(){ cyclePantry(el.dataset.k); };
  });
}
function cyclePantry(key){
  var next = Store.nextPantryState(Store.getPantryState(DOC,key));
  saveDocLocal(Store.setPantryState(DOC, key, next, Date.now()));
  if (window.FrostSync) window.FrostSync.schedule();
  buildPantry();
  if(state.haveMode==='make') render();   // recompute "Can make" if active
}
```

- [ ] **Step 4: Rewire the "Can make" filter to read the pantry**

In `ingMatch` (`index.html:867`), replace the `make` branch so it reads the saved in-stock pantry instead of `state.have`:

```js
function ingMatch(r){
  if(state.haveMode==='make') return Store.canMake(r, pantryStock(), BASICS);  // pantry-driven
  if(state.have.size===0) return true;
  var arr=[...state.have];
  if(state.haveMode==='all') return arr.every(function(k){return recipeHasIng(r,k);});
  return arr.some(function(k){return recipeHasIng(r,k);});
}
```

- [ ] **Step 5: Repoint the "ordered/in stock" helpers + remove the old preset behaviour**

Replace the `tickHave` handler (`index.html:983`) and add the new pantry-panel handlers. The "quick-fill my usual" marks `OWNED` as **in stock**:

```js
document.getElementById('pantryFill').onclick=function(){
  saveDocLocal(Store.setPantryMany(DOC, OWNED, 'stock', Date.now()));
  if (window.FrostSync) window.FrostSync.schedule();
  buildPantry(); if(state.haveMode==='make') render();
};
document.getElementById('pantryClear').onclick=function(){
  saveDocLocal(Store.setPantryMany(DOC, Object.keys(ING), 'none', Date.now()));
  if (window.FrostSync) window.FrostSync.schedule();
  buildPantry(); if(state.haveMode==='make') render();
};
document.querySelectorAll('#pantryChips .grouphd').forEach(function(){}); // group click optional; left as no-op
```

Then delete the now-obsolete line that referenced the old button id `tickHave` (it no longer exists in the markup — the old `<span id="tickHave">` was inside the ingredient group `h5`; remove that span at `index.html:270`, leaving `select all` / `clear`).

- [ ] **Step 6: Call `buildPantry()` on startup**

At the bottom of the script, change the bootstrap line:

```js
buildChips(); buildPantry(); syncChips(); render();
```

- [ ] **Step 7: Verify locally**

Serve and open `http://localhost:8000/`. Open the Filters panel.
1. In "My Pantry", click an ingredient once → turns amber ("ordered"); twice → sage ("in stock"); third → neutral. Labels update.
2. Mark the required items of a known simple recipe as **in stock**, set ingredient mode to **"Can make"** → that recipe appears; mark one of its items back to **ordered** → it disappears (ordered ≠ available).
3. Click **quick-fill my usual** → the OWNED set flips to in stock.
4. **Reload** → pantry states persist.
Expected: all above; no console errors.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: synced tri-state My Pantry + pantry-driven Can make"
```

---

## Task 8: Sort dropdown + feedback filter chips (integration)

**Files:**
- Modify: `index.html` — `.filter-head` markup (`index.html:259-265`), the filter panel, `state`, `render`.

**Interfaces:**
- Consumes: `Store.sortRecipes`, `Store.feedbackMatch`, `DOC`.
- Produces: `state.sort`, `state.fbFilters` (Set), updated `render()`.

- [ ] **Step 1: Add the sort control + feedback chips markup**

In `.filter-head`, after the `count` span (`index.html:261`), add:

```html
      <label class="fbtn" style="gap:8px;cursor:default">Sort
        <select id="sortSel" style="border:0;background:transparent;font:inherit;color:var(--ink);cursor:pointer;outline:0">
          <option value="default">Recipe №</option>
          <option value="rating">Your rating</option>
          <option value="made">Made it first</option>
          <option value="protein">Protein</option>
          <option value="kcal">Calories</option>
        </select>
      </label>
```

In `<div class="filter-groups">` (top, before the ingredient group), add a feedback group:

```html
      <div class="fgroup">
        <h5>My feedback</h5>
        <div class="chips" id="fbChips">
          <span class="chip fb" data-fb="made">Made it</span>
          <span class="chip fb" data-fb="fav">Favorites (4–5★)</span>
          <span class="chip fb" data-fb="unrated">Want to try</span>
        </div>
      </div>
```

- [ ] **Step 2: Extend state + wire controls**

In the `state` object (`index.html:858`) add `sort:'default'` and `fbFilters:new Set()`:

```js
var state = { have:new Set(), haveMode:'any', tags:new Set(), tagMode:'or', q:'', sort:'default', fbFilters:new Set() };
```

Add handlers (near the other control handlers, around `index.html:980`):

```js
document.getElementById('sortSel').onchange=function(){ state.sort=this.value; render(); };
document.querySelectorAll('#fbChips .chip.fb').forEach(function(el){
  el.onclick=function(){
    var k=el.dataset.fb;
    state.fbFilters.has(k)?state.fbFilters.delete(k):state.fbFilters.add(k);
    el.classList.toggle('on', state.fbFilters.has(k));
    render();
  };
});
```

- [ ] **Step 3: Apply filter + sort in `render`**

Change the first line of `render()` (`index.html:917`):

```js
function render(){
  var list=RECIPES.filter(function(r){return ingMatch(r)&&tagMatch(r)&&qMatch(r)&&Store.feedbackMatch(r,state.fbFilters,DOC);});
  list=Store.sortRecipes(list, state.sort, DOC);
  document.getElementById('grid').innerHTML=list.map(cardHTML).join('');
  // ...rest unchanged
```

- [ ] **Step 4: Verify locally**

Serve and open the page.
1. Rate a few recipes differently. Switch Sort → "Your rating": highest-starred first, unrated last.
2. Sort → "Made it first": made recipes lead. "Protein"/"Calories" reorder by macro.
3. Click "Made it" chip → only made recipes show; "Favorites" → only 4–5★; "Want to try" → only un-reviewed. Count updates.
Expected: all above; no console errors.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: sort dropdown + feedback filter chips"
```

---

## Task 9: Dropbox connect / auth flow + token lifecycle (integration)

**Files:**
- Modify: `index.html` — add a Dropbox `fetch` layer + connection bar; bootstrap redirect handling.

**Interfaces:**
- Consumes: `Store.randomVerifier`, `Store.pkceChallenge`, `Store.buildAuthUrl`, `Store.tokenExchangeBody`, `Store.tokenRefreshBody`, config constants.
- Produces: `dbxConnect()`, `dbxDisconnect()`, `dbxHandleRedirect()`, `dbxAccessToken()`, `loadTokens()/saveTokens()/clearTokens()`, `renderConnBar()`, `isConnected()`.

- [ ] **Step 1: Add the connection bar markup**

In `.filter-head`, after the Reset button (`index.html:264`), add:

```html
      <span id="connbar" class="fbtn" style="gap:8px"></span>
```

- [ ] **Step 2: Add token storage + auth layer**

```js
/* ============================ DROPBOX AUTH ============================ */
const TOK_KEY = "frost.dbx.tok.v1";
function loadTokens(){ try { return JSON.parse(localStorage.getItem(TOK_KEY) || "null"); } catch(e){ return null; } }
function saveTokens(t){ try { localStorage.setItem(TOK_KEY, JSON.stringify(t)); } catch(e){} }
function clearTokens(){ try { localStorage.removeItem(TOK_KEY); } catch(e){} }
function isConnected(){ return !!loadTokens(); }

async function dbxConnect(){
  const verifier = Store.randomVerifier();
  sessionStorage.setItem("frost.pkce", verifier);
  const challenge = await Store.pkceChallenge(verifier);
  location.href = Store.buildAuthUrl({ appKey:DROPBOX_APP_KEY, redirectUri:DROPBOX_REDIRECT_URI, challenge, scope:OAUTH_SCOPE });
}

function dbxDisconnect(){ clearTokens(); renderConnBar(); }

async function dbxExchangeCode(code){
  const verifier = sessionStorage.getItem("frost.pkce");
  const body = Store.tokenExchangeBody({ code, verifier, appKey:DROPBOX_APP_KEY, redirectUri:DROPBOX_REDIRECT_URI });
  const r = await fetch("https://api.dropboxapi.com/oauth2/token",
    { method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body });
  if(!r.ok) throw new Error("token exchange failed: "+r.status);
  const j = await r.json();
  saveTokens({ access:j.access_token, refresh:j.refresh_token, exp: Date.now() + (j.expires_in*1000) - 60000 });
  sessionStorage.removeItem("frost.pkce");
}

async function dbxAccessToken(){
  let t = loadTokens(); if(!t) return null;
  if(Date.now() < t.exp) return t.access;
  const body = Store.tokenRefreshBody({ refreshToken:t.refresh, appKey:DROPBOX_APP_KEY });
  const r = await fetch("https://api.dropboxapi.com/oauth2/token",
    { method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body });
  if(!r.ok){ clearTokens(); renderConnBar(); return null; }
  const j = await r.json();
  t.access = j.access_token; t.exp = Date.now() + (j.expires_in*1000) - 60000;
  if(j.refresh_token) t.refresh = j.refresh_token;
  saveTokens(t); return t.access;
}

async function dbxHandleRedirect(){
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if(!code) return false;
  try { await dbxExchangeCode(code); }
  catch(e){ console.warn("Dropbox connect failed", e); }
  history.replaceState({}, "", DROPBOX_REDIRECT_URI);
  return true;
}
```

- [ ] **Step 3: Add the connection-bar renderer**

```js
let lastSync = 0, syncStatus = "idle";
function renderConnBar(){
  const el = document.getElementById("connbar"); if(!el) return;
  if(!isConnected()){
    el.innerHTML = '<button id="dbxConnect" class="fbtn active" style="height:auto;padding:4px 12px">Connect Dropbox</button>';
    el.querySelector("#dbxConnect").onclick = dbxConnect;
    return;
  }
  const when = lastSync ? new Date(lastSync).toLocaleTimeString() : "—";
  const label = syncStatus==="syncing" ? "syncing…" : syncStatus==="error" ? "sync error" : "Synced ✓";
  el.innerHTML = '<span title="Dropbox">'+label+' · '+when+'</span> <button id="dbxOff" class="fb-clear" style="margin-left:6px">disconnect</button>';
  el.querySelector("#dbxOff").onclick = dbxDisconnect;
}
```

- [ ] **Step 4: Bootstrap — handle redirect then render the bar**

Replace the bootstrap line so it runs async:

```js
(async function(){
  await dbxHandleRedirect();
  buildChips(); buildPantry(); syncChips(); render();
  renderConnBar();
})();
```

- [ ] **Step 5: One-time owner setup (prerequisite for live verification)**

Follow `DROPBOX_SETUP.md` (Task 11) to register the app and add the `http://localhost:8000/` redirect URI **before** verifying. Without it, Dropbox returns a redirect-URI error.

- [ ] **Step 6: Verify the auth round-trip locally**

Serve on port 8000 and open `http://localhost:8000/`.
1. Click **Connect Dropbox** → redirected to Dropbox → approve → redirected back to `localhost:8000/` with the `?code=` stripped after load.
2. The bar now reads **"Synced ✓ · <time>"** with a **disconnect** link.
3. In the browser console: `localStorage.getItem('frost.dbx.tok.v1')` shows access + refresh tokens.
4. Click **disconnect** → bar returns to **Connect Dropbox**; the token key is gone.
Expected: all above; no console errors during the round-trip.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: Dropbox PKCE connect + token lifecycle + connection bar"
```

---

## Task 10: Sync controller — download/merge/upload (integration)

**Files:**
- Modify: `index.html` — add the sync controller + Dropbox file calls; hook it to feedback/pantry changes and startup.

**Interfaces:**
- Consumes: `dbxAccessToken`, `DROPBOX_FILE_PATH`, `Store.merge`, `Store.emptyDoc`, `Store.normalizeDoc`, `DOC`, `saveDocLocal`, `render`, `buildPantry`, `renderConnBar`.
- Produces: `window.FrostSync = { schedule, syncNow }` (the `window.FrostSync` guards in Tasks 6–7 now activate); `dbxDownload()`, `dbxUpload(doc)`.

- [ ] **Step 1: Add the Dropbox file calls**

```js
/* ============================ DROPBOX FILES ============================ */
async function dbxDownload(){
  const tok = await dbxAccessToken(); if(!tok) return null;
  const r = await fetch("https://content.dropboxapi.com/2/files/download",
    { method:"POST", headers:{ "Authorization":"Bearer "+tok, "Dropbox-API-Arg": JSON.stringify({ path:DROPBOX_FILE_PATH }) } });
  if(r.status===409) return Store.emptyDoc();         // path/not_found → empty remote
  if(!r.ok) throw new Error("download failed: "+r.status);
  const text = await r.text();
  try { return Store.normalizeDoc(JSON.parse(text)); } catch(e){ return Store.emptyDoc(); }
}
async function dbxUpload(doc){
  const tok = await dbxAccessToken(); if(!tok) return;
  const r = await fetch("https://content.dropboxapi.com/2/files/upload",
    { method:"POST", headers:{
        "Authorization":"Bearer "+tok,
        "Dropbox-API-Arg": JSON.stringify({ path:DROPBOX_FILE_PATH, mode:"overwrite", mute:true }),
        "Content-Type":"application/octet-stream"
      }, body: JSON.stringify(doc) });
  if(!r.ok) throw new Error("upload failed: "+r.status);
}
```

- [ ] **Step 2: Add the sync controller**

```js
/* ============================ SYNC ============================ */
window.FrostSync = (function(){
  let timer = null;
  async function syncNow(){
    if(!isConnected()) return;
    syncStatus = "syncing"; renderConnBar();
    try {
      const remote = await dbxDownload();
      const merged = Store.merge(DOC, remote || Store.emptyDoc());
      saveDocLocal(merged);
      await dbxUpload(merged);
      lastSync = Date.now(); syncStatus = "synced"; renderConnBar();
      render(); buildPantry();        // reflect anything merged in from another device
    } catch(e){
      console.warn("sync failed", e); syncStatus = "error"; renderConnBar();
    }
  }
  function schedule(){ if(!isConnected()) return; clearTimeout(timer); timer = setTimeout(syncNow, 2000); }
  return { schedule, syncNow };
})();
```

- [ ] **Step 3: Sync on startup when already connected**

In the bootstrap IIFE (Task 9 Step 4), after `renderConnBar();` add:

```js
  if(isConnected()) window.FrostSync.syncNow();
```

- [ ] **Step 4: Verify cross-device sync**

Prereq: app registered (Task 11) and connected (Task 9).
1. On **Browser A** (`localhost:8000`, connected): rate recipe #1 (5★, "made it"), mark a pantry item in stock. Within ~2s the bar shows "syncing…" then "Synced ✓".
2. In Dropbox (web), confirm `Apps/<AppName>/frost-feedback.json` exists and contains the rating + pantry.
3. On **Browser B** (e.g. a private window / another browser), connect the same Dropbox account → after the startup sync, recipe #1 shows the rating and the pantry item is in stock.
4. Edit recipe #1 on B (3★), wait for sync; reload A → A shows 3★ (newest-per-recipe won). Earlier-edited recipes are untouched.
5. Turn off network, rate recipe #2 → saved locally, bar shows "sync error"; restore network, change anything → recipe #2 syncs up.
Expected: all above.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: Dropbox sync controller (download/merge/upload, debounced)"
```

---

## Task 11: Owner setup doc + final QA (docs)

**Files:**
- Create: `DROPBOX_SETUP.md`

- [ ] **Step 1: Write `DROPBOX_SETUP.md`**

```markdown
# Dropbox setup (one-time, owner only)

Users set up nothing — they just click "Connect Dropbox". This is the single
one-time step the site owner does so that button works.

1. Go to https://www.dropbox.com/developers/apps → **Create app**.
2. **Choose an API:** Scoped access.
3. **Type of access:** App folder (the app only ever sees `/Apps/<AppName>/`).
4. **Name** it uniquely, e.g. `FROST Recipe Reviews` → **Create app**.
5. **Settings tab:**
   - Copy the **App key**. It must equal `DROPBOX_APP_KEY` in `index.html`
     (currently `2zmn7d9rz2cdeqr`). The App **secret is not used** — never put it in any file.
   - **OAuth 2 → Redirect URIs:** add all three (exact strings):
     - `https://ried.cl/iskrem/`
     - `https://ried.cl/iskrem`
     - `http://localhost:8000/`
6. **Permissions tab:** enable `files.content.read`, `files.content.write`,
   `account_info.read` → **Submit**.
7. The app starts in **Development** status — fine for personal/family/friends use.
   If it grows, click **Apply for production** (free).

## Local testing
Serve over http (ES modules + the localhost redirect URI need a real origin):

    npx --yes http-server -p 8000 -c-1 .
    # then open http://localhost:8000/

Run unit tests:

    npm test
```

- [ ] **Step 2: Run the full unit suite one last time**

Run: `npm test`
Expected: all four test files pass — `# fail 0`.

- [ ] **Step 3: Full manual QA pass (spec §12)**

Walk the spec's cross-device checklist end-to-end: feedback persists locally; pantry persists + drives "Can make"; connect → reviews **and** pantry appear on a second browser; two-device edit merges newest-per-recipe; disconnect keeps local data; offline edit syncs on reconnect.

- [ ] **Step 4: Commit**

```bash
git add DROPBOX_SETUP.md
git commit -m "docs: Dropbox one-time owner setup + local testing notes"
```

---

## Self-Review

**Spec coverage:**
- §3 data model → Task 1 (`emptyDoc/normalizeDoc`), feedback shape Task 2, pantry shape Task 2.
- §4 local-first → Task 5 (`loadDoc/saveDocLocal`), used by all UI tasks.
- §5 Dropbox PKCE/config/token/file API → Tasks 4 (pure), 9 (auth+tokens), 10 (files).
- §6 sync merge → Task 1 (`merge`), Task 10 (controller, triggers a/b/c).
- §7.1 card badge → Task 6; §7.2 editor → Task 6; §7.3 connection control → Task 9; §7.4 feedback chips → Task 8; §7.5 sort → Task 8; §7.6 pantry + rewired "Can make" → Task 7.
- §8 error handling → Task 9 (auth fail/refresh-revoke), Task 10 (download 409 = empty, upload/download try-catch → "sync error", local never blocked), Task 5 (localStorage try-catch).
- §9 module split → Task 1 creates `frost-store.js`; Task 5 imports it.
- §10 owner setup → Task 11.
- §12 testing → Tasks 1–4 unit tests + Task 11 manual pass.
- §11 security (key public, secret unused, token in localStorage) → encoded in Global Constraints + Task 9 comments + Task 11 doc.

**Placeholder scan:** No TBD/TODO; every code step contains full code; manual-verification steps list concrete actions and expected results. The one intentional no-op (`#pantryChips .grouphd` handler in Task 7 Step 5) is explicitly labelled optional, not a gap.

**Type consistency:** `Doc` shape is identical across tasks; `merge/setFeedback/setPantryState` all return a full normalized `Doc`. `window.FrostSync.schedule` is referenced (guarded) in Tasks 6–7 and defined in Task 10. `pantryStock()` (Task 7) feeds `Store.canMake(recipe, items, basics)` matching Task 2's signature. `renderConnBar`, `lastSync`, `syncStatus`, `isConnected` are defined in Task 9 and consumed in Task 10. Sort modes (`default/rating/made/protein/kcal`) match between the `<select>` (Task 8) and `sortRecipes` (Task 3).
