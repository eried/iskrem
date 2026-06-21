# Dropbox setup (one-time, owner only)

Users set up nothing — they just click **"Connect Dropbox"**. This is the single
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

    node serve.cjs 8000
    # or: npx --yes http-server -p 8000 -c-1 .
    # then open http://localhost:8000/

Run unit tests:

    npm test
