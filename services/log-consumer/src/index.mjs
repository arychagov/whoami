import crypto from "node:crypto";
import { spawn } from "node:child_process";
import readline from "node:readline";

import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const ACCESS_LOG_PATH = process.env.ACCESS_LOG_PATH || "/logs/whoami.access.log";
const FLUSH_INTERVAL_MS = Number(process.env.FLUSH_INTERVAL_MS || "2000");
const MAX_BATCH_SIZE = Number(process.env.MAX_BATCH_SIZE || "1000");
const UNIQUE_TTL_DAYS = Number(process.env.UNIQUE_TTL_DAYS || "90");
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || "3600000");

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 2,
});

function pickClientIp(entry) {
  const xff = (entry?.x_forwarded_for || "").toString().trim();
  if (xff) return xff.split(",")[0].trim();
  return (entry?.remote_addr || "").toString().trim();
}

function visitorHash({ ip, ua }) {
  const h = crypto.createHash("sha256");
  h.update(`${ip}\n${ua}`);
  return h.digest("hex");
}

// Keep a set of unique (url, visitor_hash) within current batch to reduce DB load.
// Key format: `${url}\n${visitorHash}`
const pending = new Map(); // key -> seen_at (Date)

let flushInFlight = false;

async function flush() {
  if (flushInFlight) return;
  if (pending.size === 0) return;

  flushInFlight = true;

  // Snapshot & clear quickly (keep tailer non-blocking)
  const items = [];
  for (const [key, seenAt] of pending.entries()) {
    items.push({ key, seenAt });
    if (items.length >= MAX_BATCH_SIZE) break;
  }
  for (const it of items) pending.delete(it.key);

  const tuples = items.map(({ key, seenAt }) => {
    const [url, vhash] = key.split("\n");
    return { url, vhash, seenAt };
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Build VALUES list
    // incoming(url, visitor_hash, seen_at)
    const values = [];
    const params = [];
    let p = 1;
    for (const t of tuples) {
      values.push(`($${p++}, $${p++}, $${p++})`);
      params.push(t.url, t.vhash, t.seenAt.toISOString());
    }

    const incomingCte = `WITH incoming(url, visitor_hash, seen_at) AS (VALUES ${values.join(
      ","
    )})`;

    // 1) Insert new uniques (do not update on conflict, we count only inserted here)
    const inserted = await client.query(
      `${incomingCte}
       INSERT INTO url_unique_visitors(url, visitor_hash, first_seen, last_seen)
       SELECT url, visitor_hash, seen_at, seen_at FROM incoming
       ON CONFLICT (url, visitor_hash) DO NOTHING
       RETURNING url`,
      params
    );

    // 2) Update last_seen for all pairs (cheap, avoids losing recency)
    await client.query(
      `${incomingCte}
       UPDATE url_unique_visitors v
       SET last_seen = GREATEST(v.last_seen, i.seen_at)
       FROM incoming i
       WHERE v.url = i.url AND v.visitor_hash = i.visitor_hash`,
      params
    );

    // 3) Increment counters only for newly inserted uniques
    if (inserted.rowCount > 0) {
      const inc = new Map(); // url -> count
      for (const r of inserted.rows) inc.set(r.url, (inc.get(r.url) || 0) + 1);

      const counterValues = [];
      const counterParams = [];
      let c = 1;
      const nowIso = new Date().toISOString();
      for (const [url, count] of inc.entries()) {
        counterValues.push(`($${c++}, $${c++}, $${c++})`);
        counterParams.push(url, count, nowIso);
      }

      await client.query(
        `INSERT INTO url_unique_visit_counters(url, unique_visits, last_visit)
         VALUES ${counterValues.join(",")}
         ON CONFLICT (url) DO UPDATE
         SET unique_visits = url_unique_visit_counters.unique_visits + EXCLUDED.unique_visits,
             last_visit = GREATEST(url_unique_visit_counters.last_visit, EXCLUDED.last_visit)`,
        counterParams
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    // Put items back so we don't lose them
    for (const t of tuples) pending.set(`${t.url}\n${t.vhash}`, t.seenAt);
    console.error("[log-consumer] flush failed:", e);
  } finally {
    client.release();
    flushInFlight = false;
  }
}

let cleanupInFlight = false;
async function cleanupOldVisitors() {
  if (cleanupInFlight) return;
  if (!Number.isFinite(UNIQUE_TTL_DAYS) || UNIQUE_TTL_DAYS <= 0) return;

  cleanupInFlight = true;
  const client = await pool.connect();
  try {
    // Keep visitor hashes only for a bounded window to cap DB growth.
    // This makes "unique" effectively mean "unique within TTL window".
    await client.query(
      `DELETE FROM url_unique_visitors
       WHERE last_seen < (now() - ($1::text || ' days')::interval)`,
      [String(Math.floor(UNIQUE_TTL_DAYS))]
    );
  } catch (e) {
    console.error("[log-consumer] cleanup failed:", e);
  } finally {
    client.release();
    cleanupInFlight = false;
  }
}

function enqueue(entry) {
  const url = (entry?.uri || entry?.request_uri || "").toString();
  if (!url) return;

  const ip = pickClientIp(entry);
  const ua = (entry?.user_agent || "").toString();
  if (!ip) return;

  const vhash = visitorHash({ ip, ua });
  const seenAt = entry?.ts ? new Date(entry.ts) : new Date();

  pending.set(`${url}\n${vhash}`, seenAt);

  if (pending.size >= MAX_BATCH_SIZE) {
    // Fire-and-forget; flush() is internally single-flight
    void flush();
  }
}

// Tail the access log (busybox tail supports -F)
const tail = spawn("tail", ["-n", "0", "-F", ACCESS_LOG_PATH], {
  stdio: ["ignore", "pipe", "pipe"],
});

tail.stderr.on("data", (d) => {
  console.error("[log-consumer][tail]", d.toString().trim());
});

tail.on("exit", (code) => {
  console.error("[log-consumer] tail exited with code", code);
  process.exit(code ?? 1);
});

const rl = readline.createInterface({ input: tail.stdout });

rl.on("line", (line) => {
  const s = line.trim();
  if (!s) return;

  try {
    const entry = JSON.parse(s);
    enqueue(entry);
  } catch {
    // Ignore malformed lines
  }
});

setInterval(() => {
  void flush();
}, FLUSH_INTERVAL_MS).unref();

setInterval(() => {
  void cleanupOldVisitors();
}, CLEANUP_INTERVAL_MS).unref();

process.on("SIGTERM", async () => {
  try {
    await flush();
  } finally {
    await pool.end();
    process.exit(0);
  }
});

