const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  message: { type: String },
  car: { type: String },
  carId: { type: mongoose.Schema.Types.ObjectId, ref: 'Car' },
  carSlug: { type: String },
  sourceType: { type: String, enum: ['landing', 'car', 'vehicle-lookup', 'contact', 'unknown'], default: 'unknown' },
  sourceSlug: { type: String },
  status: { type: String, enum: ['new', 'contacted', 'qualified', 'in progress', 'won', 'lost', 'archived'], default: 'new' },
  notes: { type: String, default: '' },
  followUpAt: { type: Date },
  lastContactedAt: { type: Date },
  date: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

module.exports = mongoose.model("Lead", leadSchema);