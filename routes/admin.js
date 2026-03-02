const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Landing = require('../models/Landing');
const Car = require('../models/Car');
const Blog = require('../models/Blog');
const { processImage, buildImageManifest, SIZES } = require('../utils/imageService');
const slugify = require('slugify');

// ---------------------- MULTER SETUP ----------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ---------------------- HELPERS ----------------------
async function handleImageUpload(file, folder, prefix, sizes) {
  if (!file) return null;

  const outDir = path.join('public/images', folder);
  fs.mkdirSync(outDir, { recursive: true });

  // Remove old files (optional: only if replacing all images in folder)
  fs.readdirSync(outDir).forEach(f => fs.unlinkSync(path.join(outDir, f)));

  const result = await processImage(file.path, outDir, prefix, sizes);
  fs.unlinkSync(file.path); // Remove original

  const publicBaseURL = `${process.env.PUBLIC_IMAGE_PATH || '/images'}/${folder}`;
  const manifest = buildImageManifest(publicBaseURL, prefix, sizes);
  if (!manifest.sources.avif[0].url.startsWith('/images')) {
    throw new Error('Generated URL is not web-accessible');
  }

  return {
    imagePath: `${publicBaseURL}/${prefix}`,
    placeholder: result.placeholder,
    imageManifest: manifest,
    variantsCount: result.variants.length
  };
}

async function handleMultipleImageUploads(files, folder, sizes) {
  if (!files || files.length === 0) return [];

  const outDir = path.join('public/images', folder);
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];
  for (const file of files) {
    const prefix = path.parse(file.filename).name;
    const result = await processImage(file.path, outDir, prefix, sizes);
    fs.unlinkSync(file.path);

    const publicBaseURL = `${process.env.PUBLIC_IMAGE_PATH || '/images'}/${folder}`;
    const manifest = buildImageManifest(publicBaseURL, prefix, sizes);

    if (!manifest.sources.avif[0].url.startsWith('/images')) {
      throw new Error('Generated URL is not web-accessible');
    }

    results.push({
      imagePath: `${publicBaseURL}/${prefix}`,
      placeholder: result.placeholder,
      imageManifest: manifest,
      variantsCount: result.variants.length,
      alt: 'Car image' // Extend form for per-image alt if needed
    });
  }

  return results;
}

// ---------------------- DASHBOARD ----------------------
router.get('/dashboard', isAdmin, (req, res) => {
  res.render('admin/dashboard', { user: req.user });
});

// ---------------------- LANDINGS ----------------------
router.get('/landings', isAdmin, async (req, res) => {
  const landings = await Landing.find().sort({ createdAt: -1 });
  res.render('admin/landings', { user: req.user, landings });
});

router.get('/landing/new', isAdmin, (req, res) => {
  res.render('admin/landing', { user: req.user, landing: {} });
});

router.post('/landing', isAdmin, upload.single('image'), async (req, res) => {
  try {
    const landing = new Landing(req.body);
    await landing.save();

    if (req.file) {
      const imgData = await handleImageUpload(req.file, `landing/${landing._id}`, 'hero', SIZES.hero);
      Object.assign(landing, imgData);
      await landing.save();
      console.log(`Landing image processed (${imgData.variantsCount} variants)`);
    }

    res.redirect('/admin/landings');
  } catch (err) {
    console.error('Create landing error:', err);
    res.redirect('/admin/landing/new');
  }
});

router.get('/landing/:id/edit', isAdmin, async (req, res) => {
  const landing = await Landing.findById(req.params.id);
  if (!landing) return res.redirect('/admin/landings');
  res.render('admin/landing', { user: req.user, landing });
});

router.post('/landing/:id', isAdmin, upload.single('image'), async (req, res) => {
  try {
    const landing = await Landing.findById(req.params.id);
    if (!landing) return res.redirect('/admin/landings');

    Object.assign(landing, req.body);

    if (req.file) {
      const imgData = await handleImageUpload(req.file, `landing/${landing._id}`, 'hero', SIZES.hero);
      Object.assign(landing, imgData);
      console.log(`Landing image updated (${imgData.variantsCount} variants)`);
    }

    await landing.save();
    res.redirect('/admin/landings');
  } catch (err) {
    console.error('Update landing error:', err);
    res.redirect(`/admin/landing/${req.params.id}/edit`);
  }
});

