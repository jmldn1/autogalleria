require('dotenv').config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const mongoose = require("mongoose");
const MongoStore = require("connect-mongo");
const bcrypt = require("bcrypt");
const helmet = require("helmet");
const compression = require("compression");
const pkg = require("./package.json");

// Models
const Admin = require("./models/Admin");
const Landing = require("./models/Landing");
const Car = require("./models/Car");
const Showroom = require("./models/Showroom");
const HeroImage = require("./models/HeroImage");
const Blog = require("./models/Blog");
const PageView = require("./models/PageView");
const Lead = require("./models/Lead");

// Routes
const adminRoutes = require("./routes/admin");
const blogRoutes = require("./routes/blog");
const { getSiteUrl, buildCanonicalUrl, toAbsoluteUrl } = require("./utils/seo");
const vehicleRoutes = require("./routes/vehicle");

const app = express();

// ---------- MONGODB CONNECTION ----------
mongoose.connect(process.env.MONGO_URI, {})
  .then(() => console.log("MongoDB Atlas connected ✅"))
  .catch(err => console.error("MongoDB connection error:", err));

// ---------- MIDDLEWARE ----------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Helmet with CSP disabled (so Bootstrap/Tailwind/CDNs load correctly)
app.use(
  helmet({
    contentSecurityPolicy: false, // Disable CSP for now
  })
);

app.use(compression());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Cache-bust vendor assets whenever the vendored package versions change.
app.locals.vendorVersion = `swiper-${pkg.devDependencies.swiper}_lightgallery-${pkg.devDependencies.lightgallery}`.replace(/[^\w.-]/g, "");

// Vendored third-party assets are immutable per version, so cache them aggressively.
app.use('/vendor', express.static(path.join(__dirname, 'public/vendor'), {
  maxAge: '1y',
  immutable: true,
}));
app.use(express.static(path.join(__dirname, "public")));
// Processed gallery images are content-hashed per upload, so cache them aggressively.
app.use('/images', express.static(path.join(__dirname, 'public/images'), {
  maxAge: '1y',
  immutable: true,
}));

function extractYouTubeVideoId(url) {
  if (!url || typeof url !== 'string') return null;

  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./, '');

    if ((host === 'youtube.com' || host === 'm.youtube.com') && parsed.searchParams.get('v')) {
      return parsed.searchParams.get('v');
    }

    if (host === 'youtu.be') {
      return parsed.pathname.split('/').filter(Boolean)[0] || null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      const segments = parsed.pathname.split('/').filter(Boolean);
      const embedIndex = segments.findIndex((segment) => segment === 'embed' || segment === 'shorts');

      if (embedIndex !== -1) {
        return segments[embedIndex + 1] || null;
      }
    }
  } catch (err) {
    const fallbackMatch = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
    return fallbackMatch ? fallbackMatch[1] : null;
  }

  return null;
}

function buildYouTubeVideoData(url) {
  const videoId = extractYouTubeVideoId(url);

  if (!videoId) return null;

  return {
    id: videoId,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

function normalizeWhatsAppNumber(value) {
  const digits = (value || '').toString().replace(/\D/g, '');

  if (!digits) return '';

  return digits.startsWith('00') ? digits.slice(2) : digits;
}

const adminWhatsAppNumber = normalizeWhatsAppNumber(process.env.ADMIN_WHATSAPP);

const contactRateWindowMs = 15 * 60 * 1000;
const contactRateMaxAttempts = 5;
const contactRateStore = new Map();
const hasGmailMailConfig = Boolean(
  process.env.GMAIL_USER && process.env.GMAIL_PASS && process.env.GMAIL_TO
);

if (!hasGmailMailConfig) {
  console.warn("Contact email notifications are disabled. Set GMAIL_USER, GMAIL_PASS, and GMAIL_TO to enable them.");
}

function isContactRateLimited(ip) {
  const now = Date.now();
  const key = ip || "unknown";
  const existing = contactRateStore.get(key) || [];
  const recent = existing.filter((ts) => now - ts < contactRateWindowMs);

  if (recent.length >= contactRateMaxAttempts) {
    contactRateStore.set(key, recent);
    return true;
  }

  recent.push(now);
  contactRateStore.set(key, recent);
  return false;
}

if (!adminWhatsAppNumber) {
  console.warn('ADMIN_WHATSAPP is missing or invalid. WhatsApp chat links will be hidden.');
}

app.use((req, res, next) => {
  res.locals.adminWhatsAppNumber = adminWhatsAppNumber;
  next();
});

// Default canonical/OG url for public pages, based on the current path; views can override by passing their own canonicalUrl.
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/admin") && !req.path.startsWith("/api")) {
    res.locals.siteUrl = getSiteUrl();
    res.locals.canonicalUrl = buildCanonicalUrl(req.path);
  }
  next();
});

