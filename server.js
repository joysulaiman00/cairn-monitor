// Load environment variables from .env into process.env.
require("dotenv").config();

// Node built-in modules for network, filesystem, and path handling.
const https       = require("https");
const http        = require("http");
const fs          = require("fs");
const path        = require("path");

// Server and security dependencies.
const express     = require("express");
const helmet      = require("helmet");
const session     = require("express-session");
const rateLimit   = require("express-rate-limit");
const { WebSocketServer } = require("ws");

// App-specific configuration and middleware.
const authRouter = require("./routes/auth");
const { requireAuth } = require("./middleware/auth");
const SITES_FILE = path.join(__dirname, "config/sites.json");

// App constants.
const PORT     = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const RETENTION_MONTHS = 3;

// Use a fixed user-agent to reduce variability in remote server responses.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ─── Express setup ────────────────────────────────────────────────────────────

const app = express();

// Serve public static files from the public directory.
// `index: false` prevents Express from automatically serving index.html for root.
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// Security headers and Content Security Policy.
app.use(helmet({
  hsts: false,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "https://cdn.jsdelivr.net"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc:     ["'self'", "data:"],
      formAction: ["'self'"],
      baseUri:    ["'self'"],
    },
  },
}));

// Body parsing for form submissions and JSON payloads.
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Rate limit login attempts to reduce brute-force risk.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts. Please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/login", loginLimiter);

// Session middleware. This stores sessions in memory by default.
// For production use, replace with a proper store.
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,   // set to true if you add HTTPS later
    maxAge: 8 * 60 * 60 * 1000,  // 8-hour session
  },
});
app.use(sessionMiddleware);

// Explicitly expose CSS and client JS files with no auth restrictions.
app.use("/style.css", express.static(path.join(__dirname, "public/style.css")));
app.use("/app.js",    express.static(path.join(__dirname, "public/app.js")));

// Mount authentication routes: login, signup, and logout.
app.use(authRouter);

app.get("/api/sites/:id/history", requireAuth, (req, res) => {
  const siteId = req.params.id;
  const since  = req.query.since;
  if (!since) return res.status(400).json({ message: "Missing since query parameter." });

  const points = loadHistoryPoints(siteId, since);
  if (points === null) return res.status(400).json({ message: "Invalid since timestamp." });

  // Allow the client to request a target number of buckets (smaller => more aggregation)
  const targetBuckets = req.query.buckets ? Number(req.query.buckets) : 240;
  const aggregated = aggregateHistoryPoints(points, Number.isFinite(targetBuckets) && targetBuckets > 0 ? targetBuckets : 240);
  res.json({ siteId, points: aggregated.points, aggregated: aggregated.aggregated, bucketMs: aggregated.bucketMs });
});

app.get("/api/sites/:id/history/meta", requireAuth, (req, res) => {
  const siteId = req.params.id;
  const meta = getHistoryMeta(siteId);
  res.json({ siteId, ...meta, ranges: [1, 6, 24] });
});

// All routes below this middleware require an authenticated user.
app.use(requireAuth);

// Dashboard route, served only to authenticated users.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

app.get("/manage-sites", (req, res) => {
  res.sendFile(path.join(__dirname, "pages/manage-sites.html"));
});

app.get('/history', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'pages', 'history.html'));
});

app.get("/api/sites", (req, res) => {
  res.json(sites);
});

app.post("/api/sites", (req, res) => {
  const { name, url, category, checkInterval, expectedStatus, timeout, enabled } = req.body;

  if (!name || !url) {
    return res.status(400).json({ message: "Name and URL are required." });
  }

  const site = {
    id: `site-${Date.now()}`,
    name: name.trim(),
    url: url.trim(),
    category: (category || "other").trim(),
    checkInterval: Number(checkInterval) || 60,
    expectedStatus: Number(expectedStatus) || 200,
    timeout: Number(timeout) || 10000,
    enabled: enabled !== false,
  };

  sites.push(site);
  saveSites(sites);
  scheduleChecks();
  res.status(201).json(site);
});

app.put("/api/sites/:id", (req, res) => {
  const siteId = req.params.id;
  const site = sites.find((item) => item.id === siteId);
  if (!site) {
    return res.status(404).json({ message: "Site not found." });
  }

  const { name, url, category, checkInterval, expectedStatus, timeout, enabled } = req.body;
  if (!name || !url) {
    return res.status(400).json({ message: "Name and URL are required." });
  }

  site.name = name.trim();
  site.url = url.trim();
  site.category = (category || "other").trim();
  site.checkInterval = Number(checkInterval) || 60;
  site.expectedStatus = Number(expectedStatus) || 200;
  site.timeout = Number(timeout) || 10000;
  site.enabled = enabled !== false;

  saveSites(sites);
  scheduleChecks();

  const existing = latestResults[site.id];
  if (existing) {
    Object.assign(existing, {
      name: site.name,
      url: site.url,
      category: site.category,
      expectedStatus: site.expectedStatus,
    });
    broadcast({ type: "update", result: existing });
  }

  res.json(site);
});