router.post('/landing/:id/delete', isAdmin, async (req, res) => {
  await Landing.findByIdAndDelete(req.params.id);
  res.redirect('/admin/landings');
});

// ---------------------- CARS ----------------------
router.get('/cars', isAdmin, async (req, res) => {
  const cars = await Car.find().sort({ createdAt: -1 });
  res.render('admin/cars', { user: req.user, cars });
});

router.get('/cars/new', isAdmin, (req, res) => {
  res.render('admin/car-form', { user: req.user, car: {}, action: '/admin/cars', method: 'POST' });
});

router.post(
  '/cars',
  isAdmin,
  upload.fields([{ name: 'galleryImages', maxCount: 20 }]),
  async (req, res) => {
    try {
      console.log('Received car form submission');

      // Auto-generate a unique, SEO-friendly slug
      let baseSlug = slugify(`${req.body.make} ${req.body.model} ${req.body.year}`, { lower: true, strict: true });
      let slug = baseSlug;
      let counter = 1;
      while (await Car.findOne({ slug })) {
        slug = `${baseSlug}-${counter++}`;
      }

      const galleryImages = await handleMultipleImageUploads(req.files.galleryImages || [], '', SIZES.car);

      const carData = {
        ...req.body,
        slug,
        galleryImages: galleryImages.map(img => ({
          placeholder: img.placeholder,
          manifest: img.imageManifest,
          fallback: img.imageManifest.sources.jpg[img.imageManifest.sources.jpg.length - 1].url,
          alt: img.alt
        }))
      };

      console.log('Saving car to DB');
      await Car.create(carData);
      console.log('Car saved!');
      res.redirect('/admin/cars');
    } catch (err) {
      console.error('❌ Create car error:', err);
      res.status(500).send('Error creating car');
    }
  }
);

router.get('/cars/:id/edit', isAdmin, async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (!car) return res.redirect('/admin/cars');
  res.render('admin/car-form', { user: req.user, car, action: `/admin/cars/${car._id}`, method: 'POST' });
});

router.post(
  '/cars/:id',
  isAdmin,
  upload.fields([{ name: 'galleryImages', maxCount: 20 }]),
  async (req, res) => {
    try {
      const car = await Car.findById(req.params.id);
      if (!car) return res.redirect('/admin/cars');

      const existingImages = req.body.existingImages ? JSON.parse(req.body.existingImages) : [];
      const newImages = await handleMultipleImageUploads(req.files.galleryImages || [], '', SIZES.car);

      const galleryImages = [
        ...existingImages,
        ...newImages.map(img => ({
          placeholder: img.placeholder,
          manifest: img.imageManifest,
          fallback: img.imageManifest.sources.jpg[img.imageManifest.sources.jpg.length - 1].url,
          alt: img.alt
        }))
      ];

      const carData = {
        ...req.body,
        galleryImages
      };

      await Car.findByIdAndUpdate(req.params.id, carData);
      console.log('Car updated!');
      res.redirect('/admin/cars');
    } catch (err) {
      console.error('❌ Update car error:', err);
      res.status(500).send('Error updating car');
    }
  }
);

router.post('/cars/:id/delete', isAdmin, async (req, res) => {
  await Car.findByIdAndDelete(req.params.id);
  res.redirect('/admin/cars');
});

// ---------------------- BLOGS ----------------------
router.get('/blogs', isAdmin, async (req, res) => {
  const blogs = await Blog.find().sort({ createdAt: -1 });
  res.render('admin/blogs', { blogs });
});

router.get('/blogs/new', isAdmin, (req, res) => {
  res.render('admin/add-blog');
});

router.post('/blogs', isAdmin, async (req, res) => {
  await Blog.create(req.body);
  res.redirect('/admin/blogs');
});

router.get('/blogs/edit/:id', isAdmin, async (req, res) => {
  const blog = await Blog.findById(req.params.id);
  res.render('admin/edit-blog', { blog });
});

router.post('/blogs/edit/:id', isAdmin, async (req, res) => {
  await Blog.findByIdAndUpdate(req.params.id, req.body);
  res.redirect('/admin/blogs');
});

router.post('/blogs/delete/:id', isAdmin, async (req, res) => {
  await Blog.findByIdAndDelete(req.params.id);
  res.redirect('/admin/blogs');
});

module.exports = router; // Export the router