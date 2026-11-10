const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const UsersDatabase = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = process.env.JWT_TTL || "12h";

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("Error: JWT_SECRET must be set to a random string of at least 32 characters.");
  process.exit(1);
}

// Admins are configured server-side only; nothing a client sends can grant admin.
const adminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const isAdminEmail = (email) =>
  !!email && adminEmails().includes(String(email).toLowerCase());

const signToken = (user, role = "user") =>
  jwt.sign(
    { sub: String(user._id), role, tv: user.tokenVersion || 0 },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );

// Verifies the bearer token and loads the user. Rejects disabled accounts and
// tokens issued before the last password reset (tokenVersion bump).
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, message: "Authentication required" });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }

    const user = await UsersDatabase.findById(payload.sub);
    if (!user || (user.tokenVersion || 0) !== payload.tv) {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }
    if (user.isDisabled || user.condition === "disabled") {
      return res.status(403).json({ success: false, message: "Account disabled" });
    }

    req.user = user;
    // Admin status is re-checked against env on every request so removal takes effect immediately.
    req.isAdmin = payload.role === "admin" && isAdminEmail(user.email);
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.isAdmin) return res.status(403).json({ success: false, message: "Admin only" });
    next();
  });
}

// The authenticated user may only act on their own record (by URL param or body field); admins may act on any.
const requireSelfOrAdmin = (getId) => (req, res, next) => {
  requireAuth(req, res, () => {
    if (req.isAdmin) return next();
    const target = getId(req);
    if (!target || String(target) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
  });
};

const selfParam = (name = "_id") => requireSelfOrAdmin((req) => req.params[name]);

const requireSelfEmailOrAdmin = (param = "email") => (req, res, next) => {
  requireAuth(req, res, () => {
    if (req.isAdmin) return next();
    if (String(req.params[param]).toLowerCase() !== String(req.user.email).toLowerCase()) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
  });
};

// Blocks NoSQL operator injection such as {"email": {"$ne": null}}.
function sanitize(obj) {
  if (!obj || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    if (key.startsWith("$") || key.includes(".")) {
      delete obj[key];
    } else {
      sanitize(obj[key]);
    }
  }
}
function mongoSanitize(req, res, next) {
  sanitize(req.body);
  sanitize(req.params);
  sanitize(req.query);
  next();
}

// Returns a finite positive number, or null.
function positiveAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const limitHandler = (message) => (req, res) =>
  res.status(429).json({ success: false, message });

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: limitHandler("Too many requests, please try again later."),
});

// Login, password reset and OTP emails: brute-force and email-spam protection.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: limitHandler("Too many attempts, please try again in 15 minutes."),
});

// Forgot/reset password has its own counter so failed logins don't lock people out of resetting.
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: limitHandler("Too many attempts, please try again in 15 minutes."),
});

// Case-insensitive, whitespace-tolerant exact email match (input is escaped, so no regex injection).
function emailQuery(email) {
  const clean = String(email || "").trim();
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { email: { $regex: `^${escaped}$`, $options: "i" } };
}

// Money-moving requests, keyed per authenticated user (falls back to IP).
const moneyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `u:${req.user._id}` : `ip:${req.ip}`),
  handler: limitHandler("Too many transaction requests, please try again later."),
});

module.exports = {
  signToken,
  isAdminEmail,
  requireAuth,
  requireAdmin,
  requireSelfOrAdmin,
  selfParam,
  requireSelfEmailOrAdmin,
  mongoSanitize,
  positiveAmount,
  globalLimiter,
  authLimiter,
  resetLimiter,
  emailQuery,
  moneyLimiter,
};
