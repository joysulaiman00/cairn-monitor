# Cairn Monitor — Annotated Source Guide

This document explains every file in the repository with grouped notes and change guidance.

## Project overview

`cairn-monitor` is a small Express-based internal monitoring dashboard for Cairn University websites. It:
- serves login/signup pages
- protects the dashboard behind session auth
- polls configured sites over HTTP/HTTPS
- stores monthly result files in `data/`
- uses WebSockets to push live updates to the browser

---

## package.json

Purpose:
- Defines project metadata, dependencies, and runtime commands.

Key sections:
- `name`, `version`, `description`, `main`: package identity.
- `scripts.start`: starts the app with `node server.js`.
- `scripts.add-user`: runs the CLI user manager in `scripts/add-user.js`.
- `dependencies`: required packages:
  - `bcryptjs`: password hashing
  - `dotenv`: loads `.env` config
  - `express`: web server framework
  - `express-rate-limit`: login brute-force protection
  - `express-session`: session cookies
  - `helmet`: HTTP security headers
  - `ws`: WebSocket server

Change notes:
- Add new npm scripts under `scripts`.
- Add dependencies for new server or client features.

---

## .env.example

Purpose:
- Shows required environment variables without exposing secrets.

Variables:
- `SESSION_SECRET`: session cookie signing secret. Must be a long random string.
- `PORT`: port the server listens on.
- `INVITE_CODE`: not currently used in server code; likely intended for signup gating.

Change notes:
- Copy to `.env` and set values before starting.
- If you use HTTPS later, keep `SESSION_SECRET` unchanged across restarts.

---

## .gitignore

Purpose:
- Prevents private and generated data from being committed.

Ignored items:
- `node_modules/`: installed packages
- `.env`: secrets
- `config/users.json`: stored user accounts
- `data/`: persisted ping results
- `sessions/`: session store files if present

Change notes:
- Add any local-only or generated files here.

---

## .vscode/settings.json

Purpose:
- local VS Code settings for this workspace.

Content:
- `liveServer.settings.port`: sets Live Server to port `5501`.

Change notes:
- Use only for local editor behavior; not part of app runtime.

---

## server.js

This is the main app server. It configures Express, session handling, WebSocket upgrades, polling, result persistence, and cleanup.

### Top-level imports and constants

`require("dotenv").config();`
- Loads `.env` variables into `process.env`.

Imported modules:
- `https`, `http`, `fs`, `path`: Node built-ins
- `express`, `helmet`, `session`, `rateLimit`, `WebSocketServer`
- `sites`: list of monitored sites from `config/sites.js`
- `authRouter`: login/signup route definitions
- `requireAuth`: middleware that protects private routes

Constants:
- `PORT`: server port, default `3000`
- `DATA_DIR`: path to `data/`
- `RETENTION_MONTHS`: how long old monthly data files are kept
- `USER_AGENT`: custom user agent used by HTTP checks

Change notes:
- Add new site definitions to `config/sites.js`.
- Change retention by editing `RETENTION_MONTHS`.
- Change the default port via `.env` or code.

### Express setup

`app.use(express.static(...))`
- Serves `public/` static assets.
- `index: false` prevents auto-serving `index.html` for unknown root behavior.

`app.use(helmet(...))`
- Enables security headers and a restrictive CSP.
- Only allows scripts and styles from the same origin and `ws:/wss:` connections.

`app.use(express.urlencoded(...))` and `app.use(express.json())`
- Parse form and JSON request bodies.

Login rate limiter:
- Limits POST requests to `/login` to 10 per 15 minutes per IP.
- Prevents brute-force attempts.

Session middleware:
- Uses `express-session` with `SESSION_SECRET`.
- `resave: false`, `saveUninitialized: false` for sensible session behavior.
- Cookie options:
  - `httpOnly`: prevents client JavaScript from reading cookie
  - `sameSite: "lax"`
  - `secure: false`: HTTP only; enable `true` if HTTPS is added
  - `maxAge`: 8 hours

Change notes:
- If deploying production over HTTPS, set `cookie.secure = true`.
- For persistent sessions or clustering, replace in-memory session store.

### Static route overrides

`app.use("/style.css", ...)` and `app.use("/app.js", ...)`
- Explicitly serves CSS and client JS files.
- This is redundant with the static asset handler but ensures these assets are always available.

### Auth routes and protection

`app.use(authRouter);`
- Mounts the login/signup/logout routes before auth protection.

`app.use(requireAuth);`
- Protects all routes after this line.
- All dashboard routes require a valid session.

`app.get("/", ...)`
- Serves `public/index.html` to authenticated users.

Change notes:
- Add more protected routes after the `requireAuth` line.
- Public pages should be mounted before `requireAuth`.

### HTTP + WebSocket server

`const httpServer = http.createServer(app);`
- Wraps Express in a native HTTP server for WebSocket upgrades.

`const wss = new WebSocketServer({ noServer: true });`
- WebSocket server does not listen on its own port.

`httpServer.on("upgrade", ...)`
- Intercepts WebSocket upgrade requests.
- Reuses the same session middleware to authenticate the WebSocket session.
- If session is missing or not authenticated, rejects the upgrade.

