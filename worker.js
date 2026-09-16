// PolyTrack 0.5.x legacy API (Kodub-compatible) — Cloudflare Worker + D1
// Endpoints: GET/POST /leaderboard, GET /recordings, POST /verifyRecordings,
//            GET/POST /user — see API.md for the exact client contract.

const VERSIONS = new Set(["0.5.0", "0.5.1", "0.5.2"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function initDb(db) {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS users (
         user_token TEXT PRIMARY KEY,
         token_hash TEXT NOT NULL,
         name TEXT NOT NULL,
         car_colors TEXT NOT NULL,
         is_verifier INTEGER NOT NULL DEFAULT 0
       )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS recordings (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         version TEXT NOT NULL,
         track_id TEXT NOT NULL,
         user_token TEXT NOT NULL,
         token_hash TEXT NOT NULL,
         name TEXT NOT NULL,
         car_colors TEXT NOT NULL,
         frames INTEGER NOT NULL,
         recording TEXT NOT NULL,
         verified_state INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL
       )`
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_rank ON recordings (version, track_id, frames, id)`),
  ]);
}

const validColors = (c) => typeof c === "string" && /^#[0-9a-fA-F]{6}(#[0-9a-fA-F]{6}){3}$/.test(c);
const isHex64 = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

// Best run per user (lowest frames), ranked 0-based.
const bestSql = (where, extra = "") => `
  SELECT r.id, r.token_hash, r.name, r.frames, r.car_colors
  FROM recordings r
  JOIN (
    SELECT token_hash th, MIN(frames) mf, MIN(id) mi
    FROM recordings ${where}
    GROUP BY token_hash
  ) m ON r.token_hash = m.th AND r.frames = m.mf
  ${extra}
  ORDER BY r.frames ASC, r.id ASC`;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const db = env.DB;
    await initDb(db);

    try {
      // ---------- GET /leaderboard ----------
      if (url.pathname === "/leaderboard" && request.method === "GET") {
        const q = url.searchParams;
        const version = q.get("version");
        const trackId = q.get("trackId");
        if (!VERSIONS.has(version) || !trackId) return json({ error: "bad request" }, 400);
        const skip = Math.max(0, parseInt(q.get("skip") || "0", 10) || 0);
        const amount = Math.min(50, Math.max(1, parseInt(q.get("amount") || "10", 10) || 10));
        const onlyVerified = q.get("onlyVerified") === "true";
        const tokenHash = q.get("userTokenHash");

        const where = onlyVerified
          ? `WHERE version = ?1 AND track_id = ?2 AND verified_state = 1`
          : `WHERE version = ?1 AND track_id = ?2`;

        const total = (
          await db
            .prepare(`SELECT COUNT(DISTINCT token_hash) n FROM recordings ${where}`)
            .bind(version, trackId)
            .first()
        ).n;

        const { results } = await db
          .prepare(`${bestSql(where)} LIMIT ?3 OFFSET ?4`)
          .bind(version, trackId, amount, skip)
          .all();

        let userEntry = null;
        if (tokenHash && isHex64(tokenHash)) {
          const row = await db
            .prepare(
              `SELECT pos, frames FROM (
                 SELECT token_hash, frames, (ROW_NUMBER() OVER (ORDER BY frames ASC, id ASC) - 1) pos
                 FROM (${bestSql(where)})
               ) WHERE token_hash = ?3`
            )
            .bind(version, trackId, tokenHash)
            .first();
          if (row) userEntry = { position: row.pos, frames: row.frames, id: null };
        }

        return json({
          total,
          entries: results.map((r) => ({
            id: r.id,
            userId: r.token_hash,
            name: r.name,
            frames: r.frames,
            carColors: r.car_colors,
          })),
          ...(userEntry ? { userEntry } : {}),
        });
      }

      // ---------- POST /leaderboard ----------
      if (url.pathname === "/leaderboard" && request.method === "POST") {
        const f = new URLSearchParams(await request.text());
        const version = f.get("version");
        const userToken = f.get("userToken");
        const name = f.get("name") || "";
        const carColors = f.get("carColors") || "";
        const trackId = f.get("trackId");
        const frames = parseInt(f.get("frames"), 10);
        const recording = f.get("recording") || "";
        if (!VERSIONS.has(version) || !isHex64(userToken) || !trackId ||
            !Number.isSafeInteger(frames) || frames < 0 || frames > 5999999 ||
            name.length < 1 || name.length > 50 || !validColors(carColors) ||
            recording.length === 0 || recording.length >= 10000) {
          return json({ error: "bad request" }, 400);
        }

        const tokenHash = await sha256Hex(userToken);
        const now = Date.now();

        // Previous best (before inserting this run).
        const prevBest = await db
          .prepare(`SELECT MIN(frames) mf FROM recordings WHERE version = ?1 AND track_id = ?2 AND token_hash = ?3`)
          .bind(version, trackId, tokenHash)
          .first();

        const { meta } = await db
          .prepare(
            `INSERT INTO recordings (version, track_id, user_token, token_hash, name, car_colors, frames, recording, verified_state, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)`
          )
          .bind(version, trackId, userToken, tokenHash, name, carColors, frames, recording, now);
        const uploadId = meta.last_row_id;

        const newPosition = (
          await db
            .prepare(
              `SELECT (COUNT(DISTINCT token_hash) - 1) pos FROM recordings
               WHERE version = ?1 AND track_id = ?2
                 AND token_hash IN (
                   SELECT token_hash FROM recordings
                   WHERE version = ?1 AND track_id = ?2
                   GROUP BY token_hash
                   HAVING MIN(frames) < ?3 OR (MIN(frames) = ?3 AND MIN(id) < ?4)
                 )`
            )
            .bind(version, trackId, frames, uploadId)
            .first()
        ).pos;

        const previousPosition = prevBest && prevBest.mf != null
          ? (
              await db
                .prepare(
                  `SELECT (COUNT(DISTINCT token_hash) - 1) pos FROM recordings
                   WHERE version = ?1 AND track_id = ?2
                     AND token_hash IN (
                       SELECT token_hash FROM recordings
                       WHERE version = ?1 AND track_id = ?2
                       GROUP BY token_hash
                       HAVING MIN(frames) < ?3 OR (MIN(frames) = ?3 AND MIN(id) < ?4)
                     )`
                )
                .bind(version, trackId, prevBest.mf, uploadId)
                .first()
            ).pos
          : null;

        return json({ uploadId, previousPosition, newPosition });
      }

      // ---------- GET /recordings ----------
      if (url.pathname === "/recordings" && request.method === "GET") {
        const q = url.searchParams;
        const version = q.get("version");
        const ids = (q.get("recordingIds") || "")
          .split(",")
          .map((s) => parseInt(s, 10))
          .filter(Number.isSafeInteger)
          .slice(0, 50);
        if (!VERSIONS.has(version) || ids.length === 0) return json([]);
        const placeholders = ids.map((_, i) => `?${i + 1}`).join(",");
        const { results } = await db
          .prepare(`SELECT id, recording, verified_state, frames, car_colors FROM recordings WHERE id IN (${placeholders})`)
          .bind(...ids)
          .all();
        const byId = new Map(results.map((r) => [r.id, r]));
        return json(
          ids.map((id) => {
            const r = byId.get(id);
            return r
              ? { recording: r.recording, verifiedState: r.verified_state, frames: r.frames, carColors: r.car_colors }
              : null;
          })
        );
      }

      // ---------- POST /verifyRecordings ----------
      if (url.pathname === "/verifyRecordings" && request.method === "POST") {
        // No verifier queue in this deployment: empty response = "no work available".
        return new Response("", { headers: { ...CORS } });
      }

      // ---------- GET /user ----------
      if (url.pathname === "/user" && request.method === "GET") {
        const userToken = url.searchParams.get("userToken");
        if (!isHex64(userToken)) return json(null);
        const row = await db
          .prepare(`SELECT name, car_colors, is_verifier FROM users WHERE user_token = ?1`)
          .bind(userToken)
          .first();
        return json(row ? { name: row.name, carColors: row.car_colors, isVerifier: !!row.is_verifier } : null);
      }

      // ---------- POST /user ----------
      if (url.pathname === "/user" && request.method === "POST") {
        const f = new URLSearchParams(await request.text());
        const version = f.get("version");
        const userToken = f.get("userToken");
        const name = f.get("name") || "";
        const carColors = f.get("carColors") || "";
        if (!VERSIONS.has(version) || !isHex64(userToken) ||
            name.length < 1 || name.length > 50 || !validColors(carColors)) {
          return new Response("bad request", { status: 400, headers: CORS });
        }
        const tokenHash = await sha256Hex(userToken);
        await db
          .prepare(
            `INSERT INTO users (user_token, token_hash, name, car_colors) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(user_token) DO UPDATE SET name = ?3, car_colors = ?4`
          )
          .bind(userToken, tokenHash, name, carColors);
        return new Response("", { headers: CORS });
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },
};
