const mongoose = require('mongoose');

const carSchema = new mongoose.Schema({
  make: String,
  model: String,
  year: Number,
  price: Number,
  mileage: Number,
  vin: String,
  condition: String,
  description: String,
  youtubeUrl: String,
  slug: String,
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
      },
      fallback: String,
      alt: String,
    },
  ],
});

const Car = mongoose.model('Car', carSchema);
module.exports = Car;

