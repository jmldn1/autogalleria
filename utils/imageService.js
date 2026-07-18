const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// ✅ Modern formats only
const FORMATS = {
  webp: (q) => ({ quality: q }),
  avif: (q) => ({ quality: q }),
  jpg: (q) => ({ quality: q, mozjpeg: true }),
};

// ✅ Optimised responsive sizes
const SIZES = {
  hero: [
    { width: 800, height: 450 },
    { width: 1200, height: 675 },
    { width: 1600, height: 900 },
  ],
  heroMobile: [
    { width: 480, height: 840 },
    { width: 800, height: 1400 },
  ],
  gallery: [
    { width: 400 },
    { width: 800 },
    { width: 1200 },
  ],
  thumbnail: [
    { width: 200, height: 150 },
    { width: 400, height: 300 },
  ],
car: [
  { width: 150, height: 112 },
  { width: 300, height: 225 },
  { width: 500, height: 375 },
  { width: 600, height: 450 },
  { width: 900, height: 675 },
  { width: 1200, height: 900 },
],
};

// ✅ Tuned quality settings
const DEFAULT_QUALITY = {
  webp: 70,
  avif: 45,
  jpg: 75,
};

// Ensure directory exists
function ensureDir(outDir) {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
}

// ✅ Lightweight blur placeholder (WebP)
async function makePlaceholder(inputBuffer) {
  const buf = await sharp(inputBuffer)
    .resize(24)
    .webp({ quality: 40 })
    .toBuffer();

  return `data:image/webp;base64,${buf.toString("base64")}`;
}

// ✅ Main processing function
async function processImage(
  input,
  outDir,
  baseName,
  sizes,
  quality = DEFAULT_QUALITY
) {
  try {
    ensureDir(outDir);

    const inputBuffer = Buffer.isBuffer(input)
      ? input
      : await fs.promises.readFile(input);

    const placeholder = await makePlaceholder(inputBuffer);

    const tasks = sizes.flatMap((size) => {
      const resizeOpts = size.height
        ? { width: size.width, height: size.height, fit: "cover" }
        : { width: size.width };

      return Object.entries(FORMATS).map(([ext, fn]) => {
        const fileName = `${baseName}-${size.width}${
          size.height ? `x${size.height}` : ""
        }.${ext}`;
        const outPath = path.join(outDir, fileName);

        // ✅ Skip if already exists
        if (fs.existsSync(outPath)) {
          return Promise.resolve({
            width: size.width,
            height: size.height || null,
            ext,
            path: outPath,
          });
        }

        return sharp(inputBuffer)
          .resize(resizeOpts)
          .sharpen()
          .toFormat(ext, fn(quality[ext]))
          .toFile(outPath)
          .then(() => ({
            width: size.width,
            height: size.height || null,
            ext,
            path: outPath,
          }));
      });
    });

    const results = await Promise.all(tasks);

    return {
      placeholder,
      variants: results,
    };
  } catch (err) {
    console.error(`❌ Image processing failed for ${baseName}:`, err);
    throw err;
  }
}

// ✅ Helper to build srcset string
function buildSrcSet(arr) {
  return arr.map((i) => `${i.url} ${i.w}w`).join(", ");
}

// ✅ Manifest builder (perfect for EJS)
function buildImageManifest(publicBaseURL, baseName, sizes) {
  const buildForExt = (ext) =>
    sizes.map((s) => ({
      w: s.width,
      h: s.height || null,
      url: `${publicBaseURL}/${baseName}-${s.width}${
        s.height ? `x${s.height}` : ""
      }.${ext}`,
    }));

  return {
    base: baseName,
    placeholder: null,
    sources: {
      avif: buildForExt("avif"),
      webp: buildForExt("webp"),
      jpg: buildForExt("jpg"),
    },
  };
}

module.exports = {
  processImage,
  buildImageManifest,
  SIZES,
};