`broadcast(data)`
- Sends JSON to all connected WebSocket clients.
- Only sends to clients whose `readyState === 1` (open).

`wss.on("connection", ...)`
- Immediately sends an `init` message with the current `latestResults` to new clients.

Change notes:
- If you add more client message types, handle them here.
- If you want anonymous dashboard viewing, remove auth check from the upgrade path.

### In-memory state

`latestResults = {}`
- Stores the latest check result for each site in memory.
- Used to initialize new clients and broadcast updates.

Change notes:
- This is ephemeral. If server restarts, initial results are empty until the next poll.
- To preserve startup history, load previous results from disk here.

### Persistence: monthly files

`monthlyFilename()`
- Returns a path like `data/results-YYYY-MM.json`.
- Uses current year/month.

`readMonthlyFile(filePath)`
- Safely reads a file and parses JSON.
- Returns `[]` on missing or invalid content.

`appendResult(record)`
- Reads the current month file, appends one record, and writes it back.
- Records are stored as JSON arrays.

Change notes:
- If you want more robust persistence, replace this with a database.
- To store richer events, add more fields to the record structure.

### Retention cleanup

`pruneOldFiles()`
- Deletes monthly result files older than `RETENTION_MONTHS`.
- Uses `YYYY-MM` file names to determine age.
- Runs at startup and every 24 hours.

Change notes:
- Change retention by editing `RETENTION_MONTHS`.
- If you need daily files, adjust the file naming and cleanup logic.

### Ping engine

`checkSite(site)`
- Returns a Promise and checks one site.
- Uses `site.url` to determine `http` vs `https`.
- Sends a request with a custom `User-Agent` and site-specific timeout.
- On response:
  - records `status`, `responseTime`, and whether the status matches `expectedStatus`
  - updates `latestResults`
  - appends the record to disk
  - broadcasts the update
  - logs the result
- Handles `timeout` and `error` by recording failure details.

Change notes:
- Add support for headers, request methods, or body checks if needed.
- If you want to monitor JSON APIs, add response body validation.

### Scheduler

`scheduleChecks()`
- Groups enabled sites by `checkInterval`.
- Runs an initial check immediately for each interval group.
- Sets up `setInterval` for repeated checks.
- Logs which sites poll at what frequency.

Change notes:
- To add new intervals, set `checkInterval` on site objects in `config/sites.js`.
- Disabled sites are skipped automatically.

### Boot sequence

At startup:
- Creates `data/` if missing.
- Prunes old files.
- Schedules daily retention cleanup.
- Starts polling.
- Starts listening on `PORT`.

Change notes:
- If you add HTTPS later, modify server creation and listen logic.

---

## config/sites.js

Purpose:
- Lists monitored site definitions.
- Each object configures a single endpoint.

Fields:
- `id`: unique identifier used by the client and server
- `name`: display name
- `url`: full URL to check
- `category`: category label shown in UI
- `checkInterval`: how often to poll this site, in seconds
- `expectedStatus`: HTTP status code considered healthy
- `timeout`: request timeout in milliseconds
- `enabled`: whether this check is active

Change notes:
- Add or remove sites by editing this array.
- To pause a site without deleting it, set `enabled: false`.
- Use unique `id` values.

---

## config/users.json

Purpose:
- Stores registered users.
- Used by the auth routes.

Fields per user:
- `id`: unique string identifier
- `name`: full name
- `username`: login username
- `passwordHash`: bcrypt hash of the password
- `createdAt`: ISO timestamp

Change notes:
- This file is intentionally ignored by Git.
- Use `scripts/add-user.js` or signup form to modify it.

---

## middleware/auth.js

Purpose:
- Defines route guards for auth.

Functions:
- `requireAuth(req, res, next)`: if a session exists, continue. Otherwise redirect to `/login`.
- `requireGuest(req, res, next)`: if authenticated, redirect to `/`. Otherwise continue.

Change notes:
- Use `requireGuest` on public pages like login/signup.
- Use `requireAuth` on any protected route.

---

## routes/auth.js

Purpose:
- Handles login, signup, and logout.
- Uses file-based user storage in `config/users.json`.

Helpers:
- `loadUsers()`: reads the user file and returns an array.

Routes:
- `GET /login`: serves `public/login.html`.
- `POST /login`: validates credentials.
  - rejects missing fields, invalid users, or wrong passwords.
  - uses a fake bcrypt compare for invalid usernames to avoid timing leaks.
  - regenerates session and stores `userId`, `username`, and `name`.
- `GET /signup`: serves `public/signup.html`.
- `POST /signup`: creates a new account.
  - checks all fields, password confirmation, password length, and existing username.
  - hashes the password using bcrypt.
  - writes the new user to disk.
  - creates a session after signup.
- `POST /logout`: destroys the session and clears the cookie.

Change notes:
- To require an invite code, add server-side validation in `POST /signup`.
- To support email login, extend the form and add validation.
- To use a database, replace `loadUsers`/`fs.writeFileSync` with DB calls.

---

## scripts/add-user.js

