const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const FORMATS = {
  jpg: (q) => ({ jpeg: { quality: q } }),
  webp: (q) => ({ webp: { quality: q } }),
  avif: (q) => ({ avif: { quality: q } })
};

const SIZES = {
  hero: [
    { width: 480, height: 840 },
    { width: 800, height: 1400 },
    { width: 1200, height: 675 },
    { width: 1600, height: 900 },
    { width: 2400, height: 1350 },
  ],
  screenshot: [
    { width: 400 },
    { width: 600 },
    { width: 800 },
    { width: 1200 },
    { width: 1600 },
  ],
  car: [
    { width: 300, height: 225 }, // Small, 4:3 aspect ratio
    { width: 600, height: 450 }, // Medium
    { width: 1200, height: 900 }, // Large
  ],
};

function ensureDir(outDir) {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
}

async function makePlaceholder(inputBuffer, format = "jpg") {
  const buf = await sharp(inputBuffer)
    .resize(24)
    .toFormat(format, { quality: 40 })
    .toBuffer();
  return `data:image/${format};base64,${buf.toString("base64")}`;
}

async function processImage(
  input,
  outDir,
  baseName,
  sizes,
  quality = { jpg: 80, webp: 80, avif: 50 }
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
        const outPath = path.join(
          outDir,
          `${baseName}-${size.width}${size.height ? `x${size.height}` : ""}.${ext}`
        );

        return sharp(inputBuffer)
          .resize(resizeOpts)
          .toFormat(ext, { quality: quality[ext] })
          .toFile(outPath)
          .then(() => ({
            width: size.width,
            height: size.height || null,
            ext,
            path: outPath
          }));
      });
    });

    const results = await Promise.all(tasks);
    return { placeholder, variants: results };
  } catch (err) {
    console.error(`❌ Image processing failed for ${baseName}:`, err);
    throw err;
  }
}

function buildImageManifest(publicBaseURL, baseName, sizes) {
  const buildForExt = (ext) =>
    sizes.map((s) => ({
      w: s.width,
      h: s.height || null,
      url: `${publicBaseURL}/${baseName}-${s.width}${s.height ? `x${s.height}` : ""}.${ext}`
    }));

  return {
    base: baseName,
    sources: Object.keys(FORMATS).reduce((acc, ext) => {
      acc[ext] = buildForExt(ext);
      return acc;
    }, {})
  };
}

module.exports = { processImage, buildImageManifest, SIZES };