app.use(async (req, res, next) => {
  // Track only frontend page visits, skip assets and admin/api routes.
  const skip = req.method !== 'GET'
    || req.path.startsWith('/admin')
    || req.path.startsWith('/api')
    || req.path.startsWith('/images')
    || req.path.startsWith('/css')
    || req.path.startsWith('/js')
    || req.path.startsWith('/uploads')
    || req.path.startsWith('/login')
    || req.path.startsWith('/logout')
    || req.path.startsWith('/sitemap.xml')
    || req.path.includes('.') ;

  if (!skip) {
    const pageView = new PageView({
      path: req.path,
      referrer: req.get('Referrer') || '',
      userAgent: req.get('User-Agent') || '',
      ip: req.ip
    });
    pageView.save().catch(err => console.error('PageView save error:', err));
  }

  next();
});

// ---------- SESSION ----------
app.set('trust proxy', 1); 
app.use(session({
  secret: process.env.SESSION_SECRET || "someSuperSecretString",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    collectionName: 'sessions'
  }),
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ---------- LOGGING ERRORS ----------
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason, promise) => console.error('Unhandled Rejection at:', promise, 'reason:', reason));

// ---------- ROUTES ----------
app.use("/blog", blogRoutes);
app.use("/admin", adminRoutes);
app.use("/api", vehicleRoutes);

// Login Page
app.get("/login", (req, res) => res.render("login", { error: null }));

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  console.log("Login attempt:", username);

  try {
    const admin = await Admin.findOne({ username });
    if (!admin) return res.render("login", { error: "Invalid username or password" });

    const match = await bcrypt.compare(password, admin.password);
    if (!match) return res.render("login", { error: "Invalid username or password" });

    req.session.isAdmin = true;
    req.session.user = {
      id: admin._id.toString(),
      name: admin.username,
      profileImage: admin.profileImage || ''
    };
    return res.redirect("/admin/dashboard");

  } catch (err) {
    console.error("Login error:", err);
    return res.render("login", { error: "An error occurred, please try again." });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// Homepage
app.get("/", (req, res) => res.render("index", { title: "Welcome to Auto Galleria" }));

// Contact page
app.get("/contact", (req, res) => {
  res.render("contact", {
    title: "Contact",
    sent: req.query.sent === "1",
    error: req.query.error === "1",
    rateLimited: req.query.rate === "1",
  });
});

app.post("/contact", async (req, res) => {
  try {
    const { name, email, phone, projectType, referenceUrl, message, companyWebsite } = req.body;

    // Honeypot field: real users never fill this, bots often do.
    if (companyWebsite && companyWebsite.trim()) {
      return res.redirect("/contact?sent=1");
    }

    if (isContactRateLimited(req.ip)) {
      return res.redirect("/contact?rate=1");
    }

    if (!name || !name.trim() || !email || !email.trim() || !message || !message.trim()) {
      return res.redirect("/contact?error=1");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.redirect("/contact?error=1");
    }

    const projectContext = [
      projectType && `Project type: ${projectType.trim()}`,
      referenceUrl && `Website or inspiration link: ${referenceUrl.trim()}`,
    ].filter(Boolean).join("\n");
    const leadMessage = [projectContext, message.trim()].filter(Boolean).join("\n\n");

    const lead = new Lead({
      name: name.trim(),
      email: email.trim(),
      phone: phone ? phone.trim() : undefined,
      message: leadMessage,
      car: "Website Enquiry",
    });

    await lead.save();

    if (hasGmailMailConfig) {
      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
      });

      await transporter.sendMail({
        from: `"Auto Galleria Enquiries" <${process.env.GMAIL_USER}>`,
        to: process.env.GMAIL_TO,
        replyTo: `"${name.trim()}" <${email.trim()}>`,
        subject: "New Website Enquiry",
        html: `
          <h2 style="margin-bottom:8px">New Website Enquiry</h2>
          <hr style="margin:16px 0">
          <p><strong>Name:</strong> ${name.trim()}</p>
          <p><strong>Email:</strong> ${email.trim()}</p>
          ${phone ? `<p><strong>Phone:</strong> ${phone.trim()}</p>` : ""}
          ${projectType ? `<p><strong>Project type:</strong> ${projectType.trim()}</p>` : ""}
          ${referenceUrl ? `<p><strong>Website or inspiration link:</strong> ${referenceUrl.trim()}</p>` : ""}
          <p><strong>Message:</strong> ${message.trim()}</p>
        `,
      });
    }

    return res.redirect("/contact?sent=1");
  } catch (err) {
    console.error("Contact form error:", err);
    return res.redirect("/contact?error=1");
  }
});

