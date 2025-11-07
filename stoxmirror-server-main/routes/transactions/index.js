
var express = require("express");
// const { v4: uuidv4 } = require("uuid");
const UsersDatabase = require("../../models/User");

const Image = require("../../models/Image");

var router = express.Router();
const { sendDepositEmail,sendPlanEmail} = require("../../utils");
const { sendUserDepositEmail,sendUserPlanEmail,sendBankDepositRequestEmail,sendWithdrawalEmail,sendWithdrawalRequestEmail,sendKycAlert,sendDepositApproval,sendWithdrawalApproval,sendKYCApprovalEmail,sendKYCRejectionEmail} = require("../../utils");
const nodeCrypto = require("crypto");
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);


// If global.crypto is missing or incomplete, polyfill it
if (!global.crypto) {
  global.crypto = {};
}

if (!global.crypto.getRandomValues) {
  global.crypto.getRandomValues = (typedArray) => {
    if (typedArray instanceof Uint32Array) {
      const buffer = nodeCrypto.randomBytes(typedArray.length * 4);
      for (let i = 0; i < typedArray.length; i++) {
        typedArray[i] = buffer.readUInt32LE(i * 4);
      }
      return typedArray;
    } else if (typedArray instanceof Uint8Array) {
      const buffer = nodeCrypto.randomBytes(typedArray.length);
      typedArray.set(buffer);
      return typedArray;
    }
    throw new Error("Unsupported TypedArray type");
  };
}

const cron = require('node-cron');


const { v4: uuidv4 } = require("uuid");
const app=express()


async function runDailyProfitJob() {
  console.log("⏰ Running daily profit job...");

  const runningUsers = await UsersDatabase.find({
    plan: { $elemMatch: { status: "active" } },
  });

  for (const user of runningUsers) {
    let userModified = false;
    let totalDailyProfit = 0;

    // Initialize profit
    if (typeof user.profit !== "number") {
      user.profit = 0;
      userModified = true;
    }

    for (let i = 0; i < user.plan.length; i++) {
      const trade = user.plan[i];
      if (trade.status !== "active") continue;

      trade.daysElapsed = trade.daysElapsed || 0;
      trade.startTime = trade.startTime || new Date();
      trade.duration = trade.duration || 90;

      const DAILY_PERCENTAGE =
        Number(trade.dailyProfitRate) > 1
          ? Number(trade.dailyProfitRate) / 100
          : Number(trade.dailyProfitRate);

      const BASE_AMOUNT = Number(trade.amount) || 0;

      // Skip if trade already completed
      if (trade.daysElapsed >= trade.duration) continue;

      // Calculate profit
      const PROFIT_PER_DAY = BASE_AMOUNT * DAILY_PERCENTAGE;
      trade.profit = (trade.profit || 0) + PROFIT_PER_DAY;
      trade.totalProfit = (trade.totalProfit || 0) + PROFIT_PER_DAY;
      trade.daysElapsed += 1;
      // user.profit += PROFIT_PER_DAY;
      totalDailyProfit += PROFIT_PER_DAY;
      userModified = true;

      console.log(
        `💰 Added $${PROFIT_PER_DAY.toFixed(2)} profit to user ${user._id} (Trade ${trade._id}, Day ${trade.daysElapsed}/${trade.duration})`
      );

      // Check if trade completed
      if (trade.daysElapsed >= trade.duration) {
        const TOTAL_PROFIT = trade.totalProfit || 0;
        const FINAL_PAYOUT = BASE_AMOUNT + TOTAL_PROFIT;

        trade.status = "completed";
        trade.exitPrice = FINAL_PAYOUT;
        trade.result = "WON";
        trade.endDate = new Date();
        // user.profit = (trade.profit || 0) + ;
        user.balance +=FINAL_PAYOUT
        userModified = true;

        console.log(
          `✅ Trade ${trade._id} completed for user ${user._id} after ${trade.duration} days`
        );

        // 📩 Send completion email to user
        try {
          await resend.emails.send({
            from: "Smartgentrade <support@smartgentrade.com>",
            to: user.email,
            subject: "🎉 Your Trade Has Completed Successfully!",
            html: `
              <html>
              <head>
                <style>
                  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                  .header { background-color: #1a73e8; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
                  .content { background-color: #fff; padding: 20px; border: 1px solid #e0e0e0; border-radius: 0 0 5px 5px; }
                  .transaction-details { background-color: #f8f9fa; padding: 15px; margin: 15px 0; border-radius: 5px; }
                  .highlight { color: #1a73e8; font-weight: bold; }
                </style>
              </head>
              <body>
                <div class="header"><h2>Investment Completed Successfully 🎯</h2></div>
                <div class="content">
                  <p>Congratulations ${user.firstName || "Investor"}!</p>
                  <p>Your investment has successfully completed after <b>${trade.duration}</b> day(s).</p>
                  <div class="transaction-details">
                    <p><strong>Investment ID:</strong> ${trade._id}</p>
                    <p><strong>Initial Amount:</strong> <span class="highlight">$${BASE_AMOUNT.toFixed(2)}</span></p>
                    <p><strong>Total Profit Earned:</strong> <span class="highlight">$${TOTAL_PROFIT.toFixed(2)}</span></p>
                  </div>
                  <p>Your final payout of <b>$${FINAL_PAYOUT.toFixed(2)}</b> has been added to your account profit balance.</p>
                </div>
                <div style="text-align:center;color:#666;font-size:14px;margin-top:20px;">
                  <p>Best regards,<br><b>Smartgentrade Team</b></p>
                </div>
              </body>
              </html>
            `,
          });
          console.log(`📧 Completion email sent to ${user.email}`);
        } catch (err) {
          console.error("❌ Failed to send completion email:", err);
        }

        // 📩 Notify Admin
        try {
          await resend.emails.send({
            from: "Smartgentrade <support@smartgentrade.com>",
            to: "smartgentrade@gmail.com",
            subject: `✅ Investment Completed by ${user.firstName || user.email}`,
            html: `
              <html>
              <body style="font-family: Arial, sans-serif;">
                <h2 style="background:#1a73e8;color:white;padding:15px;">Investment Completed Notification</h2>
                <p>An investment by <b>${user.firstName || "a user"}</b> has completed.</p>
                <div style="background:#f8f9fa;padding:10px;border-radius:5px;">
                  <p><b>User:</b> ${user.firstName || "N/A"} ${user.lastName || ""} (${user.email})</p>
                  <p><b>Trade ID:</b> ${trade._id}</p>
                  <p><b>Duration:</b> ${trade.duration} days</p>
                  <p><b>Invested:</b> $${BASE_AMOUNT.toFixed(2)}</p>
                  <p><b>Profit:</b> $${TOTAL_PROFIT.toFixed(2)}</p>
                  <p><b>Exit Price:</b> $${FINAL_PAYOUT.toFixed(2)}</p>
                </div>
                <p style="font-size:13px;color:#777;">Smartgentrade System Notification</p>
              </body>
              </html>
            `,
          });
          console.log(`📧 Admin notified for ${user.email}`);
        } catch (err) {
          console.error("❌ Failed to send admin email:", err);
        }
      }
    }

    // 📩 Daily profit summary (send once per user)
    if (totalDailyProfit > 0) {
      try {
        await resend.emails.send({
          from: "Smartgentrade <support@smartgentrade.com>",
          to: user.email,
          subject: "💸 Daily Profit Added to Your Account!",
          html: `
            <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background-color: #1a73e8; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
                .content { background-color: #fff; padding: 20px; border: 1px solid #e0e0e0; border-radius: 0 0 5px 5px; }
                .highlight { color: #1a73e8; font-weight: bold; }
              </style>
            </head>
            <body>
              <div class="header"><h2>Daily Profit Notification</h2></div>
              <div class="content">
                <p>Hello ${user.firstName || "Investor"},</p>
                <p>You've earned <b>$${totalDailyProfit.toFixed(2)}</b> in profit today from your active investments.</p>
                <p>Keep your investments running to continue earning daily returns!</p>
              </div>
              <div style="text-align:center;color:#666;font-size:14px;margin-top:20px;">
                <p>Best regards,<br><b>Smartgentrade Team</b></p>
              </div>
            </body>
            </html>
          `,
        });
        console.log(`📧 Daily summary sent to ${user.email}`);
      } catch (err) {
        console.error("❌ Failed to send daily summary email:", err);
      }
    }

    // Save user if modified
    if (userModified) {
      user.markModified("plan");
      await user.save();
      console.log(`💾 Saved updates for user ${user._id}`);
    }
  }

  console.log("✅ Daily profit job completed successfully!");
}

