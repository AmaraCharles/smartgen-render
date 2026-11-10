var express = require("express");
const UsersDatabase = require("../../models/User");
const { requireAdmin } = require("../../middleware/security");
var router = express.Router();

// Previously unauthenticated (and crashed: UsersDatabase/res were undefined). Admin only now.
router.put("/:email/verify", requireAdmin, async function (req, res) {
  const user = await UsersDatabase.findOne({ email: req.params.email });

  if (!user) {
    return res.status(404).json({ success: false, status: 404, message: "User not found" });
  }

  try {
    await user.updateOne({ verified: true });
    res.writeHead(301, { Location: "https://harcourthamsa.com" });
    res.end();
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