// General vehicle sale enquiry page
app.get("/sell-your-car", (req, res) => {
  res.render("sell-your-car", {
    sent: req.query.sent === "1",
    error: req.query.error === "1",
    rateLimited: req.query.rate === "1",
  });
});

app.post("/sell-your-car", async (req, res) => {
  try {
    const { name, email, phone, enquiryType, registration, vehicle, mileage, message, companyWebsite } = req.body;

    if (companyWebsite && companyWebsite.trim()) {
      return res.redirect("/sell-your-car?sent=1");
    }

    if (isContactRateLimited(req.ip)) {
      return res.redirect("/sell-your-car?rate=1");
    }

    if (!name || !name.trim() || !email || !email.trim() || !message || !message.trim()) {
      return res.redirect("/sell-your-car?error=1");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.redirect("/sell-your-car?error=1");
    }

    const vehicleContext = [
      enquiryType && `Enquiry type: ${enquiryType.trim()}`,
      registration && `Registration: ${registration.trim().toUpperCase()}`,
      vehicle && `Vehicle: ${vehicle.trim()}`,
      mileage && `Mileage: ${mileage.trim()}`,
    ].filter(Boolean).join("\n");
    const leadMessage = [vehicleContext, message.trim()].filter(Boolean).join("\n\n");

    const lead = new Lead({
      name: name.trim(),
      email: email.trim(),
      phone: phone ? phone.trim() : undefined,
      message: leadMessage,
      car: vehicle && vehicle.trim() ? vehicle.trim() : "Vehicle sale enquiry",
      sourceType: "landing",
      sourceSlug: "sell-your-car",
    });

    await lead.save();

    if (hasGmailMailConfig) {
      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
      });

      await transporter.sendMail({
        from: `"Auto Galleria Enquiries" <${process.env.GMAIL_USER}>`,
        to: process.env.GMAIL_TO,
        replyTo: email.trim(),
        subject: "New Vehicle Sale Enquiry",
        text: `Name: ${name.trim()}\nEmail: ${email.trim()}${phone ? `\nPhone: ${phone.trim()}` : ""}\n\n${leadMessage}`,
      });
    }

    return res.redirect("/sell-your-car?sent=1");
  } catch (err) {
    console.error("Vehicle sale enquiry error:", err);
    return res.redirect("/sell-your-car?error=1");
  }
});

