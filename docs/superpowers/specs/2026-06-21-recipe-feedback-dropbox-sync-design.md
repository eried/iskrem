# Recipe Feedback + Synced Pantry (Dropbox) — Design

**Date:** 2026-06-21
**Project:** FROST — Creami Recipe Database (`index.html`, single static file)
**Status:** Design approved in brainstorming; pending written-spec review.

## 1. Goal

Give each visitor two pieces of personal, persistent state that follow them across devices
via their *own* Dropbox account:

1. **Per-recipe feedback** — **Made it** (checkbox), **0–5 star** rating, **free-text note**.
2. **A synced pantry** — a "My Pantry" configurator where each ingredient is marked
   **ordered** or **in stock** (or neither). Auto-saves; drives the **"Can make"** filter.

No accounts to create on our side, no server, works on every device including iPhone.

## 2. Users & scope

- **Public site, multi-user.** Every visitor keeps their **own private** reviews.
- **No login system of ours.** Identity = the user's own Dropbox account.
- Each user clicks **"Connect Dropbox"**, authorises once, and their reviews sync to a
  single JSON file inside their Dropbox **App folder**.
- Users who never connect still get full functionality **locally** (see §4); they simply
  don't sync across devices.
- **Owner setup is one-time** (register one Dropbox app, paste the App key). Users set up nothing.

## 3. Data model

All of one user's state is a single JSON document, holding both feedback and pantry:

```json
{
  "version": 1,
  "updated": 1718900000000,
  "recipes": {
    "1": { "made": true,  "stars": 5, "note": "fudgy — perfect",  "updated": 1718900000000 },
    "5": { "made": false, "stars": 3, "note": "too sweet for me", "updated": 1718800000000 }
  },
  "pantry": {
    "updated": 1718900000000,
    "items": {
      "allulose": "stock",
      "self-choc": "ordered",
      "oatly": "stock"
    }
  }
}
```

- `recipes` is keyed by the recipe `no` (string form). Each entry carries its own `updated`
  (epoch ms) — the unit of merge (§6). An entry exists only once the user has interacted
  with that recipe.
- `pantry.items` maps an ingredient key (from `ING`) to its state: `"stock"` (in stock),
  `"ordered"` (on the way), or the key is **absent** (neither). `pantry.updated` is the
  merge unit for the whole pantry object (§6).
- `version` allows future migrations.

## 4. Local-first storage (source of truth)

- Every change writes **immediately** to `localStorage` under key `frost.feedback.v1`, and
  updates the UI synchronously. The app is fully usable offline and with Dropbox disconnected.
- Dropbox is a **sync + durability layer on top** — never a dependency for capturing feedback.
- If `localStorage` is unavailable (e.g. private browsing), degrade to an in-memory store for
  the session and show a one-time non-blocking warning that data won't persist.

## 5. Dropbox integration (serverless, PKCE)

### 5.1 App configuration (in `index.html`)

```js
const DROPBOX_APP_KEY = "2zmn7d9rz2cdeqr";   // public; safe to commit (PKCE uses no secret)
const DROPBOX_FILE_PATH = "/frost-feedback.json"; // relative to the App folder root
const DROPBOX_REDIRECT_URI =
  location.hostname === "localhost"
    ? "http://localhost:8000/"
    : "https://ried.cl/iskrem/";   // must EXACTLY match a registered redirect URI
```

Production site: GitHub Pages project page on a custom apex domain → `https://ried.cl/iskrem/`
(trailing slash is canonical; the no-slash form 301s to it).

- Access type: **App folder** — the app sees only `/Apps/<AppName>/`, not the user's whole Dropbox.
- The **App secret is NOT used** and must never appear in the page.

### 5.2 Auth flow (Authorization Code + PKCE, no secret, no server)

1. On **Connect Dropbox**: generate `code_verifier` (random) + `code_challenge` (S256).
   Persist the verifier in `sessionStorage`.
2. Redirect to:
   `https://www.dropbox.com/oauth2/authorize?client_id={APP_KEY}&response_type=code&code_challenge={challenge}&code_challenge_method=S256&redirect_uri={REDIRECT_URI}&token_access_type=offline&scope=files.content.read files.content.write account_info.read`
