const mongoose = require('mongoose');
const generateUniqueSlug = require('../utils/slugifyUnique');

const LandingSchema = new mongoose.Schema(
{
  pageType: {
    type: String,
    enum: ['landing', 'car', 'blog'],
    default: 'landing'
  },

  make: String,
  model: String,

  slug: {
    type: String,
    required: true,
    unique: true
  },

  description: String,
  metaDescription: String,
  heroAltText: String,

  // Body copy
  overview: String,
  valueFactors: String,
  sellingTips: String,

  imagePath: String,       // base folder for images
  placeholder: String,     // tiny base64 preview

  imageManifest: {
    base: String,
    sources: {
      avif: [{ w: Number, h: Number, url: String }],
      webp: [{ w: Number, h: Number, url: String }],
      jpg: [{ w: Number, h: Number, url: String }]
    }
  }

},
{
  timestamps: true
}
);

LandingSchema.pre('save', async function(next) {
  try {
    const source = (this.slug || [this.make, this.model].filter(Boolean).join(' ') || 'landing').toString().trim();

    if (!this.slug || this.isModified('slug')) {
      this.slug = await generateUniqueSlug(source, this.constructor, { excludeId: this._id });
    } else {
      const existing = await this.constructor.findOne({ slug: this.slug, _id: { $ne: this._id } });
      if (existing) {
        this.slug = await generateUniqueSlug(source, this.constructor, { excludeId: this._id });
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model('Landing', LandingSchema);