// SEO-friendly Landing page route
app.get("/sell-your-:slug", async (req, res) => {
  try {
    const landing = await Landing.findOne({ slug: req.params.slug });
    if (!landing) return res.status(404).send("Landing not found");

    const related = await Landing.find({
      make: landing.make,
      slug: { $ne: landing.slug }
    }).select('make model slug imageManifest').lean();

    let relatedTitle = `Other ${landing.make || 'models'} models we buy`;
    let relatedDescription = `Explore other ${landing.make ? landing.make.toLowerCase() : 'vehicles'} models we purchase.`;
    let usedRandomFallback = false;

    if (related.length < 3) {
      const excludeSlugs = [landing.slug, ...related.map(item => item.slug)];
      const fillCount = 3 - related.length;
      const randomFill = await Landing.aggregate([
        { $match: { slug: { $nin: excludeSlugs } } },
        { $sample: { size: fillCount } },
        { $project: { make: 1, model: 1, slug: 1, imageManifest: 1 } }
      ]);

      if (randomFill.length) {
        usedRandomFallback = true;
        related.push(...randomFill);
      }
    }

    const relatedItems = related.slice(0, 3);
    const relatedGridClass = relatedItems.length === 1
      ? 'grid-cols-1 justify-items-center'
      : relatedItems.length === 2
        ? 'grid-cols-1 sm:grid-cols-2 justify-items-center'
        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

    if (!relatedItems.length) {
      relatedTitle = 'More models we buy';
      relatedDescription = 'Browse other vehicles we purchase.';
    } else if (usedRandomFallback) {
      relatedTitle = 'More models we buy';
      relatedDescription = 'Browse other vehicles we purchase.';
    }

    res.render("landing", { landing, relatedItems, relatedTitle, relatedDescription, relatedGridClass });
  } catch (err) {
    console.error("SEO landing page error:", err);
    res.status(500).send("Server error");
  }
});
app.post("/sell-your-:slug/lead", async (req, res) => {
  const landing = await Landing.findOne({ slug: req.params.slug });
  if (!landing) return res.status(404).send("Landing not found");

  const { name, email, phone } = req.body;
  console.log(`New lead for ${landing.make} ${landing.model}`, { name, email, phone });

  const lead = new Lead({
    name: name ? name.trim() : '',
    email: email ? email.trim() : '',
    phone: phone ? phone.trim() : undefined,
    car: `${landing.make || ''} ${landing.model || ''}`.trim(),
    sourceType: 'landing',
    sourceSlug: landing.slug,
  });
  await lead.save();

  res.redirect(`/sell-your-${landing.slug}?success=1`);
});


// Public cars listing route
app.get("/cars", async (req, res) => {
  try {
    const cars = await Car.find().sort({ updatedAt: -1, createdAt: -1 }).lean();

    const buildFallback = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1].url : null);
    const buildCardImage = (source, car) => {
      const imageManifest = source?.manifest?.sources;
      return {
        sources: {
          avif: imageManifest?.avif || [],
          webp: imageManifest?.webp || [],
          jpg: imageManifest?.jpg || [],
        },
        fallback: buildFallback(imageManifest?.jpg) || buildFallback(imageManifest?.webp) || buildFallback(imageManifest?.avif) || null,
        alt: source?.alt || `${car.make || 'Vehicle'} ${car.model || ''}`.trim(),
      };
    };

    const normalizedCars = cars.map((car) => {
      const gallery = (car.galleryImages?.length ? car.galleryImages : car.images) || [];
      const images = gallery.slice(0, 3).map((source) => buildCardImage(source, car));

      return {
        ...car,
        image: images[0] || buildCardImage(null, car),
        images,
      };
    });

    res.render("cars", {
      title: "Cars",
      cars: normalizedCars,
    });
  } catch (err) {
    console.error("Cars listing error:", err);
    res.status(500).send("Server error");
  }
});

