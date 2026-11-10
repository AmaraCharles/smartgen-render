var express = require("express");
const UsersDatabase = require("../models/User");
const { requireAdmin, selfParam, requireSelfEmailOrAdmin } = require("../middleware/security");
var router = express.Router();

// Fields a normal user may change on their own profile.
const USER_EDITABLE = ["firstName", "lastName", "phone", "country"];
// Fields that can never be set through this endpoint, even by an admin.
const NEVER_EDITABLE = ["_id", "password", "email", "tokenVersion", "resetOtpHash", "resetOtpExpires", "resetOtpAttempts", "withdrawals", "transactions"];

const ACCOUNT_KEYS = ["eth", "ltc", "btc", "usdt"];

router.get("/", requireAdmin, async function (req, res) {
  const users = await UsersDatabase.find();
  res.status(200).json({ code: "Ok", data: users });
});

router.get("/:email", requireSelfEmailOrAdmin("email"), async function (req, res) {
  const user = await UsersDatabase.findOne({ email: req.params.email });
  if (!user) return res.status(404).json({ message: "user not found" });
  res.status(200).json({ code: "Ok", data: user });
});

router.delete("/:email/delete", requireAdmin, async function (req, res) {
  const user = await UsersDatabase.findOne({ email: req.params.email });
  if (!user) return res.status(404).json({ message: "user not found" });
  await user.deleteOne();
  res.status(200).json({ code: "Ok" });
});

router.put("/:_id/profile/update", selfParam("_id"), async function (req, res) {
  const user = await UsersDatabase.findById(req.params._id);
  if (!user) return res.status(404).json({ message: "user not found" });

  const updates = {};
  for (const [key, value] of Object.entries(req.body || {})) {
    if (NEVER_EDITABLE.includes(key)) continue;
    if (!req.isAdmin && !USER_EDITABLE.includes(key)) continue;
    updates[key] = value;
  }

  try {
    await user.updateOne({ $set: updates });
    return res.status(200).json({ message: "update was successful" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// Changing payout addresses: owner only (or admin).
router.put("/:_id/accounts/update", selfParam("_id"), async function (req, res) {
  const user = await UsersDatabase.findById(req.params._id);
  if (!user) return res.status(404).json({ message: "user not found" });

  let incoming;
  try {
    const raw = req.body.values;
    incoming = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return res.status(400).json({ message: "Invalid account data" });
  }
  if (!incoming || typeof incoming !== "object") {
    return res.status(400).json({ message: "Invalid account data" });
  }

  const accounts = Object.assign({}, user.accounts);
  for (const key of ACCOUNT_KEYS) {
    if (incoming[key] !== undefined) {
      const address = incoming[key] && typeof incoming[key] === "object" ? incoming[key].address : incoming[key];
      accounts[key] = { address: String(address || "").slice(0, 200) };
    }
  }

  try {
    await user.updateOne({ accounts });
    return res.status(200).json({ message: "Account was updated successfully" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:_id/accounts", selfParam("_id"), async function (req, res) {
  const user = await UsersDatabase.findById(req.params._id);
  if (!user) return res.status(404).json({ message: "user not found" });
  return res.status(200).json({ data: user.accounts, message: "update was successful" });
});

module.exports = router;
