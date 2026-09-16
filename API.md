# PolyTrack leaderboard backend

The game calls a Kodub-compatible API for leaderboards. The original backend used by this
bundle (`snowy-mountain-8e34.htmlunblockedgames.workers.dev`) is offline, so this repo ships
a drop-in replacement: a Cloudflare Worker (`worker.js`) backed by Cloudflare D1 (SQLite).

## Deploy (no build tools needed — all in the Cloudflare dashboard)

1. **Create the database**
   - Cloudflare dashboard → **Workers & Pages → D1 → Create database** → name it `polytrack`.
   - Copy the **Database ID**.

2. **Create the Worker**
   - **Workers & Pages → Create → Worker** → name it `polytrack-api` → Deploy → Edit code.
   - Paste the full contents of `worker.js` and Deploy.

3. **Bind the database**
   - Worker → **Settings → Bindings → Add → D1 database**.
   - Variable name: `DB`, database: `polytrack`.

4. **Connect the game**
   - Open `index.html` in this repo and replace the placeholder in:
     ```html
     <script>window.PT_API_URL="https://polytrack-api.YOUR-SUBDOMAIN.workers.dev/"</script>
     ```
     with your Worker URL (keep the trailing `/`). The game reads `window.PT_API_URL` from
     `main.bundle.js`; if it's empty it falls back to the old (dead) URL.

5. Commit/push — GitHub Pages deploys automatically.

## Endpoints implemented

- `GET /leaderboard?version&trackId&skip&amount[&onlyVerified][&userTokenHash]`
- `POST /leaderboard` (submits a run: `version,userToken,name,carColors,trackId,frames,recording`)
- `GET /recordings?version&recordingIds=1,2,3` (ghost replays)
- `POST /verifyRecordings` (stub — returns "no work available")
- `GET /user?version&userToken`, `POST /user` (profile name + car colors)

All request/response shapes match the original Kodub API used by the 0.5.x client, so the
untouched game binary works as-is. Ranks are lowest frame count first (60 Hz physics frames).