// Reusable car website demo homepage (not a replacement for the "/" brochure page)
app.get("/showroom", async (req, res) => {
  try {
    const [cars, showroom] = await Promise.all([
      Car.find().sort({ updatedAt: -1, createdAt: -1 }).lean(),
      Showroom.findOne().populate(['heroCar', 'heroImageAsset']).lean(),
    ]);
    const buildFallback = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1].url : null);

    const normalizedCars = cars.map((car) => {
      const gallery = car.galleryImages || [];
      const buildCardImage = (source) => {
        const imageManifest = source?.manifest?.sources;
        return {
          sources: {
            avif: imageManifest?.avif || [],
            webp: imageManifest?.webp || [],
            jpg: imageManifest?.jpg || [],
          },
          fallback: buildFallback(imageManifest?.jpg) || buildFallback(imageManifest?.webp) || buildFallback(imageManifest?.avif) || null,
          alt: source?.alt || `${car.make || 'Vehicle'} ${car.model || ''}`.trim(),
        };
      };
      const images = gallery.slice(0, 3).map(buildCardImage);

      return { ...car, image: images[0] || buildCardImage(null), images };
    });

    const configuredHeroCar = showroom?.heroCar?.galleryImages?.[0]?.manifest?.heroSources?.jpg?.length
      ? showroom.heroCar
      : null;
    const fallbackHeroCar = cars.find((car) => car.galleryImages?.[0]?.manifest?.heroSources?.jpg?.length);
    const heroCar = configuredHeroCar || fallbackHeroCar;
    const customHeroAsset = showroom?.heroMode === 'custom-image' && showroom.heroImageAsset?.manifest?.sources?.jpg?.length
      ? showroom.heroImageAsset
      : null;
    const legacyCustomHeroImage = showroom?.heroMode === 'custom-image' && showroom.heroImage?.manifest?.sources?.jpg?.length
      ? showroom.heroImage
      : null;
    const customHeroImage = customHeroAsset || legacyCustomHeroImage;
    const heroImage = customHeroImage
      ? {
          sources: customHeroImage.manifest.sources,
          mobileSources: customHeroImage.mobileManifest?.sources || null,
          alt: customHeroImage.alt || '',
        }
      : heroCar
        ? {
          sources: heroCar.galleryImages[0].manifest.heroSources,
          alt: heroCar.galleryImages[0].alt || `${heroCar.make || 'Vehicle'} ${heroCar.model || ''}`.trim(),
        }
      : null;

    res.render("showroom", {
      title: "Auto Galleria | Find Your Next Car",
      description: "Browse hand-picked used cars with transparent pricing, detailed photos and nationwide delivery.",
      cars: normalizedCars.slice(0, 6),
      totalCars: normalizedCars.length,
      heroCar,
      heroImage,
      showroom: showroom || {},
    });
  } catch (err) {
    console.error("Showroom homepage error:", err);
    res.status(500).send("Server error");
  }
});