3. Dropbox redirects back to `REDIRECT_URI` with `?code=...`.
4. On load, detect `code`, then `POST https://api.dropboxapi.com/oauth2/token`
   (`grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `redirect_uri`)
   → `{ access_token, refresh_token, expires_in }`. Clean the `code` from the URL.
5. Persist `refresh_token`, `access_token`, and expiry in `localStorage`.

### 5.3 Token lifecycle

- Before each API call, if the access token is expired/near-expiry, refresh:
  `POST .../oauth2/token` with `grant_type=refresh_token`, `refresh_token`, `client_id`.
- If refresh fails (revoked): drop to disconnected state, keep all local data, prompt to reconnect.

### 5.4 File API (CORS-supported)

- **Download:** `POST https://content.dropboxapi.com/2/files/download`,
  header `Dropbox-API-Arg: {"path":"/frost-feedback.json"}`.
  A "not found" (HTTP 409 `path/not_found`) is treated as an **empty** remote document.
- **Upload:** `POST https://content.dropboxapi.com/2/files/upload`,
  header `Dropbox-API-Arg: {"path":"/frost-feedback.json","mode":"overwrite","mute":true}`,
  `Content-Type: application/octet-stream`, body = the JSON string.

## 6. Sync strategy — merge, never clobber

Triggered (a) right after connecting, (b) on page load if connected, and (c) debounced ~2s
after each edit while connected:

1. **Download** the remote document (empty if absent).
2. **Merge** local + remote:
   - **Recipes** at recipe-entry granularity — for each recipe `no` in either side, keep the
     entry whose `updated` is newer.
   - **Pantry** as a whole object — keep the `pantry` whose `pantry.updated` is newer
     (last-write-wins for the pantry as a unit).
   - Top-level `updated` = max of the two.
3. Write the merged document to **both** `localStorage` and Dropbox (upload, `overwrite`).

This is last-write-wins (**per recipe**, and **per pantry-object**) — correct and predictable
for one person across a few devices. The merge function is written **pure**
(`merge(local, remote) -> merged`) so it is unit-testable in isolation. *Note:* whole-object
pantry LWW means two devices editing the pantry while both offline could lose one side's
change on reconnect — an accepted simplification for this use case.

## 7. UI

### 7.1 Recipe card (grid) — read-only summary

- Show a compact badge **only when the user has rated/made it**: star dots (e.g. `★★★★☆`) and a
  "✓ Made it" pill. Keeps the grid clean for un-reviewed recipes.
- Clicking the card opens the reading view exactly as today.

### 7.2 Reading view (modal) — editable feedback block

A "Your feedback" block at the bottom of the focus modal:
- `[ ] Made it` checkbox.
- **0–5 stars**, clickable. Clicking star *n* sets the rating to *n*; a small "×/clear" resets to 0.
- **Notes** textarea ("What did you change? How was it?").
- **Auto-saves**: local instantly; cloud debounced (§6) when connected. Subtle "saved / syncing" hint.

### 7.3 Connection control (masthead / filter bar)

- Disconnected: **"Connect Dropbox"** button + one-line hint ("sync your reviews across devices").
- Connected: "Synced ✓ · Dropbox" + last-sync time + **Disconnect** (Disconnect clears tokens; local
  feedback is retained).
- A small status indicator: idle / syncing / error.

### 7.4 Filter by your feedback (extends the existing chip system)

New chips: **Made it**, **Favorites (4–5★)**, **Want to try (unrated)**. Implemented via a new
`state.fbFilters` set, applied in `render()` alongside the existing ingredient/tag/search matchers.

### 7.5 Sort (new — the site currently does no sorting)

A small **Sort** dropdown near the recipe count:
- **Recipe № (default)** — current order
- **Your rating (high → low)** — unrated sort to the bottom
- **Made it first**
- **Protein (high → low)**
- **Calories (low → high)**

Implemented via `state.sort`; the filtered list is sorted before mapping to cards in `render()`.

### 7.6 My Pantry configurator (synced)

A dedicated **"My Pantry — what I've ordered / have in stock"** panel (its own collapsible
section in the filter area, separate from the transient ingredient *filter* chips):

- Lists every ingredient from `ING`, grouped by its existing group (Sweeteners, Milks, …).
- Each ingredient is a **tri-state cycling chip**: click cycles **none → ordered → in stock →
  none**, color-coded (neutral / amber `--amber` = ordered / sage `--sage` = in stock),
  reusing the existing chip styling.
- Per-group helpers ("all in stock", "clear") mirroring the existing group toggles, plus a
  **"Quick-fill my usual"** action that marks the `OWNED` preset as *in stock* (this is what
  the current "tick what I have/ordered" button becomes).
- **Auto-saves**: any change writes to the local store immediately and (debounced) syncs to
  Dropbox, stamping `pantry.updated`.

**State separation (resolves the current double-duty of `state.have`):**
- `state.pantry` — the **saved** map of ingredient → `"stock"`/`"ordered"` (persisted/synced).
- `state.have` — the **transient** ingredient *filter* selection for "Uses any / Uses all"
  (NOT persisted), unchanged from today.

**"Can make" now reads the saved pantry:** in "Can make" mode, a recipe shows if every
required ingredient is **in stock** in `state.pantry` (plus `BASICS`). **Ordered** items are
tracked/shown but do **not** count as available (you don't have them yet). New first-time
users start with an empty pantry; `OWNED` is only the seed for "Quick-fill my usual".

## 8. Error handling

- **User cancels / auth error:** non-blocking message, stay in local-only mode.
- **Token expired:** auto-refresh; on refresh failure, disconnect + prompt reconnect, keep local data.
- **Network failure during sync:** keep local edits, retry on next edit/load; never block the UI.
- **Remote file missing/corrupt:** treat as empty remote; merge preserves local.
- **No `localStorage`:** in-memory fallback + one-time warning.

## 9. Code organization (within the single portable file)

Keep `index.html` as one self-contained file; add three clearly-delimited modules plus UI wiring:
- **`Store`** — local read/write of the whole document (feedback **and** pantry), data model,
  pure `merge()`. (Holds what §3 describes.)
- **`Dropbox`** — PKCE auth, token storage/refresh, file download/upload.
- **`Sync`** — orchestration: when to download/merge/upload, debounce, status events.
- **UI additions** — `feedbackHTML(r)` injected into the focus modal, card summary badge in
  `cardHTML`, connection control, feedback filter chips, sort dropdown, and the **My Pantry
  configurator** (tri-state chips); `state.pantry` separated from the transient `state.have`;
  "Can make" rewired to read `state.pantry`. All wired into the existing `state` + `render()`.

## 10. Owner one-time setup (Dropbox console)

1. dropbox.com/developers/apps → **Create app**
2. **Scoped access** → **App folder** → name it (e.g. `FROST Recipe Reviews`)
3. **Settings:** copy **App key** (→ `DROPBOX_APP_KEY`); ignore the App secret
4. **Settings → OAuth 2 → Redirect URIs:** add `https://ried.cl/iskrem/`,
   `https://ried.cl/iskrem` (no-slash safety net), and `http://localhost:8000/`
   (HTTPS required except localhost; must match the request URI exactly)
5. **Permissions:** enable `files.content.read`, `files.content.write` (optional `account_info.read`) → Submit
6. App runs in **Development** status (sufficient for personal/family/friends; "Apply for production"
   later if it grows — confirm the exact current user cap at build time)

## 11. Security considerations

- **App key** is public by design (lives in the page). Fine to commit.
- **App secret** is unused and must never be embedded. (The secret pasted during brainstorming
  should be reset in the console as a precaution.)
- **Refresh token** is stored in each device's `localStorage`. Because the app is scoped to its
  **App folder**, the worst-case blast radius is limited to FROST's own data — acceptable for
  recipe feedback, but noted explicitly.

## 12. Testing / QA

- **Pure unit test** of `merge()` (newest-per-recipe wins; newest-pantry wins; empty-remote;
  empty-local).
- **Manual cross-device checklist:**
  1. Rate a recipe → reload → persists locally.
  2. Mark items ordered/in-stock in My Pantry → reload → persists; "Can make" reflects in-stock.
  3. Connect Dropbox → reload in another browser/device → reviews **and** pantry appear.
  4. Edit the same recipe on two devices → merge keeps the newest per recipe; nothing lost.
  5. Disconnect → local feedback and pantry remain.
  6. Offline edit → syncs on reconnect.
- Optional Playwright smoke test of the rate → reload → persists flow.

## 13. Out of scope (this iteration)

- Aggregated/shared ratings across users (each user's data stays private).
- Other cloud providers (OneDrive/Google Drive) — Dropbox only for now.
- Real-time conflict UI beyond last-write-wins.
- A "Can make once my orders arrive" view (counting `ordered` items toward "Can make") —
  possible later toggle; for now `ordered` does not count as available.
- Per-item pantry merge (current design merges the pantry object as a whole).

## 14. Open items / placeholders

- **Resolved:** production site `https://ried.cl/iskrem/` (GitHub Pages project page on the
  custom apex domain `ried.cl`); redirect URIs registered per §10.
- Confirm exact Dropbox **Development-status user cap** at build time.
