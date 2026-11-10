// Core Dependencies
const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

// Route Files
const indexRouter = require("./routes/index");
const usersRouter = require("./routes/users");
const loginAuthRouter = require("./routes/auth/login");
const traderAuthRouter = require("./routes/auth/trader");

const verifyAuthRouter = require("./routes/auth/verify-email");
const registerAuthRouter = require("./routes/auth/register");
const forgotPasswordAuthRouter = require("./routes/auth/forgot-password");
const kycAuthRouter = require("./routes/auth/kyc");
const transactionsRouter = require("./routes/transactions");

const { globalLimiter, mongoSanitize } = require("./middleware/security");

// App Initialization
const app = express();
// Render/Vercel sit behind one proxy; needed so rate limiting sees the real client IP.
app.set("trust proxy", 1);
const PORT = process.env.PORT || 8080;

// Middleware
app.use(logger("dev"));
// CORS_ORIGINS: comma-separated list of allowed frontend origins. Unset = allow all (not recommended).
const corsOrigins = (process.env.CORS_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : {}));
app.use(globalLimiter);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(cookieParser());
app.use(mongoSanitize);

// Routes
app.use("/", indexRouter);
app.use("/users", usersRouter);
app.use("/auth", loginAuthRouter);
app.use("/auth", verifyAuthRouter);
app.use("/auth", registerAuthRouter);
app.use("/auth", forgotPasswordAuthRouter);
app.use("/auth", kycAuthRouter);
app.use("/auth/trader", traderAuthRouter);
app.use("/transactions", transactionsRouter);

// Generic error handler: never leak stack traces to clients.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: "Internal server error" });
});

// Async route errors must not crash the process (that would be a trivial DoS).
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));

// MongoDB Connection
mongoose.set('strictQuery', false);
const dbConnectionString = process.env.DB_CONNECTION_STRING || "";
if (!dbConnectionString) {
  console.error("Error: DB_CONNECTION_STRING environment variable is not set.");
  process.exit(1);
}
mongoose.connect(dbConnectionString, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;

db.on("error", () => console.error("❌ Database connection error"));
db.once("open", () => console.log("✅ Database connected successfully"));

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;