// Car details route
app.get("/car/:slug", async (req, res) => {
  try {
    const carDoc = await Car.findOne({ slug: req.params.slug }).lean();
    const buildFallback = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1].url : null);

    if (!carDoc) return res.status(404).send("Car not found");

    const buildLargest = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null);

    const galleryImages = (carDoc.galleryImages || []).map((img) => {
      const heroSources = img?.manifest?.heroSources || {};
      const sources = img?.manifest?.sources || {};
      const largestHero = buildLargest(heroSources.jpg) || buildLargest(heroSources.webp) || buildLargest(heroSources.avif);
      const largestSource = buildLargest(sources.jpg) || buildLargest(sources.webp) || buildLargest(sources.avif);
      const largest = largestHero || largestSource;

      return {
        ...img,
        lightboxSrc: largest?.url || img?.fallback || null,
        lightboxSize: largest ? `${largest.w}-${largest.h}` : '1200-900',
      };
    });

    const car = {
      ...carDoc,
      galleryImages,
      video: buildYouTubeVideoData(carDoc.youtubeUrl),
    };
    const vehicleName = [car.year, car.make, car.model].filter(Boolean).join(' ');
    const vehicleImages = galleryImages
      .map(image => toAbsoluteUrl(image.lightboxSrc || image.fallback))
      .filter(Boolean);
    const vehicleUrl = buildCanonicalUrl(`/car/${car.slug}`);
    const vehicleSchema = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Product",
          "name": vehicleName,
          ...(car.description ? { description: car.description } : {}),
          ...(vehicleImages.length ? { image: vehicleImages } : {}),
          ...(Number.isFinite(Number(car.price)) ? {
            offers: {
              "@type": "Offer",
              price: Number(car.price),
              priceCurrency: "GBP",
              availability: "https://schema.org/InStock",
              url: vehicleUrl
            }
          } : {}),
          additionalProperty: [
            ['year', car.year],
            ['mileageFromOdometer', car.mileage],
            ['condition', car.condition]
          ].filter(([, value]) => value !== undefined && value !== null && value !== '').map(([name, value]) => ({
            "@type": "PropertyValue",
            name,
            value
          }))
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: getSiteUrl() },
            { "@type": "ListItem", position: 2, name: "Cars", item: buildCanonicalUrl('/cars') },
            { "@type": "ListItem", position: 3, name: vehicleName, item: vehicleUrl }
          ]
        }
      ]
    };

    const buildCardSingleImage = (source, vehicle) => {
      const imageManifest = source?.manifest?.sources;

      return {
        sources: {
          avif: imageManifest?.avif || [],
          webp: imageManifest?.webp || [],
          jpg: imageManifest?.jpg || [],
        },
        fallback: buildFallback(imageManifest?.jpg) || buildFallback(imageManifest?.webp) || buildFallback(imageManifest?.avif) || null,
        alt: source?.alt || `${vehicle.make || "Vehicle"} ${vehicle.model || ""}`.trim(),
      };
    };

    const buildCardImage = (vehicle) => {
      const gallery = (vehicle.galleryImages?.length ? vehicle.galleryImages : vehicle.images) || [];
      const images = gallery.slice(0, 3).map((source) => buildCardSingleImage(source, vehicle));
      return { image: images[0] || buildCardSingleImage(null, vehicle), images };
    };

    const cardSelect = {
      slug: 1,
      make: 1,
      model: 1,
      year: 1,
      price: 1,
      mileage: 1,
      condition: 1,
      galleryImages: { $slice: 3 },
    };

    const relatedByMake = await Car.find({
      _id: { $ne: carDoc._id },
      make: carDoc.make,
    })
      .select(cardSelect)
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(3)
      .lean();

    let relatedCars = relatedByMake;

    if (relatedCars.length < 3) {
      const missingCount = 3 - relatedCars.length;
      const excludeIds = [carDoc._id, ...relatedCars.map((item) => item._id)];
      const fallbackCars = await Car.find({ _id: { $nin: excludeIds } })
        .select(cardSelect)
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(missingCount)
        .lean();

      relatedCars = [...relatedCars, ...fallbackCars];
    }

    relatedCars = relatedCars.map((relatedCar) => ({
      ...relatedCar,
      ...buildCardImage(relatedCar),
    }));

    // ?layout=classic renders the legacy car-details layout for side-by-side comparison
    const template = req.query.layout === "classic" ? "car-details" : "car-details-hero";

    res.render(template, {
      car,
      gallery: galleryImages,
      relatedCars,
      ogImage: vehicleImages[0] || null,
      ogImageAlt: vehicleName,
      jsonLd: vehicleSchema,
    });
  } catch (err) {
    console.error("Car details error:", err);
    res.status(500).send("Server error");
  }
});

