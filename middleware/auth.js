// Middleware to require a logged-in user for protected routes.
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect("/login");
}

// Middleware to require a guest user (not logged in) for login/signup pages.
function requireGuest(req, res, next) {
  if (req.session && req.session.userId) return res.redirect("/");
  next();
}

module.exports = { requireAuth, requireGuest };
