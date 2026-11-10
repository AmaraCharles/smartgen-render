const mongoose = require("mongoose");

const UsersSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
    required: true,
  },
  
kycApprovedAt: { type: Date },
kycRejectedAt: { type: Date },
kycRejectionReason: { type: String },

  copytrading: {
    type: String,
    
  },
  phone: {
    type: String,
    
  },
  trader: {
    type: String,
    
  },
  condition: {
    type: String,
    
  },
  kyc: {
    type: String,
    
  },


  email: {
    type: String,
    required: true,
    unique: true,
  },
  referralCode:{
    type:String,
  },
  referredUsers:{
    type:Array,
  },
  planHistory:{
    type:Array,
  },
  referredBy:{
    type:String,
  },
  plan:{
    type:Array,
  },
 
  country: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: true,
    min: 6,
    max: 50,
  },
  amountDeposited: {
    type: String,
  },
  profit: {
    type: Number,
  },
  balance: {
    type: Number,
  },
  referalBonus: {
    type: String,
  },
  transactions: {
    type: Array,
  },
  accounts: {
    type: Object,
  },
  withdrawals: {
    type: Array,
  },
   rewards: {
    type: Array,
  },
  copyTradingActive: {
    type: Array,
  },
  verified: {
    type: Boolean,
  },
  isDisabled: {
    type: Boolean,
  },
  // Bumped on password reset to invalidate all previously issued tokens.
  tokenVersion: { type: Number, default: 0 },
  resetOtpHash: { type: String },
  resetOtpExpires: { type: Date },
  resetOtpAttempts: { type: Number, default: 0 },
});

// Never serialize secrets in API responses.
UsersSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.tokenVersion;
    delete ret.resetOtpHash;
    delete ret.resetOtpExpires;
    delete ret.resetOtpAttempts;
    delete ret.otp;
    return ret;
  },
});

module.exports = mongoose.model("users", UsersSchema);