// Car enquiry route
app.post("/car/:slug/enquire", async (req, res) => {
  try {
    const { name, email, phone, message, companyWebsite } = req.body;

    // Honeypot field: real users never fill this, bots often do.
    if (companyWebsite && companyWebsite.trim()) {
      return res.json({ success: true, message: "Thank you — we'll be in touch shortly." });
    }

    if (!name || !name.trim() || !email || !email.trim()) {
      return res.status(400).json({ success: false, message: "Name and email are required." });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }

    const carDoc = await Car.findOne({ slug: req.params.slug }).select("_id slug make model year").lean();

    const lead = new Lead({
      name: name.trim(),
      email: email.trim(),
      phone: phone ? phone.trim() : undefined,
      message: message ? message.trim() : undefined,
      car: carDoc ? `${carDoc.year} ${carDoc.make} ${carDoc.model}` : req.params.slug,
      carId: carDoc ? carDoc._id : undefined,
      carSlug: req.params.slug,
      sourceType: 'car',
      sourceSlug: req.params.slug,
    });

    await lead.save();

    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });

    // Escape user-supplied fields before interpolating into the HTML email body.
    const escapeHtml = (str) =>
      String(str).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

    const carLabel = carDoc ? `${carDoc.year} ${carDoc.make} ${carDoc.model}` : req.params.slug;
    const carUrl = `https://autogalleria.co.uk/car/${req.params.slug}`;
    const safeName = escapeHtml(name.trim());
    const safeEmail = escapeHtml(email.trim());
    const safePhone = phone ? escapeHtml(phone.trim()) : "";
    const safeMessage = message ? escapeHtml(message.trim()) : "";

    await transporter.sendMail({
      from: `"Auto Galleria Enquiries" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_TO,
      replyTo: `"${name.trim().replace(/["\r\n]/g, "")}" <${email.trim()}>`,
      subject: `New Car Enquiry — ${carLabel}`,
      html: `
        <h2 style="margin-bottom:8px">New Enquiry — ${carLabel}</h2>
        <p><a href="${carUrl}">${carUrl}</a></p>
        <hr style="margin:16px 0">
        <p><strong>Name:</strong> ${safeName}</p>
        <p><strong>Email:</strong> ${safeEmail}</p>
        ${safePhone ? `<p><strong>Phone:</strong> ${safePhone}</p>` : ""}
        ${safeMessage ? `<p><strong>Message:</strong> ${safeMessage}</p>` : ""}
      `,
    });

    return res.json({ success: true, message: "Thank you — we'll be in touch shortly." });
  } catch (err) {
    console.error("Car enquiry error:", err);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ---------- SITEMAP ROUTE ----------
app.get("/sitemap.xml", async (req, res) => {
  try {
    const baseUrl = "https://autogalleria.co.uk";
    const cars = await Car.find().sort({ updatedAt: -1 });
    const blogs = await Blog.find().sort({ updatedAt: -1 });
    const landings = await Landing.find().sort({ updatedAt: -1 });

    let urls = [];

    cars.forEach(car => {
      urls.push(`<url>
        <loc>${baseUrl}/car/${car.slug || car._id}</loc>
        <lastmod>${car.updatedAt?.toISOString() || new Date().toISOString()}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.9</priority>
      </url>`);
    });

    blogs.forEach(blog => {
      urls.push(`<url>
        <loc>${baseUrl}/blog/${blog.slug}</loc>
        <lastmod>${blog.updatedAt?.toISOString() || new Date().toISOString()}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.7</priority>
      </url>`);
    });

landings.forEach(landing => {
  urls.push(`<url>
    <loc>${baseUrl}/sell-your-${landing.slug}</loc>
    <lastmod>${landing.updatedAt?.toISOString() || new Date().toISOString()}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`);
});

    const staticUrls = [
      { loc: "/", priority: 1.0 },
      { loc: "/contact", priority: 0.8 },
    ];
    staticUrls.forEach(p => {
      urls.push(`<url>
        <loc>${baseUrl}${p.loc}</loc>
        <changefreq>monthly</changefreq>
        <priority>${p.priority}</priority>
      </url>`);
    });

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      ${urls.join("\n")}
    </urlset>`;

    res.header("Content-Type", "application/xml");
    res.send(sitemap);

  } catch (err) {
    console.error("Error generating sitemap:", err);
    res.status(500).send("Error generating sitemap");
  }
});

// ---------- GLOBAL ERROR HANDLER ----------
app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  res.status(500).send("Something went wrong!");
});

// ---------- GRACEFUL SHUTDOWN ----------
process.on('SIGINT', async () => {
  console.log('SIGINT received. Closing MongoDB connection...');
  try { await mongoose.connection.close(); } catch (err) { console.error(err); }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Closing MongoDB connection...');
  try { await mongoose.connection.close(); } catch (err) { console.error(err); }
  process.exit(0);
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Neptune running at http://localhost:${PORT}`));
