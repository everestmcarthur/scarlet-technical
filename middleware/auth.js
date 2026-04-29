/**
 * Authentication middleware for admin and customer portal routes.
 */

function requireAdmin(req, res, next) {
  if (!req.session?.adminId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

function requireCustomer(req, res, next) {
  if (!req.session?.customerId) {
    // For page requests, redirect to login
    if (req.accepts('html') && !req.path.startsWith('/portal/api/')) {
      return res.redirect('/portal/login');
    }
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

module.exports = { requireAdmin, requireCustomer };