app.delete("/api/sites/:id", (req, res) => {
  const siteId = req.params.id;
  const index = sites.findIndex((item) => item.id === siteId);
  if (index === -1) {
    return res.status(404).json({ message: "Site not found." });
  }

  sites.splice(index, 1);
  saveSites(sites);
  delete latestResults[siteId];
  broadcast({ type: "delete", siteId });
  scheduleChecks();

  res.json({ deleted: true });
});

// ─── HTTP + WebSocket server ──────────────────────────────────────────────────

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Upgrade only for authenticated sessions — reuse the same session middleware
httpServer.on("upgrade", (req, socket, head) => {
  const fakeRes = { getHeader: () => {}, setHeader: () => {}, end: () => socket.destroy() };
  sessionMiddleware(req, fakeRes, () => {
    if (!req.session || !req.session.userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "init", sites: latestResults }));
});

// ─── In-memory state ──────────────────────────────────────────────────────────

const latestResults = {};
let sites = loadSites();
let schedulerIntervals = [];

function loadSites() {
  if (!fs.existsSync(SITES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SITES_FILE, "utf8"));
  } catch (err) {
    console.error("Failed to load sites:", err);
    return [];
  }
}

function saveSites(siteList) {
  fs.writeFileSync(SITES_FILE, JSON.stringify(siteList, null, 2), "utf8");
  return siteList;
}

function clearSchedule() {
  for (const id of schedulerIntervals) clearInterval(id);
  schedulerIntervals = [];
}
// ─── Data persistence ─────────────────────────────────────────────────────────

function monthlyFilename() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return path.join(DATA_DIR, `results-${year}-${month}.json`);
}

function readMonthlyFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return []; }
}

function loadHistoryPoints(siteId, since) {
  const cutoff = new Date(since);
  if (Number.isNaN(cutoff.getTime())) return null;

  let files = [];
  try { files = fs.readdirSync(DATA_DIR); } catch { return []; }

  const points = [];
  for (const file of files) {
    if (!/^results-\d{4}-\d{2}\.json$/.test(file)) continue;
    const records = readMonthlyFile(path.join(DATA_DIR, file));
    for (const record of records) {
      if (record.siteId !== siteId) continue;
      const checkedAt = new Date(record.checkedAt);
      if (Number.isNaN(checkedAt.getTime()) || checkedAt < cutoff) continue;
      points.push(record);
    }
  }

  return points.sort((a, b) => new Date(a.checkedAt) - new Date(b.checkedAt));
}

function getHistoryMeta(siteId) {
  let files = [];
  try { files = fs.readdirSync(DATA_DIR); } catch { return { earliest: null, latest: null, totalPoints: 0 }; }

  let earliest = null;
  let latest = null;
  let totalPoints = 0;

  for (const file of files) {
    if (!/^results-\d{4}-\d{2}\.json$/.test(file)) continue;
    const records = readMonthlyFile(path.join(DATA_DIR, file));
    for (const record of records) {
      if (record.siteId !== siteId) continue;
      const checkedAt = new Date(record.checkedAt);
      if (Number.isNaN(checkedAt.getTime())) continue;
      totalPoints += 1;
      if (!earliest || checkedAt < earliest) earliest = checkedAt;
      if (!latest || checkedAt > latest) latest = checkedAt;
    }
  }

  return {
    earliest: earliest ? earliest.toISOString() : null,
    latest: latest ? latest.toISOString() : null,
    totalPoints,
  };
}

