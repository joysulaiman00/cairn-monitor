function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect("/login");
}

function requireGuest(req, res, next) {
  if (req.session && req.session.userId) return res.redirect("/");
  next();
}

module.exports = { requireAuth, requireGuest };