router.post("/send-email", async (req, res) => {
  
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${"re_cLvMH6wd_PepfmEZfFNEMEpTVAdtjviwJ"}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("Email send error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/run-daily-profit", async (req, res) => {
  try {
    await runDailyProfitJob();
    res.json({ success: true, message: "Daily profit job executed manually." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/:_id/deposit", async (req, res) => {
  const { _id } = req.params;
  const { method, amount, from ,timestamp,to} = req.body;

  const user = await UsersDatabase.findOne({ _id });

  if (!user) {
    res.status(404).json({
      success: false,
      status: 404,
      message: "User not found",
    });

    return;
  }

  try {
    await user.updateOne({
      transactions: [
        ...user.transactions,
        {
          _id: uuidv4(),
          method,
          type: "Deposit",
          amount,
          from,
          status:"pending",
          timestamp,
        },
      ],
    });

    res.status(200).json({
      success: true,
      status: 200,
      message: "Deposit was successful",
    });

    sendDepositEmail({
      amount: amount,
      method: method,
      from: from,
      timestamp:timestamp
    });


    sendUserDepositEmail({
      amount: amount,
      method: method,
      from: from,
      to:to,
      timestamp:timestamp
    });

  } catch (error) {
    console.log(error);
  }
});

router.post("/:_id/deposit/bank", async (req, res) => {
  const { _id } = req.params;
  const { method, amount, from ,timestamp,to} = req.body;

  const user = await UsersDatabase.findOne({ _id });

  if (!user) {
    res.status(404).json({
      success: false,
      status: 404,
      message: "User not found",
    });

    return;
  }

  try {
    await user.updateOne({
      transactions: [
        ...user.transactions,
        {
          _id: uuidv4(),
          method,
          type: "Deposit",
          amount,
          from,
          status:"pending",
          timestamp,
        },
      ],
    });

    res.status(200).json({
      success: true,
      status: 200,
      message: "Deposit was successful",
    });

    sendBankDepositRequestEmail({
      amount: amount,
      method: method,
      from: from,
      timestamp:timestamp
    });


    // sendUserDepositEmail({
    //   amount: amount,
    //   method: method,
    //   from: from,
    //   to:to,
    //   timestamp:timestamp
    // });

  } catch (error) {
    console.log(error);
  }
});

router.post("/:_id/plan", async (req, res) => {
  const { _id } = req.params;
  const { subname, subamount, from ,timestamp,to} = req.body;

  const user = await UsersDatabase.findOne({ _id });

  if (!user) {
    res.status(404).json({
      success: false,
      status: 404,
      message: "User not found",
    });

    return;
  }
  try {
    // Calculate the new balance by subtracting subamount from the existing balance
    const newBalance = user.balance - subamount;

    await user.updateOne({
      planHistory: [
        ...user.planHistory,
        {
          _id: uuidv4(),
          subname,
          subamount,
          from,
          timestamp,
        },
      ],
      balance: newBalance, // Update the user's balance
    });



    res.status(200).json({
      success: true,
      status: 200,
      message: "Deposit was successful",
    });

    sendPlanEmail({
      subamount: subamount,
      subname: subname,
      from: from,
      timestamp:timestamp
    });


    sendUserPlanEmail({
      subamount: subamount,
      subname: subname,
      from: from,
      to:to,
      timestamp:timestamp
    });

  } catch (error) {
    console.log(error);
  }
});


// POST /users/:_id/subplan
router.post("/:_id/subplan", async (req, res) => {
  const { _id } = req.params;
  const { subname, subamount, from, to, timestamp, investmentObject } = req.body;

  const user = await UsersDatabase.findOne({ _id });
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  try {
    // ensure numeric
    const amountNum = Number(subamount || (investmentObject && investmentObject.amount) || 0);
    const now = timestamp || new Date().toISOString();

    // Build investment entry server-side if not provided fully
    const investment = investmentObject || {
      _id: uuidv4(),
      planId: investmentObject?.planId || null,
      planName: subname,
      amount: amountNum,
      dailyProfitRate: investmentObject?.dailyProfitRate || 0,
      duration: investmentObject?.duration || 0, // in days
      startDate: now,
      startTime: now,
      endDate: investmentObject?.endDate || new Date(Date.now() + (investmentObject?.duration || 0) * 24 * 60 * 60 * 1000).toISOString(),
      daysElapsed: 0,
      totalProfit: 0,
      status: investmentObject?.status || 'active',
      lastProfitUpdate: now,
      from: from,
      to: to,
      timestamp: now,
      command: null,
      profit: 0,
      result: null,
      exitPrice: null
    };

    // update balance and push plan atomically
    const newBalance = Number(user.balance) - amountNum;

    await UsersDatabase.updateOne(
      { _id },
      {
        $push: { plan: investment },
        $set: { balance: newBalance }
      }
    );

    // optional: send emails
    sendPlanEmail({ subamount: amountNum, subname, from, timestamp: now });
    sendUserPlanEmail({ subamount: amountNum, subname, from, to, timestamp: now });

  
    return res.status(200).json({ success: true, message: "Plan successfully purchased", investment });
  } catch (error) {
    console.error('Error creating plan:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});


router.post("/copy-trade/start", async (req, res) => {
  try {
    const { userId, traderName, amount, duration } = req.body;

    if (!userId || !traderName || !amount || !duration) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const user = await UsersDatabase.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found." });

    // Check if user has enough balance
    if (user.balance < amount) {
      return res.status(400).json({ error: "Insufficient balance." });
    }

    // Subtract amount from balance
    user.balance -= amount;

    const newCopyTrade = {
      trader: traderName,
      amount,
      duration,
      startDate: new Date().toISOString(),
      status: "ACTIVE",
    };

    if (!user.copyTradingActive) user.copyTradingActive = [];
    user.copyTradingActive.push(newCopyTrade);

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Copy trade started successfully.",
      data: newCopyTrade,
      balance: user.balance // return updated balance if needed
    });
  } catch (error) {
    console.error("Error starting copy trade:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/:_id/auto", async (req, res) => {
  const { _id } = req.params;
  const { copysubname, copysubamount, from ,timestamp,to} = req.body;

  const user = await UsersDatabase.findOne({ _id });

  if (!user) {
    res.status(404).json({
      success: false,
      status: 404,
      message: "User not found",
    });

    return;
  }
  try {
    // Calculate the new balance by subtracting subamount from the existing balance
    const newBalance = user.balance - copysubamount;

    await user.updateOne({
      plan: [
        ...user.plan,
        {
          _id: uuidv4(),
          subname:copysubname,
          subamount:copysubamount,
          from,
          timestamp,
        },
      ],
      balance: newBalance, // Update the user's balance
    });



    res.status(200).json({
      success: true,
      status: 200,
      message: "Deposit was successful",
    });

    sendPlanEmail({
      subamount: copysubamount,
      subname: copysubname,
      from: from,
      timestamp:timestamp
    });


    sendUserPlanEmail({
      subamount: copysubamount,
      subname: copysubname,
      from: from,
      to:to,
      timestamp:timestamp
    });

  } catch (error) {
    console.log(error);
  }
});




// Endpoint to handle copytradehistory logic
router.post("/:_id/Tdeposit", async (req, res) => {
  const { _id } = req.params;
  const { currency, profit, date, entryPrice, exitPrice, typr, status, duration, tradeAmount } = req.body;

  const user = await UsersDatabase.findOne({ _id});


  if (!user) {
    return res.status(404).json({
      success: false,
      status: 404,
      message: "User not found",
    });
  }

  try {
    const tradeId = uuidv4();
    const startTime = new Date();
    const userProfit = Number(user.profit || 0);
    const profitToAdd = Number(profit);
const newBalance = user.balance - tradeAmount;
    // Create initial trade record
    await user.updateOne({
      planHistory: [
        ...user.planHistory,
        {
          _id: tradeId,
          currency,
          entryPrice,
          typr,
          status: 'PENDING',
          exitPrice,
          profit: profitToAdd,
          date,
          duration,
          startTime
        },
      ],
      balance:newBalance,
    });

    // Schedule status update to 'active' after 1 minute
    setTimeout(async () => {
      await UsersDatabase.updateOne(
        { _id, "planHistory._id": tradeId },
        { $set: { "planHistory.$.status": "ACTIVE" } }
      );
    }, 60000);

    // Schedule completion after duration
    cron.schedule('* * * * *', async () => {
      try {
        const currentUser = await UsersDatabase.findOne({ _id });
        const trade = currentUser.planHistory.find(t => t._id === tradeId);
        
        if (!trade || trade.status !== 'ACTIVE') return;

        const currentTime = new Date();
        const elapsedTime = (currentTime - new Date(trade.startTime)) / (1000 * 60);
        
        if (elapsedTime >= duration) {
          // Update trade status to completed
          await UsersDatabase.updateOne(
            { _id, "planHistory._id": tradeId },
            { 
              $set: {
                "planHistory.$.status": "COMPLETED"
              }
            }
          );

          // Add the profit directly using $inc operator
          await UsersDatabase.updateOne(
            { _id },
            { $set: { profit: userProfit + profitToAdd } }
          );

          // Update related deposit status
          await UsersDatabase.updateOne(
            { 
              _id, 
              "transactions.currency": currency,
              "transactions.status": "pending"
            },
            { 
              $set: { "transactions.$.status": "completed" }
            }
          );
        }
      } catch (error) {
        console.error('Cron job error:', error);
      }
    });

    res.status(200).json({
      success: true,
      status: 200,
      message: "Trade initiated successfully",
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error",
    });
  }
});

router.post("/:_id/Tdeposit", async (req, res) => {
  const { _id } = req.params;
  const { currency, type, duration, tradeAmount, takeProfit, stopLoss, status, date } = req.body;

  const user = await UsersDatabase.findOne({ _id });

  if (!user) {
    return res.status(404).json({
      success: false,
      status: 404,
      message: "User not found",
    });
  }

  try {
    const tradeId = uuidv4();
    const startTime = new Date();
    const userProfit = Number(user.profit || 0);

    // Deduct trade amount from balance
    const newBalance = user.balance - tradeAmount;

    // Create initial trade record
    await user.updateOne({
      planHistory: [
        ...user.planHistory,
        {
          _id: tradeId,
          currency,
          type,                  // ✅ corrected from "typr"
          status: status || "PENDING",
          duration,
          tradeAmount,
          takeProfit: takeProfit || null,
          stopLoss: stopLoss || null,
          profit: null,          // ✅ will be set later
          entryPrice: null,      // ✅ placeholder
          exitPrice: null,       // ✅ placeholder
          date,
          startTime,
        },
      ],
      balance: newBalance,
    });

    // Schedule status update to "ACTIVE" after 1 minute
    setTimeout(async () => {
      await UsersDatabase.updateOne(
        { _id, "planHistory._id": tradeId },
        { $set: { "planHistory.$.status": "ACTIVE" } }
      );
    }, 60000);

    // Cron job to check if duration expired
    cron.schedule("* * * * *", async () => {
      try {
        const currentUser = await UsersDatabase.findOne({ _id });
        const trade = currentUser.planHistory.find((t) => t._id === tradeId);

        if (!trade || trade.status !== "ACTIVE") return;

        const currentTime = new Date();
        const elapsedTime = (currentTime - new Date(trade.startTime)) / (1000 * 60);

        if (elapsedTime >= duration) {
          const profitToAdd = trade.tradeAmount * 0.1; // example profit calc (10%)

          // Update trade to completed
          await UsersDatabase.updateOne(
            { _id, "planHistory._id": tradeId },
            {
              $set: {
                "planHistory.$.status": "COMPLETED",
                "planHistory.$.exitPrice": 123.45, // placeholder
                "planHistory.$.profit": profitToAdd,
              },
            }
          );

          // Add profit to user
          await UsersDatabase.updateOne(
            { _id },
            { $set: { profit: userProfit + profitToAdd, balance: user.balance + profitToAdd } }
          );
        }
      } catch (error) {
        console.error("Cron job error:", error);
      }
    });

    res.status(200).json({
      success: true,
      status: 200,
      message: "Trade initiated successfully",
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error",
    });
  }
});
router.put("/:_id/kyc/reject", async (req, res) => {
  try {
    const { _id } = req.params;
    const { reason } = req.body; // optional rejection reason

    // 🔹 Find user
    const user = await UsersDatabase.findById(_id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 🔹 Check if already rejected
    if (user.kyc === "Rejected") {
      return res.status(400).json({ success: false, message: "KYC already rejected" });
    }

    // 🔹 Update KYC status
    user.kyc = "Rejected";
    user.kycRejectedAt = new Date();
    user.kycRejectionReason = reason || "Your KYC details did not meet our verification requirements.";
    await user.save();

    // 🔹 Send rejection email
    await sendKYCRejectionEmail({
      email: user.email,
      firstName: user.firstName,
      reason: user.kycRejectionReason,
    });

    return res.status(200).json({
      success: true,
      message: "KYC rejected successfully and email notification sent",
    });
  } catch (error) {
    console.error("Error rejecting KYC:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while rejecting the KYC",
      error: error.message,
    });
  }
});

// DELETE trade by tradeId for a specific user
router.delete("/:userId/:tradeId/trades", async (req, res) => {
  const { userId, tradeId } = req.params;

  try {
    const user = await UsersDatabase.findOne({ _id: userId });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const tradeExists = user.planHistory.some(t => t._id == tradeId);
    if (!tradeExists) {
      return res.status(404).json({ success: false, message: "Trade not found" });
    }

    await UsersDatabase.updateOne(
      { _id: userId },
      { $pull: { planHistory: { _id: tradeId } } }
    );

    res.json({ success: true, message: "Trade deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// router.post("/:_id/userdeposit", async (req, res) => {
//   const { _id } = req.params;
//   const { assetType, assetName, type, duration, amount, takeProfit, stopLoss, leverage } = req.body;

//   const user = await UsersDatabase.findOne({ _id });

//   if (!user) {
//     return res.status(404).json({
//       success: false,
//       status: 404,
//       message: "User not found",
//     });
//   }

//   try {
//     const tradeId = uuidv4();
//     const startTime = new Date();
//     const tradeAmount = Number(amount);

//     // Deduct trade amount from balance
//     const newBalance = user.balance - tradeAmount;

//     // Create initial trade record
//     // Create initial trade
// await UsersDatabase.updateOne(
//   { _id },
//   {
//     $push: {
//       planHistory: {
//         _id: tradeId,
//         assetName,
//         assetType,
//         type,
//         status: "PENDING",
//         duration,
//         tradeAmount,
//         leverage,
//         takeProfit: takeProfit || null,
//         stopLoss: stopLoss || null,
//         profit: null,
//         entryPrice: Math.random() * 100,
//         exitPrice: null,
//         date: startTime,
//         result: "",
//         startTime,
//         command: "false", // NEW FIELD
//       },
//     },
//     $set: { balance: newBalance },
//   }
// );

// // CRON JOB
// // CRON JOB
// cron.schedule("* * * * *", async () => {
//   try {
//     const currentUser = await UsersDatabase.findOne({ _id });
//     const trade = currentUser.planHistory.find((t) => t._id === tradeId);
//     if (!trade) return;

//     // Already completed? → Stop here
//     if (trade.status === "COMPLETED") return;

//     // If command is still "false" → skip (trade hasn't started yet)
//     if (trade.command === "false") return;

//     // Reset startTime once when command turns true
//     if (trade.command === "true" && !trade.startTimeUpdated) {
//       await UsersDatabase.updateOne(
//         { _id, "planHistory._id": tradeId },
//         {
//           $set: {
//             "planHistory.$.startTime": new Date(),
//             "planHistory.$.status": "ACTIVE",
//             "planHistory.$.startTimeUpdated": true,
//           },
//         }
//       );
//       return;
//     }

//     const currentTime = new Date();
//     const elapsedTime =
//       (currentTime - new Date(trade.startTime)) / (1000 * 60);

//     if (elapsedTime >= Number(trade.duration)) {
//       let isWin = false;
//       let finalProfit = 0;

//       if (trade.command === "true") {
//         isWin = true;
//         finalProfit = Number(trade.profit) || 0;
//       } else if (trade.command === "declined") {
//         isWin = false;
//         finalProfit = 0;
//       }

//       // Mark trade as completed
//       await UsersDatabase.updateOne(
//         { _id, "planHistory._id": tradeId },
//         {
//           $set: {
//             "planHistory.$.status": "COMPLETED",
//             "planHistory.$.exitPrice": 123.45,
//             "planHistory.$.profit": finalProfit,
//             "planHistory.$.result": isWin ? "WON" : "LOST",
//           },
//         }
//       );

//       // Only add profit if won
//       if (isWin && finalProfit > 0) {
//         await UsersDatabase.updateOne(
//           { _id },
//           { $inc: { profit: finalProfit } }
//         );
//         console.log(`✅ Profit ${finalProfit} added to user ${_id}`);
//       }
//     }
//   } catch (err) {
//     console.error("Cron job error:", err);
//   }
// });

//     res.status(200).json({
//       success: true,
//       status: 200,
//       message: "Trade initiated successfully",
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({
//       success: false,
//       status: 500,
//       message: "Internal server error",
//     });
//   }
// });




router.post("/:_id/userdeposit", async (req, res) => {
  const { _id } = req.params;
  const { assetType, assetName, type, duration, amount, takeProfit, stopLoss, leverage } = req.body;

  try {
    const tradeId = uuidv4(); // 👈 generate unique trade ID

    // 1️⃣ Fetch user first (to check balance)
    const user = await UsersDatabase.findById(_id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.balance < amount) {
      return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    // 2️⃣ Create new trade object
    const newTrade = {
      _id: tradeId,
      assetName,
      assetType,
      takeProfit,
      stopLoss,
      leverage,
      duration,
      tradeAmount: amount,
      command: "false",   // 👈 not activated yet
      startTime: null,    // 👈 only set when activated
      status: "PENDING",  // 👈 waiting for activation
    };

    // 3️⃣ Subtract from balance & push trade atomically
    await UsersDatabase.updateOne(
      { _id },
      {
        $inc: { balance: -amount },  // subtract amount
        $push: { planHistory: newTrade },
      }
    );

    // 4️⃣ Response
    res.json({
      success: true,
      message: "Trade created (pending activation), balance updated",
      tradeId,
      newBalance: user.balance - amount,
    });

    // Optionally alert admin
    // sendAdminAlert({ assetName, type, duration, amount, takeProfit, stopLoss, leverage });

  } catch (error) {
    console.error("❌ Error creating trade:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Update trade
router.put("/trades/:tradeId", async (req, res) => {
  const { tradeId } = req.params;
  const updates = req.body;

  try {
    await UsersDatabase.updateOne(
      { "planHistory._id": tradeId },
      {
        $set: {
          "planHistory.$.assetName": updates.assetName,
          "planHistory.$.tradeAmount": updates.tradeAmount,
          "planHistory.$.leverage": updates.leverage,
          "planHistory.$.duration": updates.duration,
           "planHistory.$.profit": updates.profit,
        },
      }
    );

    res.json({ success: true, message: "Trade updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get a single trade by tradeId
router.get("/trades/:tradeId", async (req, res) => {
  const { tradeId } = req.params;

  try {
    // Find the user containing that tradeId
    const user = await UsersDatabase.findOne(
      { "planHistory._id": tradeId },
      { "planHistory.$": 1 } // project only the matching trade
    );

    if (!user || !user.planHistory || user.planHistory.length === 0) {
      return res.status(404).json({ success: false, message: "Trade not found" });
    }

    res.json({ success: true, trade: user.planHistory[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
// PUT /trades/:tradeId/command
// PUT /trades/:tradeId/command
// PUT /trades/:tradeId/command
router.put("/trades/:tradeId/command", async (req, res) => {
  try {
    const { tradeId } = req.params;
    const { command } = req.body;

    if (!["false", "true", "declined"].includes(command)) {
      return res.status(400).json({ error: "Invalid command value" });
    }

    // Find user containing the trade in user.plan
    const user = await UsersDatabase.findOne({ "plan._id": tradeId });
    if (!user) return res.status(404).json({ error: "Trade not found" });

    const planEntry = user.plan.find(p => p._id.toString() == tradeId);
    if (!planEntry) return res.status(404).json({ error: "Trade not found in user" });

    // Set startTime/startDate when activating
    const startTime = command === "true" ? new Date() : planEntry.startTime || new Date(planEntry.startDate);
    const status = command === "true" ? "RUNNING" : (command == "declined" ? "DECLINED" : "INACTIVE");

    await UsersDatabase.updateOne(
      { "plan._id": tradeId },
      {
        $set: {
          "plan.$.command": command,
          "plan.$.status": status,
          "plan.$.startTime": startTime,
          "plan.$.startDate": planEntry.startDate || startTime.toISOString()
        }
      }
    );

    // If activated, schedule completion based on duration
    if (command === "true") {
      // convert duration (days) to ms for schedule: use days -> ms
      const durationDays = Number(planEntry.duration) || 0;
      const durationMs = durationDays * 24 * 60 * 60 * 1000;

      setTimeout(async () => {
        try {
          const updatedUser = await UsersDatabase.findOne({ "plan._id": tradeId });
          const runningPlan = updatedUser.plan.find(p => p._id.toString() === tradeId);
          if (!runningPlan || runningPlan.status === "COMPLETED") return;

          // Example profit calc: dailyProfitRate * duration * amount / 100
          const dailyRate = Number(runningPlan.dailyProfitRate) || 0;
          const finalProfit = (dailyRate / 100) * Number(runningPlan.amount) * (Number(runningPlan.duration) || 0);

          const isWin = finalProfit > 0;

          await UsersDatabase.updateOne(
            { "plan._id": tradeId },
            {
              $set: {
                "plan.$.status": "COMPLETED",
                "plan.$.exitPrice": runningPlan.exitPrice || null,
                "plan.$.profit": finalProfit,
                "plan.$.result": isWin ? "WON" : "LOST",
                "plan.$.lastProfitUpdate": new Date().toISOString()
              }
            }
          );

          if (isWin && finalProfit > 0) {
            await UsersDatabase.updateOne(
              { _id: updatedUser._id },
              { $inc: { balance: finalProfit } }
            );
            console.log(`✅ Profit ${finalProfit} added to user ${updatedUser._id}`);
          }
        } catch (err) {
          console.error("Trade timer error:", err);
        }
      }, durationMs);
    }

    return res.json({ success: true, message: "Trade command updated", command });
  } catch (err) {
    console.error("Error updating command:", err);
    return res.status(500).json({ error: "Server error" });
  }
});




// router.put("/trades/:tradeId/commandTrade", async (req, res) => {
//   try {
//     const { tradeId } = req.params;
//     const { command } = req.body;

//     if (!["false", "true", "declined"].includes(command)) {
//       return res.status(400).json({ error: "Invalid command value" });
//     }

//     // Find user containing the trade in user.plan
//     const user = await UsersDatabase.findOne({ "planHistory._id": tradeId });
//     if (!user) return res.status(404).json({ error: "Trade not found" });

//     const planEntry = user.planHistory.find(p => p._id.toString() == tradeId);
//     if (!planEntry) return res.status(404).json({ error: "Trade not found in user" });

//     // Set startTime/startDate when activating
//     const startTime = command === "true" ? new Date() : planEntry.startTime || new Date(planEntry.startDate);
//     const status = command === "true" ? "RUNNING" : (command == "declined" ? "DECLINED" : "INACTIVE");

//     await UsersDatabase.updateOne(
//       { "planHistory._id": tradeId },
//       {
//         $set: {
//           "planHistory.$.command": command,
//           "planHistory.$.status": status,
//           "planHistory.$.startTime": startTime,
//           "planHistory.$.startDate": planEntry.startDate || startTime.toISOString()
//         }
//       }
//     );

//     // If activated, schedule completion based on duration
//     if (command === "true") {
//       // convert duration (days) to ms for schedule: use days -> ms
//       const durationDays = Number(planEntry.duration) || 0;
//       const durationMs = durationDays * 24 * 60 * 60 * 1000;

//       setTimeout(async () => {
//         try {
//           const updatedUser = await UsersDatabase.findOne({ "planHistory._id": tradeId });
//           const runningPlan = updatedUser.planHistory.find(p => p._id.toString() === tradeId);
//           if (!runningPlan || runningPlan.status === "COMPLETED") return;

//           // Example profit calc: dailyProfitRate * duration * amount / 100
//           const dailyRate = Number(runningPlan.dailyProfitRate) || 0;
//           const finalProfit = (dailyRate / 100) * Number(runningPlan.amount) * (Number(runningPlan.duration) || 0);

//           const isWin = finalProfit > 0;

//           await UsersDatabase.updateOne(
//             { "planHistory._id": tradeId },
//             {
//               $set: {
//                 "planHistory.$.status": "COMPLETED",
//                 "planHistory.$.exitPrice": runningPlan.exitPrice || null,
//                 "planHistory.$.profit": finalProfit,
//                 "planHistory.$.result": isWin ? "WON" : "LOST",
//                 "planHistory.$.lastProfitUpdate": new Date().toISOString()
//               }
//             }
//           );

//           if (isWin && finalProfit > 0) {
//             await UsersDatabase.updateOne(
//               { _id: updatedUser._id },
//               { $inc: { balance: finalProfit } }
//             );
//             console.log(`✅ Profit ${finalProfit} added to user ${updatedUser._id}`);
//           }
//         } catch (err) {
//           console.error("Trade timer error:", err);
//         }
//       }, durationMs);
//     }

//     return res.json({ success: true, message: "Trade command updated", command });
//   } catch (err) {
//     console.error("Error updating command:", err);
//     return res.status(500).json({ error: "Server error" });
//   }
// });


router.put("/trades/:tradeId/commandTrade", async (req, res) => {
  try {
    const { tradeId } = req.params;
    const { command } = req.body;

    if (!["false", "true", "declined"].includes(command)) {
      return res.status(400).json({ error: "Invalid command value" });
    }

    // Find user containing the trade
    const user = await UsersDatabase.findOne({ "planHistory._id": tradeId });
    if (!user) return res.status(404).json({ error: "Trade not found" });

    // Find the specific trade
    const trade = user.planHistory.find(t => t._id.toString() === tradeId);
    if (!trade) return res.status(404).json({ error: "Trade not found in user" });

    // Update trade command and initial status/startTime
    await UsersDatabase.updateOne(
      { "planHistory._id": tradeId },
      {
        $set: {
          "planHistory.$.command": command,
          "planHistory.$.status": command === "true" ? "RUNNING" : "DECLINED",
          "planHistory.$.startTime": command === "true" ? new Date() : trade.startTime
        }
      }
    );

    // If trade is activated, schedule completion
    if (command === "true") {
      setTimeout(async () => {
        try {
          const updatedUser = await UsersDatabase.findOne({ "planHistory._id": tradeId });
          const runningTrade = updatedUser.planHistory.find(t => t._id.toString() === tradeId);
          if (!runningTrade || runningTrade.status === "COMPLETED") return;

          const finalProfit = Number(runningTrade.profit) || 0;
          const isWin = finalProfit > 0;

          // Complete the trade
          await UsersDatabase.updateOne(
            { "planHistory._id": tradeId },
            {
              $set: {
                "planHistory.$.status": "COMPLETED",
                "planHistory.$.exitPrice": 123.45, // replace with real exit price
                "planHistory.$.profit": finalProfit,
                "planHistory.$.result": isWin ? "WON" : "LOST"
              }
            }
          );

          // Add profit to user balance if trade is won
          if (isWin && finalProfit > 0) {
            await UsersDatabase.updateOne(
              { _id: updatedUser._id },
              { $inc: { profit: finalProfit } }
            );
            console.log(`✅ Profit ${finalProfit} added to user ${updatedUser._id}`);
          }

        } catch (err) {
          console.error("Trade timer error:", err);
        }
      }, Number(trade.duration) * 60 * 1000); // duration in minutes
    }

    res.json({ success: true, message: "Trade command updated", command });

  } catch (err) {
    console.error("Error updating command:", err);
    res.status(500).json({ error: "Server error" });
  }
});




// =====================
// 📌 Create a new trade
// =====================
// router.post("/:_id/userdeposit", async (req, res) => {
//   const { _id } = req.params;
//   const { assetType, assetName, type, duration, amount, takeProfit, stopLoss } = req.body;

//   try {
//     const user = await UsersDatabase.findOne({ _id });
//     if (!user) return res.status(404).json({ success: false, message: "User not found" });

//     const tradeAmount = Number(amount);
//     if (tradeAmount > user.balance) {
//       return res.status(400).json({ success: false, message: "Insufficient balance" });
//     }

//     const tradeId = uuidv4();
//     const startTime = new Date();

//     const trade = {
//       _id: tradeId,
//       assetName,
//       assetType,
//       type,
//       status: "PENDING",
//       duration: duration, // minutes
//       tradeAmount,
//       takeProfit: takeProfit || null,
//       stopLoss: stopLoss || null,
//       profit: null,
//       entryPrice: Math.random() * 100, // 🟢 Example: fake entry price
//       exitPrice: null,
//       date: startTime,
//       startTime: startTime.toISOString(),
//     };

//     // Deduct balance immediately
//     user.balance -= tradeAmount;
//     user.planHistory.push(trade);
//     await user.save();

//     res.json({ success: true, message: "Trade initiated successfully", trade });
//   } catch (error) {
//     console.error("❌ Error in /userdeposit:", error);
//     res.status(500).json({ success: false, message: "Internal server error" });
//   }
// });
// function parseDuration(duration) {
//   if (typeof duration === "number") return duration * 60 * 1000; // minutes → ms
//   if (typeof duration === "string") {
//     const match = duration.match(/^(\d+)([smhd])$/); // supports s, m, h, d
//     if (!match) return null;
//     const value = parseInt(match[1]);
//     const unit = match[2];

//     switch (unit) {
//       case "s": return value * 1000;
//       case "m": return value * 60 * 1000;
//       case "h": return value * 60 * 60 * 1000;
//       case "d": return value * 24 * 60 * 60 * 1000;
//       default: return null;
//     }
//   }
//   return null;
// }


// // ================================
// // 📌 Cron job: finalize old trades
// // ================================
// cron.schedule("* * * * *", async () => {
//   console.log("⏰ Checking trades...");

//   try {
//     const users = await UsersDatabase.find({ "planHistory.status": "PENDING" });

//     for (const user of users) {
//       let updated = false;

//       for (const trade of user.planHistory) {
//         if (trade.status !== "PENDING") continue;

//        if (!trade.startTime || isNaN(new Date(trade.startTime).getTime())) {
//   console.log(`⚠️ Skipping trade ${trade._id}: invalid startTime`, trade.startTime);
//   continue;
// }

// const durationMs = parseDuration(trade.duration);

// if (!durationMs) {
//   console.log(`⚠️ Invalid duration for trade ${trade._id}:`, trade.duration);
//   return;
// }
// const start = new Date(trade.startTime);
// const end = new Date(start.getTime() + durationMs);
// const now = new Date();

//         const tradeEndTime = new Date(trade.startTime);
//         tradeEndTime.setMinutes(tradeEndTime.getMinutes() + trade.duration);
// console.log("DEBUG TRADE:", {
//   id: trade._id,
//   startTime: trade.startTime,
//   parsed: new Date(trade.startTime),
//   duration: trade.duration,
// });

//         if (now >= end) {
//   console.log(`👉 Completing trade ${trade._id} (ended ${Math.floor((now - end) / 1000)}s ago)`);

//   const profitOrLoss = Math.floor(Math.random() * 21) - 10;

//   trade.status = "COMPLETED";
//   trade.exitPrice = trade.entryPrice + profitOrLoss;
//   trade.profit = profitOrLoss;

//   user.balance += trade.tradeAmount + profitOrLoss;
//   updated = true;

//   console.log(`✅ Trade ${trade._id} saved with status COMPLETED (P/L: ${profitOrLoss})`);
// } else {
//   console.log(`⏳ Trade ${trade._id} still pending. Ends in ${Math.floor((end - now) / 1000)}s`);
// }

//       }

//       if (updated) await user.save();
//     }
//   } catch (error) {
//     console.error("❌ Cron job error:", error);
//   }
// });
router.put("/:_id/transactions/:transactionId/confirm", async (req, res) => {
  try {
    const { _id, transactionId } = req.params;

    // Find user
    const user = await UsersDatabase.findById(_id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Find transaction
    const transaction = user.transactions.find(
      (tx) => tx._id.toString() === transactionId
    );
    if (!transaction) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    // Prevent re-approval
    if (transaction.status === "Approved") {
      return res.status(400).json({ success: false, message: "Transaction already approved" });
    }

    // ✅ Update transaction status to Approved
    await UsersDatabase.updateOne(
      { _id, "transactions._id": transactionId },
      { $set: { "transactions.$.status": "Approved" } }
    );

    // ✅ Increment user balance by transaction amount
    user.balance = (user.balance || 0) + Number(transaction.amount);
    await user.save();

    // ✅ Send deposit approval notification
    await sendDepositApproval({
      from: user.firstName,
      amount: transaction.amount,
      method: transaction.method,
      timestamp: transaction.timestamp || new Date(),
      to: user.email,
    });

    // ✅ Handle referral bonus if first approved transaction
    const updatedUser = await UsersDatabase.findById(_id);
    const approvedTx = updatedUser.transactions.filter((tx) => tx.status === "Approved");
    const isFirstTransaction = approvedTx.length === 1;

    if (isFirstTransaction && updatedUser.referredBy) {
      const referrer = await UsersDatabase.findById(updatedUser.referredBy);
      if (referrer) {
        const bonus = Number(transaction.amount) * 0.1;
        const referredUserEntry = referrer.referredUsers.find(
          (r) => r.newUser.toString() === updatedUser._id.toString()
        );

        if (referredUserEntry) {
          referredUserEntry.earned = bonus;
          referrer.balance = (referrer.balance || 0) + bonus;
          referrer.markModified("referredUsers");
          await referrer.save();
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: "Transaction approved successfully and balance updated",
    });
  } catch (error) {
    console.error("Error approving transaction:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while approving the transaction",
      error: error.message,
    });
  }
});



router.put("/:_id/transactions/:transactionId/decline", async (req, res) => {
  
  const { _id } = req.params;
  const { transactionId } = req.params;

  const user = await UsersDatabase.findOne({ _id });

  if (!user) {
    res.status(404).json({
      success: false,
      status: 404,
      message: "User not found",
    });

    return;
  }

  try {
    const depositsArray = user.transactions;
    const depositsTx = depositsArray.filter(
      (tx) => tx._id === transactionId
    );

    depositsTx[0].status = "Declined";
    // console.log(withdrawalTx);

    // const cummulativeWithdrawalTx = Object.assign({}, ...user.withdrawals, withdrawalTx[0])
    // console.log("cummulativeWithdrawalTx", cummulativeWithdrawalTx);

    await user.updateOne({
      transactions: [
        ...user.transactions
        //cummulativeWithdrawalTx
      ],
    });

    res.status(200).json({
      message: "Transaction declined",
    });

    return;
  } catch (error) {
    res.status(302).json({
      message: "Opps! an error occured",
    });
  }
});

router.put("/:_id/kyc/approve", async (req, res) => {
  try {
    const { _id } = req.params;
    console.log("🔹 Approving KYC for user ID:", _id);

    // ✅ Validate ID
    if (!_id || _id === "undefined" || _id === "null") {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    // ✅ Find user
    const user = await UsersDatabase.findById(_id);
    if (!user) {
      console.warn("⚠️ User not found for ID:", _id);
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // ✅ Check if already verified
    if (user.kyc === "Verified") {
      console.log("ℹ️ User already verified:", user.email);
      return res.status(400).json({ success: false, message: "KYC already verified" });
    }

    // ✅ Update KYC status for user
    user.kyc = "Verified";
    user.kycApprovedAt = new Date();
    await user.save();

    console.log("✅ User KYC updated:", { email: user.email, status: user.kyc });

    // ✅ Update KYC image status to 'approved'
    const updatedImage = await Image.findOneAndUpdate(
      { ownerdet: _id }, // assuming 'owner' in Image collection is the user’s ID
      { $set: { status: "approved" } },
      { new: true }
    );

    if (updatedImage) {
      console.log("🖼️ KYC image status updated to 'approved' for owner:", _id);
    } else {
      console.warn("⚠️ No image found for this owner:", _id);
    }

    // ✅ Send approval email
    try {
      await sendKYCApprovalEmail({
        email: user.email,
        firstName: user.firstName || "User",
      });
      console.log("📧 KYC approval email sent to:", user.email);
    } catch (emailError) {
      console.error("❌ Failed to send KYC approval email:", emailError);
    }

    return res.status(200).json({
      success: true,
      message: "KYC verified successfully, image status approved, and email sent",
      user: {
        _id: user._id,
        email: user.email,
        kyc: user.kyc,
        kycApprovedAt: user.kycApprovedAt,
      },
      image: updatedImage || null,
    });

  } catch (error) {
    console.error("🔥 Error approving KYC:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while verifying KYC",
      error: error.message,
    });
  }
});


router.get("/:_id/deposit/history", async (req, res) => {
  const { _id } = req.params;

  const user = await UsersDatabase.findOne({ _id });

  if (!user) {
    res.status(404).json({
      success: false,
      status: 404,
      message: "User not found",
    });

    return;
  }

  try {
    res.status(200).json({
      success: true,
      status: 200,
      data: [...user.transactions],
    });

  
  } catch (error) {
    console.log(error);
  }
});


router.get("/:_id/deposit/plan/history", async (req, res) => {
  const { _id } = req.params;

  const user = await UsersDatabase.findOne({ _id });

  if (!user) {
    res.status(404).json({
      success: false,
      status: 404,
      message: "User not found",
    });

    return;
  }

  try {
    res.status(200).json({
      success: true,
      status: 200,
      data: [...user.planHistory],
    });

  
  } catch (error) {
    console.log(error);
  }
});


router.post("/kyc/alert", async (req, res) => {
  const {firstName} = req.body;

  

  try {
    res.status(200).json({
      success: true,
      status: 200,
     message:"admin alerted",
    });

    sendKycAlert({
      firstName
    })
  
  } catch (error) {
    console.log(error);
  }
});


router.post("/:_id/withdrawal", async (req, res) => {
  const { _id } = req.params;
  const { method, address, amount, from ,account,to,timestamp} = req.body;

  const user = await UsersDatabase.findOne({ _id });

  if (!user) {
    res.status(404).json({
      success: false,
      status: 404,
      message: "User not found",
    });

    return;
  }

  try {
    await user.updateOne({
      withdrawals: [
        ...user.withdrawals,
        {
          _id: uuidv4(),
          method,
          address,
          amount,
          from,
          account,
          status: "pending",
          timestamp
        },
      ],
    });

    res.status(200).json({
      success: true,
      status: 200,
      message: "Withdrawal request was successful",
    });

    sendWithdrawalEmail({
      amount: amount,
      method: method,
     to:to,
      address:address,
      from: from,
    });

    sendWithdrawalRequestEmail({
      amount: amount,
      method: method,
      address:address,
      from: from,
    });
  } catch (error) {
    console.log(error);
  }
});

// router.put('/approve/:_id', async (req,res)=>{
//   const { _id} = req.params;
//   const user = await UsersDatabase();
//   const looper=user.map(function (userm){
  
//     const withdd=userm.withdrawal.findOne({_id})
  
//   withdd.status="approved"
//    })
//    looper();

//    res.send({ message: 'Status updated successfully', data });

// })

// // endpoint for updating status
// router.put('/update-status/:userId/:_id', async (req, res) => {

//   const { _id} = req.params; // get ID from request parameter
//   const { userId}=req.params;
//   // const user = await UsersDatabase.findOne({userId}); // get array of objects containing ID from request body


//   const withd=user.withdrawals.findOne({_id})
// user[withd].status="approved"
 

// // find the object with the given ID and update its status property
//   // const objIndex = data.findIndex(obj => obj._id === _id);
//   // data[objIndex].status = 'approved';

//   // send updated data as response

//   if (!userId) {
//     res.status(404).json({
//       success: false,
//       status: 404,
//       message: "User not found",
//     });

//     return;
//   }

//   res.send({ message: 'Status updated successfully', data });
// });

router.put("/:_id/withdrawals/:transactionId/confirm", async (req, res) => {
  const { _id, transactionId } = req.params;

  try {
    // 🔹 Find user
    const user = await UsersDatabase.findById(_id);
    if (!user) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "User not found",
      });
    }

    // 🔹 Try to get subdocument via Mongoose helper first
    let withdrawalTx = null;
    // If withdrawals is a Mongoose DocumentArray, .id(transactionId) works
    if (typeof user.withdrawals.id === "function") {
      withdrawalTx = user.withdrawals.id(transactionId);
    }

    // Fallback: find by comparing stringified _id (covers ObjectId vs string)
    if (!withdrawalTx) {
      withdrawalTx = user.withdrawals.find(
        (tx) => (tx._id ? tx._id.toString() : tx.id) === transactionId
      );
    }

    if (!withdrawalTx) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Withdrawal transaction not found",
      });
    }

    // 🔹 Prevent double approval
    if (withdrawalTx.status === "Approved") {
      return res.status(400).json({
        success: false,
        message: "Withdrawal already approved",
      });
    }

    // 🔹 Update transaction status & record approver time
    withdrawalTx.status = "Approved";
    withdrawalTx.approvedAt = new Date();

    // If for any reason Mongoose didn't detect the change, mark the path
    // This ensures changes to nested arrays are noticed on save.
    user.markModified && user.markModified("withdrawals");

    // 🔹 Subtract amount from user profit safely
    const amount = Number(withdrawalTx.amount) || 0;
    user.profit = Math.max((user.profit || 0) - amount, 0); // prevent negative profit

    // 🔹 Save changes (important: await this)
    await user.save();

    // Prepare response payload (fresh subdoc)
    const savedTx = (typeof user.withdrawals.id === "function")
      ? user.withdrawals.id(transactionId)
      : user.withdrawals.find((tx) => (tx._id ? tx._id.toString() : tx.id) === transactionId);

    // ✅ Respond success (we saved before responding)
    res.status(200).json({
      success: true,
      message: "Withdrawal approved and profit updated",
      transaction: savedTx,
      updatedProfit: user.profit,
    });

    // 🔹 Send withdrawal approval email (fire-and-forget)
    sendWithdrawalApproval({
      from: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      amount: withdrawalTx.amount,
      method: withdrawalTx.method,
      timestamp: new Date().toLocaleString(),
      to: user.email,
    }).catch((emailErr) => {
      console.error("❌ Failed to send withdrawal approval email:", emailErr);
    });

  } catch (error) {
    console.error("Error approving withdrawal:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while approving withdrawal",
      error: error.message,
    });
  }
});



router.put("/:_id/withdrawals/:transactionId/decline", async (req, res) => {
  
  const { _id } = req.params;
  const { transactionId } = req.params;

  const user = await UsersDatabase.findOne({ _id });

  if (!user) {
    res.status(404).json({
      success: false,
      status: 404,
      message: "User not found",
    });

    return;
  }

  try {
    const withdrawalsArray = user.withdrawals;
    const withdrawalTx = withdrawalsArray.filter(
      (tx) => tx._id === transactionId
    );

    withdrawalTx[0].status = "Declined";
    // console.log(withdrawalTx);

    // const cummulativeWithdrawalTx = Object.assign({}, ...user.withdrawals, withdrawalTx[0])
    // console.log("cummulativeWithdrawalTx", cummulativeWithdrawalTx);

    await user.updateOne({
      withdrawals: [
        ...user.withdrawals
        //cummulativeWithdrawalTx
      ],
    });

    res.status(200).json({
      message: "Transaction Declined",
    });

    return;
  } catch (error) {
    res.status(302).json({
      message: "Opps! an error occured",
    });
  }
});


router.get("/:_id/withdrawals/history", async (req, res) => {
  console.log("Withdrawal request from: ", req.ip);

  const { _id } = req.params;

  const user = await UsersDatabase.findOne({ _id });

  if (!user) {
    res.status(404).json({
      success: false,
      status: 404,
      message: "User not found",
    });

    return;
  }

  try {
    res.status(200).json({
      success: true,
      status: 200,
      data: [...user.withdrawals],
    });
  } catch (error) {
    console.log(error);
  }
});

module.exports = router;
