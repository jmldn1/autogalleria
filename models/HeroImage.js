const mongoose = require('mongoose');

const heroImageSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  alt: { type: String, trim: true },
  imagePath: String,
  placeholder: String,
  manifest: {
    base: String,
    sources: {
      jpg: [{ w: Number, h: Number, url: String }],
      webp: [{ w: Number, h: Number, url: String }],
      avif: [{ w: Number, h: Number, url: String }],
    },
  },
}, { timestamps: true });

module.exports = mongoose.model('HeroImage', heroImageSchema);