var express = require("express");
var { compareHashedPassword } = require("../../utils");
const UsersDatabase = require("../../models/User");
const { signToken, isAdminEmail, requireAdmin, authLimiter } = require("../../middleware/security");
var router = express.Router();

const INVALID = { code: "invalid credentials" };

router.post("/login", authLimiter, async function (request, response) {
  const email = String(request.body.email || "");
  const password = String(request.body.password || "");

  const user = await UsersDatabase.findOne({ email });

  // Same response for unknown email and wrong password, to prevent account enumeration.
  if (!user || !compareHashedPassword(user.password, password)) {
    return response.status(401).json(INVALID);
  }
  if (user.isDisabled || user.condition === "disabled") {
    return response.status(403).json({ code: "account disabled" });
  }

  // Admins (ADMIN_EMAILS) sign in through the normal login page and get an admin-role token.
  const role = isAdminEmail(user.email) ? "admin" : "user";
  response.status(200).json({ code: "Ok", data: user, token: signToken(user, role), role });
});

// Admin login now requires a password AND the email being listed in ADMIN_EMAILS.
router.post("/loginadmin", authLimiter, async function (request, response) {
  const email = String(request.body.email || "");
  const password = String(request.body.password || "");

  if (!isAdminEmail(email)) return response.status(401).json(INVALID);

  const user = await UsersDatabase.findOne({ email });
  if (!user || !compareHashedPassword(user.password, password)) {
    return response.status(401).json(INVALID);
  }

  response.status(200).json({ code: "Ok", data: user, token: signToken(user, "admin") });
});

const setCondition = (condition) => async (req, res) => {
  try {
    const user = await UsersDatabase.findById(req.params._id);
    if (!user) {
      return res.status(404).json({ success: false, status: 404, message: "User not found" });
    }
    user.condition = condition;
    await user.save();
    res.status(200).json({
      success: true,
      status: 200,
      message: `User ${condition} successfully`,
      user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, status: 500, message: "Internal Server Error" });
  }
};

router.put("/login/:_id/enable", requireAdmin, setCondition("enabled"));
router.put("/login/:_id/disable", requireAdmin, setCondition("disabled"));

module.exports = router;
