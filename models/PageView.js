const mongoose = require('mongoose');

const pageViewSchema = new mongoose.Schema({
  path: { type: String, required: true },
  referrer: { type: String },
  userAgent: { type: String },
  ip: { type: String }
}, {
  timestamps: true
});

module.exports = mongoose.model('PageView', pageViewSchema);