function aggregateHistoryPoints(points, maxPoints = 240) {
  if (points.length <= maxPoints) {
    return { points, aggregated: false, bucketMs: null };
  }

  const startTime = new Date(points[0].checkedAt).getTime();
  const endTime = new Date(points[points.length - 1].checkedAt).getTime();
  const bucketMs = Math.max(1, Math.ceil((endTime - startTime) / maxPoints));
  const buckets = [];

  for (const record of points) {
    const timestamp = new Date(record.checkedAt).getTime();
    const bucketIndex = Math.floor((timestamp - startTime) / bucketMs);
    if (!buckets[bucketIndex]) {
      buckets[bucketIndex] = {
        checkedAt: new Date(startTime + bucketIndex * bucketMs).toISOString(),
        count: 0,
        downCount: 0,
        responseTotal: 0,
        responseCount: 0,
        lastRecord: null,
      };
    }

    const bucket = buckets[bucketIndex];
    bucket.count += 1;
    if (!record.ok) bucket.downCount += 1;
    if (record.responseTime != null) {
      bucket.responseTotal += record.responseTime;
      bucket.responseCount += 1;
    }
    bucket.lastRecord = record;
  }

  const aggregated = buckets.map((bucket) => {
    const last = bucket.lastRecord || {};
    return {
      checkedAt: bucket.checkedAt,
      ok: bucket.downCount === 0,
      count: bucket.count,
      downCount: bucket.downCount,
      responseTime: bucket.responseCount ? Math.round(bucket.responseTotal / bucket.responseCount) : null,
      status: bucket.downCount === 0 ? last.status ?? null : last.status ?? null,
      error: bucket.downCount > 0 ? last.error : undefined,
    };
  });

  return { points: aggregated, aggregated: true, bucketMs };
}

function appendResult(record) {
  const filePath = monthlyFilename();
  const records  = readMonthlyFile(filePath);
  records.push(record);
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf8");
}

// ─── Retention cleanup ────────────────────────────────────────────────────────

function pruneOldFiles() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  let files;
  try { files = fs.readdirSync(DATA_DIR); } catch { return; }
  for (const file of files) {
    const match = file.match(/^results-(\d{4})-(\d{2})\.json$/);
    if (!match) continue;
    const fileDate = new Date(`${match[1]}-${match[2]}-01`);
    if (fileDate < cutoff) {
      fs.unlinkSync(path.join(DATA_DIR, file));
      console.log(`[cleanup] Deleted: ${file}`);
    }
  }
}

// ─── Ping engine ──────────────────────────────────────────────────────────────

function checkSite(site) {
  return new Promise((resolve) => {
    const startTime  = Date.now();
    const parsedUrl  = new URL(site.url);
    const driver     = parsedUrl.protocol === "https:" ? https : http;

    const req = driver.get(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname || "/",
        headers: { "User-Agent": USER_AGENT },
        timeout: site.timeout,
      },
      (res) => {
        const responseTime = Date.now() - startTime;
        res.resume();

        const record = {
          siteId: site.id, name: site.name, url: site.url,
          category: site.category, checkedAt: new Date().toISOString(),
          status: res.statusCode, expectedStatus: site.expectedStatus,
          ok: res.statusCode === site.expectedStatus, responseTime,
        };

        latestResults[site.id] = record;
        appendResult(record);
        broadcast({ type: "update", result: record });
        console.log(`[${record.checkedAt}] ${site.name} → ${res.statusCode} (${responseTime}ms) ${record.ok ? "✓" : "✗"}`);
        resolve(record);
      }
    );

    req.on("timeout", () => {
      req.destroy();
      const record = {
        siteId: site.id, name: site.name, url: site.url,
        category: site.category, checkedAt: new Date().toISOString(),
        status: null, expectedStatus: site.expectedStatus,
        ok: false, responseTime: site.timeout, error: "timeout",
      };
      latestResults[site.id] = record;
      appendResult(record);
      broadcast({ type: "update", result: record });
      console.log(`[${record.checkedAt}] ${site.name} → TIMEOUT`);
      resolve(record);
    });

    req.on("error", (err) => {
      const record = {
        siteId: site.id, name: site.name, url: site.url,
        category: site.category, checkedAt: new Date().toISOString(),
        status: null, expectedStatus: site.expectedStatus,
        ok: false, responseTime: Date.now() - startTime, error: err.message,
      };
      latestResults[site.id] = record;
      appendResult(record);
      broadcast({ type: "update", result: record });
      console.log(`[${record.checkedAt}] ${site.name} → ERROR: ${err.message}`);
      resolve(record);
    });
  });
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

function scheduleChecks() {
  clearSchedule();
  const byInterval = {};
  for (const site of sites) {
    if (!site.enabled) continue;
    if (!byInterval[site.checkInterval]) byInterval[site.checkInterval] = [];
    byInterval[site.checkInterval].push(site);
  }
  for (const [intervalSecs, group] of Object.entries(byInterval)) {
    for (const site of group) checkSite(site);
    const intervalId = setInterval(() => { for (const site of group) checkSite(site); }, Number(intervalSecs) * 1000);
    schedulerIntervals.push(intervalId);
    console.log(`[scheduler] Polling every ${intervalSecs}s: ${group.map(s => s.name).join(", ")}`);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

pruneOldFiles();
setInterval(pruneOldFiles, 24 * 60 * 60 * 1000);
scheduleChecks();

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`\nCairn Monitor running → http://localhost:${PORT}`);
  console.log(`Network access        → http://<your-ip>:${PORT}\n`);
});