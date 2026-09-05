// Copies the pre-built Swiper/LightGallery CSS+JS we use on the car-details pages out of
// node_modules and into public/vendor, self-hosted instead of pulled from cdn.jsdelivr.net.
// Re-run after bumping the swiper/lightgallery versions in package.json.
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const cssnano = require('cssnano');

const root = path.join(__dirname, '..');
const nodeModules = path.join(root, 'node_modules');
const vendorDir = path.join(root, 'public', 'vendor');

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`copied ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from)) {
    copyFile(path.join(from, entry), path.join(to, entry));
  }
}

async function minifyCss(from, to) {
  const source = fs.readFileSync(from, 'utf8');
  const result = await postcss([cssnano({ preset: 'default' })]).process(source, { from, to });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, result.css);
  console.log(`minified ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}

async function main() {
  // Swiper already ships pre-minified builds of exactly the pieces we use.
  const swiperSrc = path.join(nodeModules, 'swiper');
  const swiperDest = path.join(vendorDir, 'swiper');
  copyFile(path.join(swiperSrc, 'swiper.min.css'), path.join(swiperDest, 'swiper.min.css'));
  copyFile(path.join(swiperSrc, 'modules', 'navigation.min.css'), path.join(swiperDest, 'navigation.min.css'));
  copyFile(path.join(swiperSrc, 'modules', 'free-mode.min.css'), path.join(swiperDest, 'free-mode.min.css'));
  copyFile(path.join(swiperSrc, 'modules', 'pagination.min.css'), path.join(swiperDest, 'pagination.min.css'));

  // JS is pulled as native ES modules instead of swiper-bundle.min.js so the page only
  // downloads the core plus the Navigation/FreeMode/Thumbs/Pagination modules the car-details pages
  // actually uses, rather than every module Swiper ships (~155KB in the all-in-one bundle).
  copyFile(path.join(swiperSrc, 'swiper.min.mjs'), path.join(swiperDest, 'swiper.min.mjs'));
  copyFile(path.join(swiperSrc, 'modules', 'navigation.min.mjs'), path.join(swiperDest, 'modules', 'navigation.min.mjs'));
  copyFile(path.join(swiperSrc, 'modules', 'free-mode.min.mjs'), path.join(swiperDest, 'modules', 'free-mode.min.mjs'));
  copyFile(path.join(swiperSrc, 'modules', 'thumbs.min.mjs'), path.join(swiperDest, 'modules', 'thumbs.min.mjs'));
  copyFile(path.join(swiperSrc, 'modules', 'pagination.min.mjs'), path.join(swiperDest, 'modules', 'pagination.min.mjs'));
  // Shared chunks imported by the core and the modules above via relative "../shared/..." paths.
  const swiperSharedFiles = [
    'swiper-core.min.mjs',
    'ssr-window.esm.min.mjs',
    'utils.min.mjs',
    'create-element-if-not-defined.min.mjs',
    'classes-to-selector.min.mjs',
  ];
  for (const file of swiperSharedFiles) {
    copyFile(path.join(swiperSrc, 'shared', file), path.join(swiperDest, 'shared', file));
  }

  // LightGallery only ships a minified JS bundle; the individual plugin CSS files are
  // unminified in the package, so we minify them ourselves on the way out.
  const lgSrc = path.join(nodeModules, 'lightgallery');
  const lgDest = path.join(vendorDir, 'lightgallery');
  await minifyCss(path.join(lgSrc, 'css', 'lightgallery.css'), path.join(lgDest, 'css', 'lightgallery.min.css'));
  await minifyCss(path.join(lgSrc, 'css', 'lg-zoom.css'), path.join(lgDest, 'css', 'lg-zoom.min.css'));
  await minifyCss(path.join(lgSrc, 'css', 'lg-thumbnail.css'), path.join(lgDest, 'css', 'lg-thumbnail.min.css'));
  copyFile(path.join(lgSrc, 'lightgallery.min.js'), path.join(lgDest, 'lightgallery.min.js'));
  copyFile(path.join(lgSrc, 'plugins', 'zoom', 'lg-zoom.min.js'), path.join(lgDest, 'plugins', 'zoom', 'lg-zoom.min.js'));
  copyFile(path.join(lgSrc, 'plugins', 'thumbnail', 'lg-thumbnail.min.js'), path.join(lgDest, 'plugins', 'thumbnail', 'lg-thumbnail.min.js'));
  // lightgallery.css references these via relative `../fonts/` and `../images/` urls.
  copyDir(path.join(lgSrc, 'fonts'), path.join(lgDest, 'fonts'));
  copyDir(path.join(lgSrc, 'images'), path.join(lgDest, 'images'));
}

main().catch((error) => {
  console.error('Unable to sync vendor assets:', error.message);
  process.exitCode = 1;
});
