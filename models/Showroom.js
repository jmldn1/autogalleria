const mongoose = require('mongoose');

const imageManifestSchema = new mongoose.Schema({
  base: String,
  sources: {
    jpg: [{ w: Number, h: Number, url: String }],
    webp: [{ w: Number, h: Number, url: String }],
    avif: [{ w: Number, h: Number, url: String }],
  },
}, { _id: false });

const showroomSchema = new mongoose.Schema({
  heroMode: {
    type: String,
    enum: ['featured-car', 'custom-image'],
    default: 'featured-car',
  },
  heroCar: { type: mongoose.Schema.Types.ObjectId, ref: 'Car', default: null },
  heroImageAsset: { type: mongoose.Schema.Types.ObjectId, ref: 'HeroImage', default: null },
  heroImage: {
    imagePath: String,
    placeholder: String,
    manifest: imageManifestSchema,
    alt: String,
  },
  eyebrow: String,
  heading: String,
  description: String,
  primaryCtaLabel: String,
  primaryCtaUrl: String,
  secondaryCtaLabel: String,
  secondaryCtaUrl: String,
}, { timestamps: true });

module.exports = mongoose.model('Showroom', showroomSchema);