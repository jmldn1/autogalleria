const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');
const https = require('https');
const multer = require('multer');
const Landing = require('../models/Landing');
const Car = require('../models/Car');
const Blog = require('../models/Blog');
const PageView = require('../models/PageView');
const { processImage, buildImageManifest, SIZES } = require('../utils/imageService');
const slugify = require('slugify');
const generateUniqueSlug = require('../utils/slugifyUnique');

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

async function openaiChatCompletion(body) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return reject(new Error('Missing OPENAI_API_KEY'));

    const requestBody = JSON.stringify(body);
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
        Authorization: `Bearer ${apiKey}`
      }
    };

    const req = https.request(options, (res) => {
      let buffer = '';
      res.on('data', chunk => buffer += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`OpenAI error ${res.statusCode}: ${buffer}`));
        }
        try {
          const payload = JSON.parse(buffer);
          resolve(payload);
        } catch (err) {
          reject(new Error('Failed to parse OpenAI response'));
        }
      });
    });

    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

function parseOpenAIJson(text) {
  const jsonBlock = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const raw = jsonBlock ? jsonBlock[1].trim() : text.trim();
  try {
    return JSON.parse(raw);
  } catch (err) {
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
      } catch (err2) {
        return null;
      }
    }
    return null;
  }
}

async function generateLandingCopy(make, model) {
  const modelName = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
  const prompt = `You are a friendly marketing copywriter for a used car buying service. Generate a JSON object only, with the following keys: overview, valueFactors, sellingTips, metaDescription. Each value should be short, readable, and persuasive for a landing page about selling a ${make} ${model}. Do not include extra text outside the JSON.

Example output:
{
  "overview": "...",
  "valueFactors": "...",
  "sellingTips": "...",
  "metaDescription": "..."
}`;

  const response = await openaiChatCompletion({
    model: modelName,
    messages: [
      { role: 'system', content: 'You are a helpful copywriter for web landing pages.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.65,
    max_tokens: 400
  });

  const text = response.choices?.[0]?.message?.content || '';
  const parsed = parseOpenAIJson(text);
  if (!parsed) {
    throw new Error('Unable to parse AI response as JSON');
  }

  return {
    overview: parsed.overview || '',
    valueFactors: parsed.valueFactors || '',
    sellingTips: parsed.sellingTips || '',
    metaDescription: parsed.metaDescription || ''
  };
}

// ---------------------- DASHBOARD ----------------------
router.get('/dashboard', isAdmin, async (req, res) => {
  try {
    const Lead = require('../models/Lead');

    const leads = await Lead.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const totalLeads = await Lead.countDocuments();
    const totalCars = await Car.countDocuments();
    const totalBlogs = await Blog.countDocuments();
    const totalPageViews = await PageView.countDocuments();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const topPages = await PageView.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: '$path', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    const heatmap = await PageView.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $project: {
          hour: { $hour: { date: '$createdAt', timezone: 'Europe/London' } },
          dayOfWeek: { $dayOfWeek: { date: '$createdAt', timezone: 'Europe/London' } }
        }
      },
      {
        $group: {
          _id: { hour: '$hour', dayOfWeek: '$dayOfWeek' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.dayOfWeek': 1, '_id.hour': 1 } }
    ]);

    const heatmapPoints = heatmap.map(item => ({
      hour: item._id.hour,
      dayIndex: item._id.dayOfWeek - 1,
      count: item.count
    }));

    res.render('admin/dashboard', {
      user: req.user,
      leads,
      metrics: {
        totalLeads,
        totalCars,
        totalBlogs,
        totalPageViews
      },
      topPages: topPages.map(item => ({ path: item._id, count: item.count })),
      heatmap: heatmapPoints,
      heatmapRangeLabel: 'Last 7 days'
    });

  } catch (err) {
    console.error(err);

    res.render('admin/dashboard', {
      user: req.user,
      leads: [],
      metrics: {
        totalLeads: 0,
        totalCars: 0,
        totalBlogs: 0,
        totalPageViews: 0
      },
      topPages: [],
      heatmap: [],
      heatmapRangeLabel: 'Last 7 days'
    });
  }
});

// ---------------------- LANDINGS ----------------------
router.get('/landings', isAdmin, async (req, res) => {
  const landings = await Landing.find().sort({ createdAt: -1 });

  const pageViewCounts = await PageView.aggregate([
    { $match: { path: { $regex: '^/sell-your-' } } },
    { $group: { _id: '$path', views: { $sum: 1 } } }
  ]);

  const viewCountMap = Object.fromEntries(
    pageViewCounts.map(({ _id, views }) => [_id, views])
  );

  const landingsWithViews = landings.map((landing) => ({
    ...landing.toObject(),
    views: viewCountMap[`/sell-your-${landing.slug}`] || 0
  }));

  res.render('admin/landings', { user: req.user, landings: landingsWithViews });
});

router.get('/landing/new', isAdmin, (req, res) => {
  res.render('admin/landing', { user: req.user, landing: {} });
});

router.post('/landing', isAdmin, upload.single('image'), async (req, res) => {
  try {
    const requestedSlug = (req.body.slug || '').trim();
    const slugSource = requestedSlug || [req.body.make, req.body.model].filter(Boolean).join(' ') || 'landing';

    const landingData = {
      ...req.body,
      slug: await generateUniqueSlug(slugSource, Landing)
    };

    const landing = new Landing(landingData);
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

    const requestedSlug = (req.body.slug || '').trim();
    if (requestedSlug) {
      landing.slug = await generateUniqueSlug(requestedSlug, Landing, { excludeId: landing._id });
    } else if (!landing.slug) {
      const slugSource = [req.body.make, req.body.model].filter(Boolean).join(' ') || 'landing';
      landing.slug = await generateUniqueSlug(slugSource, Landing, { excludeId: landing._id });
    }

    Object.assign(landing, req.body, { slug: landing.slug });

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

router.post('/landing/generate-copy', isAdmin, async (req, res) => {
  try {
    const { make, model } = req.body;
    if (!make || !model) {
      return res.status(400).json({ error: 'Make and model are required.' });
    }

    const copy = await generateLandingCopy(make, model);
    return res.json(copy);
  } catch (err) {
    console.error('Landing AI generate error:', err);
    return res.status(500).json({ error: err.message || 'AI generation failed.' });
  }
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

      const existingImages = req.body.existingImages ? JSON.parse(req.body.existingImages) : (car.galleryImages || []);
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
  res.render('admin/blogs', { 
    user: req.user,
    blogs 
  });
});

router.get('/blogs/new', isAdmin, (req, res) => {
  res.render('admin/add-blog', {
    user: req.user
  });
});

router.post('/blogs', isAdmin, async (req, res) => {
  await Blog.create(req.body);
  res.redirect('/admin/blogs');
});

router.get('/blogs/edit/:id', isAdmin, async (req, res) => {
  const blog = await Blog.findById(req.params.id);
  res.render('admin/edit-blog', {
    user: req.user,
    blog
  });
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