Purpose:
- CLI utility to add, remove, or list users.
- Works directly on `config/users.json`.

Behavior:
- Prompts for action: `(a)dd`, `(r)emove`, or `(l)ist`.
- Listing prints current usernames.
- Removing deletes a user by username.
- Adding prompts for full name, username, and password.
- Validates required fields, unique username, and minimum password length.
- Hashes passwords with bcrypt and saves to disk.

Change notes:
- Useful for admin user maintenance without using the browser.
- Extend this script to support password resets or import/export.

---

## public/app.js

Purpose:
- Browser-side dashboard logic.
- Connects to the server via WebSocket and renders live status cards and a table.

DOM elements:
- `cardsGrid`, `resultsBody`: main result containers.
- summary stats: `statTotal`, `statUp`, `statDown`, `statAvg`, `statUpdated`.
- `footerClock`: live clock text.

Features:
- `updateClock()`: updates the footer clock every second.
- `fmt(result)`: normalizes a result object for display.
- `updateSummary(results)`: computes totals, online/offline counts, average response.
- `buildCard(result)` / `updateCard(result)`: create or refresh dashboard cards.
- `buildRow(result)` / `updateRow(result)`: create or refresh table rows.

WebSocket flow:
- `connect()` uses `ws://` or `wss://` based on page protocol.
- On `init`, it populates the UI with current results.
- On `update`, it updates a single site’s card/row and summary.
- On close, reconnects after 3 seconds.

Change notes:
- Add sorting, filtering, or historical charting by extending the DOM update logic.
- If you add new fields to results, update `fmt`, `buildCard`, and `buildRow`.
- To change the reconnect interval, edit `setTimeout(connect, 3000)`.

---

## public/index.html

Purpose:
- Authenticated dashboard page.
- Includes summary cards, status cards container, detail table, and logout button.

Important parts:
- Header with brand and logout form `POST /logout`.
- Summary bar with IDs used by `app.js`.
- `cards-grid` and `results-body` placeholders for injected content.
- Footer clock with `footer-clock` ID.
- Loads `app.js` at the bottom.

Change notes:
- Add new dashboard sections by adding HTML and updating `app.js`.
- The logout button sends a POST request to log out.

---

## public/login.html

Purpose:
- Login form for existing users.
- Displays error messages from query params.

Important parts:
- Form posts to `/login` with `username` and `password`.
- Error script reads `?error=` and shows messages.
- Link to `/signup` for new account creation.

Change notes:
- If you add more error types, update the script.
- Replace the logo path or branding text here.

---

## public/signup.html

Purpose:
- Signup page for new users.
- Displays validation errors using the query string.

Important parts:
- Form posts to `/signup` with `name`, `username`, `password`, and `confirmPassword`.
- Error messages are shown for missing fields, mismatch, short password, taken username, or server errors.
- Link back to `/login` if the user already has an account.

Change notes:
- If you want to require an invite code, add a field and validation in this form and server route.
- Style or text changes happen in the HTML and `style.css`.

---

## public/style.css

Purpose:
- Styles the dashboard and auth pages.
- Defines the app’s visual theme, layout, and responsive behavior.

Major sections:
- Reset and base styles (`*`, `:root`, `html, body`).
- Header styling and live badge animation.
- Main layout and summary cards.
- Status card styles for `.site-card`, `.status-badge`, and `.up` / `.down` variants.
- Table styling for details view.
- Footer and connecting state styling.
- Login/signup form styling.
- Logout button styling.

Change notes:
- To change branding colors, update `:root` variables.
- To add a new page or component, add HTML class names and corresponding CSS.
- The login form uses a centered `body.login-page` layout.

---

## data/

Purpose:
- Stores check results in monthly JSON files.
- Data files are generated by `server.js` and rotated by retention logic.

Note:
- `data/results-2026-06.json` is example output and is ignored by Git.
- The app does not read previous months into memory on startup.

Change notes:
- If you need historical reporting, load past files in `server.js`.
- To export or analyze data, parse these JSON files.

---

## How to change common behaviors

Authentication:
- `config/users.json` + `routes/auth.js` control login/signup.
- `middleware/auth.js` protects the dashboard.
- Use `scripts/add-user.js` to manage users from the terminal.

Monitoring targets:
- Add site objects in `config/sites.js`.
- Use `expectedStatus` to choose which status code counts as healthy.
- Use `checkInterval` to set frequency in seconds.
- Toggle `enabled` to disable a site without deleting it.

UI changes:
- `public/app.js` renders all live data.
- `public/index.html` defines the dashboard structure.
- `public/style.css` controls colors, layout, fonts, and responsive behavior.

Deployment changes:
- Set `PORT` and `SESSION_SECRET` in `.env`.
- Switch `cookie.secure` to `true` if you add HTTPS.
- For production, replace the in-memory session store and file-based user storage with a database.

---

## Recommended next steps

1. Add a real database or persistent session store for production.
2. Harden signup logic if you want invite-only access.
3. Load last known state after restart so the dashboard isn’t empty until the first poll.
4. Add historical charts or logs from the monthly `data/` files.

If you want, I can also annotate the code inline with comments inside each file instead of a separate guide.