const mongoose = require('mongoose');

const LandingSchema = new mongoose.Schema(
  {
    pageType: { type: String, enum: ['landing', 'car', 'blog'], default: 'landing' },
    make: String,
    model: String,
    slug: { type: String, required: true, unique: true },
    description: String,
    imagePath: String,          // base folder for images
    placeholder: String,        // tiny base64 preview
    imageManifest: {            // structured image variants
      base: String,
      sources: {
        avif: [{ w: Number, h: Number, url: String }],
        webp: [{ w: Number, h: Number, url: String }],
        jpg: [{ w: Number, h: Number, url: String }]
      }
    }
  },
  { timestamps: true } // ✅ adds createdAt and updatedAt automatically
);

module.exports = mongoose.model('Landing', LandingSchema);
