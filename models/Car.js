const mongoose = require('mongoose');

const carSchema = new mongoose.Schema({
  make: String,
  model: String,
  year: Number,
  price: Number,
  mileage: Number,
  vin: String,
  condition: String,
  fuelType: String,
  transmission: String,
  description: String,
  youtubeUrl: String,
  slug: { type: String, required: true, unique: true },
  galleryImages: [
    {
      placeholder: String,
      manifest: {
        base: String,
        sources: {
          jpg: [{ w: Number, h: Number, url: String }],
          webp: [{ w: Number, h: Number, url: String }],
          avif: [{ w: Number, h: Number, url: String }],
        },
        // 16:9 renditions cut from the original upload, used by the hero banner.
        heroSources: {
          jpg: [{ w: Number, h: Number, url: String }],
          webp: [{ w: Number, h: Number, url: String }],
          avif: [{ w: Number, h: Number, url: String }],
        },
        // 4:5 renditions cut from the original upload, used by the mobile hero banner.
        heroMobileSources: {
          jpg: [{ w: Number, h: Number, url: String }],
          webp: [{ w: Number, h: Number, url: String }],
          avif: [{ w: Number, h: Number, url: String }],
        },
      },
      fallback: String,
      alt: String,
    },
  ],
});

const Car = mongoose.model('Car', carSchema);
module.exports = Car;

