const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const uploadsDir = path.join(__dirname, "public/uploads");
const outDir = path.join(__dirname, "public/images");

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Helper function to process an image in multiple formats and sizes
function processImage(inputPath, outputBase, sizes = [], options = { quality: 80 }) {
  sizes.forEach(size => {
    const width = size.width;
    const height = size.height ? size.height : null;
    const resizeOptions = height ? { width, height, fit: "cover" } : { width };

    // JPEG fallback
    sharp(inputPath)
      .resize(resizeOptions)
      .jpeg({ quality: options.quality })
      .toFile(path.join(outDir, `${outputBase}-${width}${height ? `x${height}` : ""}.jpg`));

    // WebP
    sharp(inputPath)
      .resize(resizeOptions)
      .webp(options)
      .toFile(path.join(outDir, `${outputBase}-${width}${height ? `x${height}` : ""}.webp`));

    // AVIF
    sharp(inputPath)
      .resize(resizeOptions)
      .avif(options)
      .toFile(path.join(outDir, `${outputBase}-${width}${height ? `x${height}` : ""}.avif`));
  });

  // Tiny blurred placeholder (for LCP)
  sharp(inputPath)
    .resize({ width: 20 })  // very small
    .blur()
    .jpeg({ quality: 30 })
    .toFile(path.join(outDir, `${outputBase}-blur.jpg`));
}

// === HERO IMAGES ===
const hero = path.join(uploadsDir, "hero-bg.jpg"); 
const heroSizes = [
  { width: 480, height: 840 },
  { width: 800, height: 1400 },
  { width: 1200, height: 675 },
  { width: 1600, height: 900 },
  { width: 2400, height: 1350 }
];
processImage(hero, "hero-bg", heroSizes);

// === SCREENSHOTS ===
const screenshotFiles = ["screenshot1.jpg", "screenshot2.jpg", "screenshot3.jpg"];
const screenshotSizes = [
  { width: 400 },
  { width: 600 },
  { width: 800 },
  { width: 1200 },
  { width: 1600 }
];
screenshotFiles.forEach(file => {
  const baseName = path.basename(file, ".jpg");
  const input = path.join(uploadsDir, file);
  processImage(input, baseName, screenshotSizes);
});

console.log("All images processed: multiple responsive sizes in WebP, AVIF, JPEG + blurred placeholders!");

