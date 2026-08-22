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
const Lead = require('../models/Lead');
const { processImage, buildImageManifest, SIZES } = require('../utils/imageService');
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

  const pickLargest = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1].url : null);
  const fallbackUrl = pickLargest(manifest.sources.jpg) || pickLargest(manifest.sources.webp) || pickLargest(manifest.sources.avif);

  return {
    imagePath: fallbackUrl,
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

    const pickLargest = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1].url : null);
    const fallbackUrl = pickLargest(manifest.sources.jpg) || pickLargest(manifest.sources.webp) || pickLargest(manifest.sources.avif);

    results.push({
      imagePath: fallbackUrl,
      placeholder: result.placeholder,
      imageManifest: manifest,
      variantsCount: result.variants.length,
      alt: 'Car image' // Extend form for per-image alt if needed
    });
  }

  return results;
}

async function openaiChatCompletion(body, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const apiKey = (
      process.env.OPENAI_API_KEY
      || process.env.OPENAI_SECRET_KEY
      || process.env.OPENAI_KEY
      || ''
    ).trim();

    if (!apiKey) {
      return reject(new Error('Missing OpenAI key. Set OPENAI_API_KEY (or OPENAI_SECRET_KEY).'));
    }

    const requestBody = JSON.stringify(body);
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
        Authorization: `Bearer ${apiKey}`
      },
      timeout: timeoutMs
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

    req.on('timeout', () => {
      req.destroy(new Error(`OpenAI request timed out after ${timeoutMs}ms`));
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
  const modelName = process.env.OPENAI_LANDING_MODEL || process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
  const prompt = `Write unique, persuasive landing page copy for a used car buying service, specifically about selling a ${make} ${model}. Avoid generic filler that could apply to any car — reference things specific to the ${make} ${model} (typical condition/mileage concerns, known strengths or weaknesses, resale demand, common buyer questions).

Keys:
- overview (3-4 sentences introducing what makes selling a ${make} ${model} straightforward with us)
- valueFactors (3-4 sentences on what specifically affects a ${make} ${model}'s resale value — e.g. mileage, service history, common wear points, trim/engine variants)
- sellingTips (3-4 sentences of practical, model-specific advice for getting the best price for a ${make} ${model})
- faqQuickSale (1-2 sentences answering "How quickly can I sell my ${make} ${model}?" with specifics relevant to this model)
- faqNonUk (1-2 sentences answering "Do you buy non-UK registration ${make} ${model}?")
- faqNonRunning (1-2 sentences answering "Do you buy non-running ${make} cars?")
- metaDescription (one SEO sentence, under 160 characters)

Respond with JSON only, no extra text.`;

  const requestBody = {
    model: modelName,
    messages: [
      { role: 'system', content: 'You are a helpful copywriter for web landing pages. Always respond with a single valid JSON object and nothing else.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.6,
    max_tokens: 700
  };

  let response;
  try {
    // json_object mode keeps output compact and avoids markdown fences, so it's faster and parses reliably
    response = await openaiChatCompletion({ ...requestBody, response_format: { type: 'json_object' } }, 20000);
  } catch (err) {
    // Older models don't support response_format — fall back to a plain request
    if (!/response_format|400/i.test(err.message)) throw err;
    response = await openaiChatCompletion(requestBody, 20000);
  }

  const text = response.choices?.[0]?.message?.content || '';
  const parsed = parseOpenAIJson(text);
  if (!parsed) {
    throw new Error('Unable to parse AI response as JSON');
  }

  return {
    overview: parsed.overview || '',
    valueFactors: parsed.valueFactors || '',
    sellingTips: parsed.sellingTips || '',
    faqQuickSale: parsed.faqQuickSale || '',
    faqNonUk: parsed.faqNonUk || '',
    faqNonRunning: parsed.faqNonRunning || '',
    metaDescription: parsed.metaDescription || ''
  };
}


async function generateBlogDraft(title, excerpt, topic) {
  const modelName = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
  const prompt = `Write a helpful, trustworthy blog post for Auto Galleria — a premium used car dealership based in the UK.

Tone: warm, knowledgeable, and conversational. British English spelling throughout. Avoid American sales clichés or overly pushy language.
Structure: a short engaging title, a brief intro (2-3 sentences), 3-4 informative sections with plain-text section headings, and a clear closing paragraph with a subtle call to action.
Length: 400-550 words. Return plain text only — no markdown, no bullet points unless clearly appropriate.

Title: ${title || 'Blog post'}
Excerpt: ${excerpt || 'A helpful guide for car buyers and sellers.'}
Topic: ${topic || 'general automotive advice'}`;

  const response = await openaiChatCompletion({
    model: modelName,
    messages: [
      { role: 'system', content: 'You are an experienced automotive copywriter for a premium British used car dealership. You write in clear, friendly British English — informative without being salesy, and always trustworthy.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 800
  });

  const text = response.choices?.[0]?.message?.content || '';
  return text.trim();
}

async function generateCarDescription(details) {
  const modelName = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
  const prompt = `Write a vehicle listing description for Auto Galleria, a premium used car dealership in the UK.

Tone: confident, warm, and professional. British English spelling. Honest and specific — no hollow superlatives or American-style hype.
Structure: an engaging one-sentence opener that names the car, 2-3 sentences on key specs and appeal, one sentence on condition/mileage, and a clear closing line encouraging enquiry.
Length: 100-140 words. Return plain text only.

Make: ${details.make}
Model: ${details.model}
Year: ${details.year}
Fuel Type: ${details.fuelType || 'Not specified'}
Transmission: ${details.transmission || 'Not specified'}
Condition: ${details.condition || 'Not specified'}
Mileage: ${details.mileage ? details.mileage + ' miles' : 'Not specified'}`;

  const response = await openaiChatCompletion({
    model: modelName,
    messages: [
      { role: 'system', content: 'You write premium automotive listing copy for a respected UK used car dealership. Your descriptions are honest, specific, and written in polished British English. You never use hollow phrases like "don\'t miss out" or "stunning example".' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.65,
    max_tokens: 320
  });

  const text = response.choices?.[0]?.message?.content || '';
  return text.trim();
}

// ---------------------- DASHBOARD ----------------------
router.get('/dashboard', isAdmin, async (req, res) => {
  try {
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

    const leadTrendStart = new Date();
    leadTrendStart.setDate(leadTrendStart.getDate() - 29);
    leadTrendStart.setHours(0, 0, 0, 0);
    const leadTrend = await Lead.aggregate([
      { $match: { createdAt: { $gte: leadTrendStart } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Europe/London' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
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

    const today = new Date();
    const thisWeek = new Date();
    thisWeek.setDate(thisWeek.getDate() + 7);

    const followUpQueue = await Lead.find({
      status: { $nin: ['won', 'lost', 'archived'] },
      followUpAt: { $ne: null },
      followUpAt: { $lte: thisWeek }
    }).sort({ followUpAt: 1 }).limit(5).lean();

    const followUpNeeded = await Lead.countDocuments({
      status: { $nin: ['won', 'lost', 'archived'] },
      followUpAt: { $ne: null, $lte: today }
    });

    const dueThisWeek = await Lead.countDocuments({
      status: { $nin: ['won', 'lost', 'archived'] },
      followUpAt: { $ne: null, $gte: today, $lte: thisWeek }
    });

    const newLeads = await Lead.countDocuments({ status: 'new' });
    const noNotes = await Lead.countDocuments({ notes: { $exists: true, $in: ['', null] } });

    res.render('admin/dashboard', {
      user: req.user,
      leads,
      metrics: {
        totalLeads,
        totalCars,
        totalBlogs,
        totalPageViews,
        followUpNeeded,
        dueThisWeek,
        newLeads,
        noNotes
      },
      followUpQueue: followUpQueue.map(item => ({
        id: item._id,
        name: item.name,
        car: item.car || 'General enquiry',
        status: item.status || 'new',
        followUpAt: item.followUpAt
      })),
      topPages: topPages.map(item => ({ path: item._id, count: item.count })),
      leadTrend: leadTrend.map(item => ({ date: item._id, count: item.count })),
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
        totalPageViews: 0,
        followUpNeeded: 0,
        dueThisWeek: 0,
        newLeads: 0,
        noNotes: 0
      },
      followUpQueue: [],
      topPages: [],
      leadTrend: [],
      heatmap: [],
      heatmapRangeLabel: 'Last 7 days'
    });
  }
});

// ---------------------- LEADS ----------------------
function buildLeadFilterQuery(params) {
  const search = (params.search || '').trim();
  const query = {};

  if (search) {
    const expression = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { name: expression },
      { email: expression },
      { phone: expression },
      { car: expression },
      { sourceSlug: expression },
      { message: expression }
    ];
  }

  const filter = (params.filter || '').trim().toLowerCase();
  if (filter === 'followup') {
    query.followUpAt = { $ne: null };
  }
  if (filter === 'overdue') {
    query.followUpAt = { $lt: new Date() };
    query.status = { $nin: ['won', 'lost', 'archived'] };
  }
  if (filter === 'new') {
    query.status = 'new';
  }

  if (params.status) query.status = params.status;
  if (params.from || params.to) {
    query.createdAt = {};
    if (params.from) query.createdAt.$gte = new Date(`${params.from}T00:00:00.000Z`);
    if (params.to) query.createdAt.$lte = new Date(`${params.to}T23:59:59.999Z`);
  }

  return query;
}

router.get('/leads', isAdmin, async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = 25;
  const search = (req.query.search || '').trim();
  const status = (req.query.status || '').trim();
  const filter = (req.query.filter || '').trim();
  const sort = req.query.sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };
  const query = buildLeadFilterQuery(req.query);

  const [leads, total] = await Promise.all([
    Lead.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Lead.countDocuments(query)
  ]);

  res.render('admin/leads', {
    user: req.user,
    leads,
    filters: {
      search,
      status,
      filter: req.query.filter || '',
      sort: req.query.sort === 'oldest' ? 'oldest' : 'newest',
      from: req.query.from || '',
      to: req.query.to || ''
    },
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
  });
});

router.post('/leads/:id/update', isAdmin, async (req, res) => {
  const allowedStatuses = ['new', 'contacted', 'qualified', 'in progress', 'won', 'lost', 'archived'];
  const update = {
    status: allowedStatuses.includes(req.body.status) ? req.body.status : 'new',
    notes: (req.body.notes || '').trim(),
    followUpAt: req.body.followUpAt ? new Date(req.body.followUpAt) : undefined,
  };
  if (update.status === 'contacted') update.lastContactedAt = new Date();
  await Lead.findByIdAndUpdate(req.params.id, update);
  res.redirect(req.get('Referrer') || '/admin/leads');
});

router.get('/leads/export.csv', isAdmin, async (req, res) => {
  const leads = await Lead.find(buildLeadFilterQuery(req.query)).sort({ createdAt: -1 }).lean();
  const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['Date', 'Name', 'Email', 'Phone', 'Vehicle', 'Source', 'Status', 'Follow-up', 'Notes'],
    ...leads.map(lead => [
      lead.createdAt || lead.date,
      lead.name,
      lead.email,
      lead.phone,
      lead.car,
      lead.sourceSlug ? `${lead.sourceType || 'unknown'}:${lead.sourceSlug}` : lead.sourceType,
      lead.status || 'new',
      lead.followUpAt,
      lead.notes
    ])
  ];
  res.type('text/csv').attachment('autogalleria-leads.csv').send(rows.map(row => row.map(escapeCsv).join(',')).join('\n'));
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

// ---------------------- CARS ----------------------
router.get('/cars', isAdmin, async (req, res) => {
  const cars = await Car.find().sort({ createdAt: -1 });
  const pageViewCounts = await PageView.aggregate([
    { $match: { path: { $regex: '^/car/' } } },
    { $group: { _id: '$path', views: { $sum: 1 } } }
  ]);

  const viewCountMap = Object.fromEntries(
    pageViewCounts.map(({ _id, views }) => [_id, views])
  );

  const carsWithViews = cars.map((car) => ({
    ...car.toObject(),
    views: viewCountMap[`/car/${car.slug}`] || 0
  }));

  res.render('admin/cars', { user: req.user, cars: carsWithViews });
});

router.get('/cars/new', isAdmin, (req, res) => {
  res.render('admin/car-form', { user: req.user, car: {}, action: '/admin/cars', method: 'POST' });
});

router.post('/cars/ai-assist', isAdmin, async (req, res) => {
  try {
    const { make, model, year, fuelType, transmission, condition, mileage } = req.body || {};
    if (!make || !model || !year) {
      return res.status(400).json({ error: 'Make, model, and year are required.' });
    }

    const description = await generateCarDescription({
      make,
      model,
      year,
      fuelType,
      transmission,
      condition,
      mileage
    });

    res.json({ description });
  } catch (err) {
    console.error('❌ Car AI assist failed:', err);
    res.status(500).json({ error: err.message || 'AI generation failed' });
  }
});

router.post(
  '/cars',
  isAdmin,
  upload.fields([{ name: 'galleryImages', maxCount: 20 }]),
  async (req, res) => {
    try {
      console.log('Received car form submission');

      // Generate a unique slug from the requested slug, or from car identity fields.
      const requestedSlug = (req.body.slug || '').trim();
      const slugSource = requestedSlug || `${req.body.make || ''} ${req.body.model || ''} ${req.body.year || ''}`;
      const slug = await generateUniqueSlug(slugSource, Car);

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

      const { existingImages: _existingImages, slug: inputSlug, ...body } = req.body;
      const slugSource = (inputSlug || '').trim() || `${body.make || ''} ${body.model || ''} ${body.year || ''}`;
      const slug = await generateUniqueSlug(slugSource, Car, { excludeId: car._id });

      const carData = {
        ...body,
        slug,
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
  const pageViewCounts = await PageView.aggregate([
    { $match: { path: { $regex: '^/blog/' } } },
    { $group: { _id: '$path', views: { $sum: 1 } } }
  ]);

  const viewCountMap = Object.fromEntries(
    pageViewCounts.map(({ _id, views }) => [_id, views])
  );

  const blogsWithViews = blogs.map((blog) => ({
    ...blog.toObject(),
    views: viewCountMap[`/blog/${blog.slug}`] || 0
  }));

  res.render('admin/blogs', { 
    user: req.user,
    blogs: blogsWithViews
  });
});

router.get('/blogs/new', isAdmin, (req, res) => {
  res.render('admin/add-blog', {
    user: req.user
  });
});

router.post('/blogs/upload-image', isAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const imgData = await handleImageUpload(req.file, `blogs/inline/${Date.now()}`, 'inline', SIZES.hero);
    const imageUrl = imgData?.imageManifest?.sources?.avif?.[0]?.url
      || imgData?.imageManifest?.sources?.webp?.[0]?.url
      || imgData?.imageManifest?.sources?.jpg?.[0]?.url
      || imgData?.imagePath;

    res.json({ url: imageUrl });
  } catch (err) {
    console.error('❌ Blog inline image upload failed:', err);
    res.status(500).json({ error: 'Image upload failed' });
  }
});

router.post('/blogs/ai-assist', isAdmin, async (req, res) => {
  try {
    const { title, excerpt, topic } = req.body || {};
    if (!title && !excerpt && !topic) {
      return res.status(400).json({ error: 'Please provide a title, excerpt, or topic.' });
    }

    const draft = await generateBlogDraft(title, excerpt, topic);
    res.json({ content: draft });
  } catch (err) {
    console.error('❌ Blog AI assist failed:', err);
    res.status(500).json({ error: err.message || 'AI generation failed' });
  }
});

router.post('/blogs', isAdmin, upload.fields([
  { name: 'coverImageFile', maxCount: 1 },
  { name: 'inlineImageFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const requestedSlug = (req.body.slug || '').trim();
    const slugSource = requestedSlug || req.body.title || 'blog';

    const blogData = {
      ...req.body,
      slug: await generateUniqueSlug(slugSource, Blog)
    };

    const blog = await Blog.create(blogData);

    if (req.files?.coverImageFile?.[0]) {
      const imgData = await handleImageUpload(req.files.coverImageFile[0], `blogs/${blog._id}`, 'cover', SIZES.hero);
      blog.coverImage = imgData.imagePath;
      blog.imageManifest = imgData.imageManifest;
      blog.placeholder = imgData.placeholder;
      await blog.save();
    } else if (req.body.coverImage) {
      blog.coverImage = req.body.coverImage;
      await blog.save();
    }

    res.redirect('/admin/blogs');
  } catch (err) {
    console.error('❌ Create blog error:', err);
    res.status(500).send('Error creating blog');
  }
});

router.get('/blogs/edit/:id', isAdmin, async (req, res) => {
  const blog = await Blog.findById(req.params.id);
  res.render('admin/edit-blog', {
    user: req.user,
    blog
  });
});

router.post('/blogs/edit/:id', isAdmin, upload.fields([
  { name: 'coverImageFile', maxCount: 1 },
  { name: 'inlineImageFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).send('Blog not found');
    }

    // Update basic fields
    blog.title = req.body.title?.trim() || blog.title;
    blog.excerpt = req.body.excerpt?.trim() || blog.excerpt;
    blog.content = req.body.content?.trim() || blog.content;

    // Normalize slug from user input and keep it unique.
    if (req.body.slug && req.body.slug.trim()) {
      const normalizedSlug = await generateUniqueSlug(req.body.slug.trim(), Blog, { excludeId: blog._id });
      blog.slug = normalizedSlug;
    }

    // Handle cover image file upload
    if (req.files?.coverImageFile?.[0]) {
      const imgData = await handleImageUpload(req.files.coverImageFile[0], `blogs/${blog._id}`, 'cover', SIZES.hero);
      blog.coverImage = imgData.imagePath;
      blog.imageManifest = imgData.imageManifest;
      blog.placeholder = imgData.placeholder;
    } else if (req.body.coverImage && req.body.coverImage.trim()) {
      // Use URL if no file upload
      blog.coverImage = req.body.coverImage.trim();
    }

    await blog.save();
    res.redirect('/admin/blogs');
  } catch (err) {
    console.error('❌ Edit blog error:', err);
    res.status(500).send('Error updating blog');
  }
});

router.post('/blogs/delete/:id', isAdmin, async (req, res) => {
  await Blog.findByIdAndDelete(req.params.id);
  res.redirect('/admin/blogs');
});

module.exports = router; // Export the router