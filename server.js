require("dotenv").config();

const https       = require("https");
const http        = require("http");
const fs          = require("fs");
const path        = require("path");
const express     = require("express");
const helmet      = require("helmet");
const session     = require("express-session");
const rateLimit   = require("express-rate-limit");
const { WebSocketServer } = require("ws");

const sites      = require("./config/sites");
const authRouter = require("./routes/auth");
const { requireAuth } = require("./middleware/auth");

const PORT     = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const RETENTION_MONTHS = 3;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ─── Express setup ────────────────────────────────────────────────────────────

const app = express();

app.use(express.static(path.join(__dirname, "public"), { index: false }));


app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
}));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Rate limit login attempts: max 10 per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts. Please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/login", loginLimiter);

// Sessions — one shared instance so the WS upgrade uses the same store
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

// Serve only public assets (CSS + client JS) — no auth required
app.use("/style.css", express.static(path.join(__dirname, "public/style.css")));
app.use("/app.js",    express.static(path.join(__dirname, "public/app.js")));

// Auth routes (login/logout/signup)
app.use(authRouter);

// Protect everything below this line
app.use(requireAuth);

// Serve dashboard
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
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
  const byInterval = {};
  for (const site of sites) {
    if (!site.enabled) continue;
    if (!byInterval[site.checkInterval]) byInterval[site.checkInterval] = [];
    byInterval[site.checkInterval].push(site);
  }
  for (const [intervalSecs, group] of Object.entries(byInterval)) {
    for (const site of group) checkSite(site);
    setInterval(() => { for (const site of group) checkSite(site); }, Number(intervalSecs) * 1000);
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