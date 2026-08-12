const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const uploadsDir = path.join(__dirname, "public/uploads");
const outDir = path.join(__dirname, "public/images");

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Helper function to process an image in multiple formats and sizes
async function processImage(inputPath, outputBase, sizes = [], options = { quality: 80 }) {
  const tasks = [];

  sizes.forEach(size => {
    const width = size.width;
    const height = size.height ? size.height : null;
    const resizeOptions = height ? { width, height, fit: "cover" } : { width };

    // JPEG fallback
    tasks.push(
      sharp(inputPath)
        .resize(resizeOptions)
        .jpeg({ quality: options.quality })
        .toFile(path.join(outDir, `${outputBase}-${width}${height ? `x${height}` : ""}.jpg`))
    );

    // WebP
    tasks.push(
      sharp(inputPath)
        .resize(resizeOptions)
        .webp(options)
        .toFile(path.join(outDir, `${outputBase}-${width}${height ? `x${height}` : ""}.webp`))
    );

    // AVIF
    tasks.push(
      sharp(inputPath)
        .resize(resizeOptions)
        .avif(options)
        .toFile(path.join(outDir, `${outputBase}-${width}${height ? `x${height}` : ""}.avif`))
    );
  });

  // Tiny blurred placeholder (for LCP)
  tasks.push(
    sharp(inputPath)
      .resize({ width: 20 })
      .blur()
      .jpeg({ quality: 30 })
      .toFile(path.join(outDir, `${outputBase}-blur.jpg`))
  );

  await Promise.all(tasks);
}

function deleteUpload(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Deleted source upload: ${path.basename(filePath)}`);
  }
}

async function run() {
  // === HERO IMAGES ===
  const hero = path.join(uploadsDir, "hero-bg.jpg");
  const heroSizes = [
    { width: 480, height: 840 },
    { width: 800, height: 450 },
    { width: 800, height: 1400 },
    { width: 1200, height: 675 },
    { width: 1600, height: 900 },
    { width: 2400, height: 1350 }
  ];

  // === MOCKUP IMAGES ===
  // Naming convention in public/uploads:
  // - pc-mockup-<variant>.jpg   (example: pc-mockup-a.jpg)
  // - phone-mockup-<variant>.jpg (example: phone-mockup-a.jpg)
  const pcMockupSizes = [
    { width: 800, height: 450 },
    { width: 1200, height: 675 },
    { width: 1600, height: 900 }
  ];
  const phoneMockupSizes = [
    { width: 480, height: 840 },
    { width: 800, height: 1400 }
  ];

  // === SCREENSHOTS ===
  const screenshotFiles = ["screenshot1.jpg", "screenshot2.jpg", "screenshot3.jpg"];
  const screenshotSizes = [
    { width: 400 },
    { width: 600 },
    { width: 800 },
    { width: 1200 },
    { width: 1600 }
  ];

  const sourcesToDelete = [];

  if (fs.existsSync(hero)) {
    await processImage(hero, "hero-bg", heroSizes);
    sourcesToDelete.push(hero);
  } else {
    console.warn("Hero source not found: public/uploads/hero-bg.jpg");
  }

  const uploadFiles = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
  const pcMockupVariants = uploadFiles
    .map((name) => {
      const match = name.match(/^pc-mockup-(.+)\.jpg$/i);
      return match ? match[1] : null;
    })
    .filter(Boolean);

  for (const variant of pcMockupVariants) {
    const pcFile = `pc-mockup-${variant}.jpg`;
    const phoneFile = `phone-mockup-${variant}.jpg`;
    const pcInput = path.join(uploadsDir, pcFile);
    const phoneInput = path.join(uploadsDir, phoneFile);

    await processImage(pcInput, `pc-mockup-${variant}`, pcMockupSizes);
    sourcesToDelete.push(pcInput);

    if (fs.existsSync(phoneInput)) {
      await processImage(phoneInput, `phone-mockup-${variant}`, phoneMockupSizes);
      sourcesToDelete.push(phoneInput);
    } else {
      console.warn(`Phone mockup source not found for variant "${variant}": public/uploads/${phoneFile}`);
    }
  }

  for (const file of screenshotFiles) {
    const baseName = path.basename(file, ".jpg");
    const input = path.join(uploadsDir, file);

    if (!fs.existsSync(input)) {
      console.warn(`Screenshot source not found: public/uploads/${file}`);
      continue;
    }

    await processImage(input, baseName, screenshotSizes);
    sourcesToDelete.push(input);
  }

  sourcesToDelete.forEach(deleteUpload);

  console.log("All images processed: multiple responsive sizes in WebP, AVIF, JPEG + blurred placeholders.");
}

run().catch((err) => {
  console.error("Image processing failed:", err);
  process.exitCode = 1;
});

