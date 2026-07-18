const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  car: { type: String },
  date: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

module.exports = mongoose.model("Lead", leadSchema);