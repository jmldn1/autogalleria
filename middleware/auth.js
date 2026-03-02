function isAdmin(req, res, next) {
  // Simple placeholder check
  if (req.session && req.session.isAdmin) {
    req.user = req.session.user;
    return next();
  } else {
    return res.redirect('/login'); // or send 403
  }
}

module.exports = { isAdmin };
