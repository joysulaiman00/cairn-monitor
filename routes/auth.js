const express = require("express");
const bcrypt  = require("bcryptjs");
const fs      = require("fs");
const path    = require("path");
const { requireGuest } = require("../middleware/auth");

const router    = express.Router();
const USERS_FILE = path.join(__dirname, "../config/users.json");

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); }
  catch { return []; }
}

// GET /login
router.get("/login", requireGuest, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/login.html"));
});

// POST /login
router.post("/login", requireGuest, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.redirect("/login?error=missing");
  }

  const users = loadUsers();
  const user  = users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (!user) {
    // Constant-time fake compare to prevent user enumeration
    await bcrypt.compare(password, "$2b$12$invalidhashfortimingprotection00000000000000000000000");
    return res.redirect("/login?error=invalid");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.redirect("/login?error=invalid");

  req.session.regenerate((err) => {
    if (err) return res.redirect("/login?error=server");
    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.name     = user.name;
    res.redirect("/");
  });
});

// GET /signup
router.get("/signup", requireGuest, (req, res) => {
  res.sendFile(path.join(__dirname, "../public/signup.html"));
});

// POST /signup
router.post("/signup", requireGuest, async (req, res) => {
  const { name, username, password, confirmPassword } = req.body;

  if (!name || !username || !password || !confirmPassword) {
    return res.redirect("/signup?error=missing");
  }

  if (password !== confirmPassword) {
    return res.redirect("/signup?error=mismatch");
  }

  if (password.length < 8) {
    return res.redirect("/signup?error=short");
  }

  const users = loadUsers();
  if (users.find(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
    return res.redirect("/signup?error=taken");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const newUser = {
    id: Date.now().toString(),
    name: name.trim(),
    username: username.trim(),
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");

  req.session.regenerate((err) => {
    if (err) return res.redirect("/login?error=server");
    req.session.userId   = newUser.id;
    req.session.username = newUser.username;
    req.session.name     = newUser.name;
    res.redirect("/");
  });
});

// POST /logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/login");
  });
});

module.exports = router;
