var express = require("express");
const crypto = require("crypto");
const UsersDatabase = require("../../models/User");
const { hashPassword, resetEmail } = require("../../utils");
const { authLimiter, requireAuth } = require("../../middleware/security");
var router = express.Router();

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const hashOtp = (otp) => crypto.createHash("sha256").update(String(otp)).digest("hex");

// Generates a single-use reset code, stores only its hash, and emails it to the account's address.
async function issueResetOtp(user) {
  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await user.updateOne({
    resetOtpHash: hashOtp(otp),
    resetOtpExpires: new Date(Date.now() + OTP_TTL_MS),
    resetOtpAttempts: 0,
  });
  await resetEmail({ to: user.email, otp });
}

async function verifyResetOtp(user, otp) {
  if (!user.resetOtpHash || !user.resetOtpExpires || user.resetOtpExpires < new Date()) return false;
  if ((user.resetOtpAttempts || 0) >= MAX_OTP_ATTEMPTS) return false;

  const ok = crypto.timingSafeEqual(Buffer.from(hashOtp(otp)), Buffer.from(user.resetOtpHash));
  if (!ok) {
    await user.updateOne({ $inc: { resetOtpAttempts: 1 } });
    return false;
  }
  return true;
}

async function setNewPassword(user, password) {
  // Clearing the OTP and bumping tokenVersion logs out every existing session (including an attacker's).
  await user.updateOne({
    $set: { password: hashPassword(password), resetOtpAttempts: 0 },
    $unset: { resetOtpHash: 1, resetOtpExpires: 1 },
    $inc: { tokenVersion: 1 },
  });
}

const validPassword = (p) => typeof p === "string" && p.length >= 6 && p.length <= 100;

// Request a reset code. Same response whether or not the email exists (no enumeration).
router.put("/forgot-password", authLimiter, async function (req, res) {
  const user = await UsersDatabase.findOne({ email: String(req.body.email || "") });
  if (user) {
    try {
      await issueResetOtp(user);
    } catch (e) {
      console.error("Failed to send reset OTP:", e);
    }
  }
  res.status(200).json({ message: "If that account exists, a reset code has been sent." });
});

// Reset with emailed code: { email, otp, password }
router.put("/reset-password", authLimiter, async function (req, res) {
  const { otp, password } = req.body;
  if (!validPassword(password)) return res.status(400).json({ message: "Password must be 6-100 characters" });

  const user = await UsersDatabase.findOne({ email: String(req.body.email || "") });
  if (!user || !otp || !(await verifyResetOtp(user, otp))) {
    return res.status(400).json({ message: "Invalid or expired code" });
  }

  await setNewPassword(user, password);
  return res.status(200).json({ message: "update was successful" });
});

// Reset by user id: requires a valid emailed code, OR being logged in as that user (or admin).
router.put("/:_id/reset-password", authLimiter, async function (req, res, next) {
  const { otp, password } = req.body;
  if (!validPassword(password)) return res.status(400).json({ message: "Password must be 6-100 characters" });

  const user = await UsersDatabase.findById(req.params._id).catch(() => null);
  if (!user) return res.status(400).json({ message: "Invalid or expired code" });

  if (otp) {
    if (!(await verifyResetOtp(user, otp))) return res.status(400).json({ message: "Invalid or expired code" });
    await setNewPassword(user, password);
    return res.status(200).json({ message: "update was successful" });
  }

  requireAuth(req, res, async () => {
    if (!req.isAdmin && String(req.user._id) !== String(user._id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    try {
      await setNewPassword(user, password);
      return res.status(200).json({ message: "update was successful" });
    } catch (e) {
      next(e);
    }
  });
});

module.exports = router;
module.exports.issueResetOtp = issueResetOtp;
