require('dotenv').config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const mongoose = require("mongoose");
const MongoStore = require("connect-mongo");
const bcrypt = require("bcrypt");
const helmet = require("helmet");

// Models
const Admin = require("./models/Admin");
const Landing = require("./models/Landing");
const Car = require("./models/Car");   
const Blog = require("./models/Blog");
const PageView = require("./models/PageView");

// Routes
const adminRoutes = require("./routes/admin");
const blogRoutes = require("./routes/blog");
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

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use('/images', express.static(path.join(__dirname, 'public/images')));

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
    req.session.user = { name: admin.username };
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

  res.redirect(`/sell-your-${landing.slug}?success=1`);
});


// Public cars listing route
app.get("/cars", async (req, res) => {
  try {
    const cars = await Car.find().sort({ updatedAt: -1, createdAt: -1 }).lean();

    const normalizedCars = cars.map((car) => {
      const firstImage = car.galleryImages?.[0] || car.images?.[0];
      const imageManifest = firstImage?.manifest?.sources;
      const buildFallback = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1].url : null);
      const image = {
        sources: {
          avif: imageManifest?.avif || [],
          webp: imageManifest?.webp || [],
          jpg: imageManifest?.jpg || [],
        },
        fallback: buildFallback(imageManifest?.jpg) || buildFallback(imageManifest?.webp) || buildFallback(imageManifest?.avif) || null,
        alt: firstImage?.alt || `${car.make || 'Vehicle'} ${car.model || ''}`.trim(),
      };

      return {
        ...car,
        image,
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

// Car details route
app.get("/car/:slug", async (req, res) => {
  try {
    const car = await Car.findOne({ slug: req.params.slug });
    if (!car) return res.status(404).send("Car not found");

    res.render("car-details", {
      car,
      gallery: car.galleryImages || []
    });
  } catch (err) {
    console.error("Car details error:", err);
    res.status(500).send("Server error");
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
