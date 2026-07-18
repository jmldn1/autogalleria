const mongoose = require("mongoose");

const blogSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true }, // SEO-friendly URL
  excerpt: { type: String },
  content: { type: String, required: true },
  coverImage: { type: String }, // URL or file path
  imageManifest: { type: Object },
  placeholder: { type: String }
}, { timestamps: true });

module.exports = mongoose.model("Blog", blogSchema);
