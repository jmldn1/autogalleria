const express = require("express");
const router = express.Router();
const Blog = require("../models/Blog");
const { buildCanonicalUrl, toAbsoluteUrl } = require("../utils/seo");

// GET all blogs
router.get("/", async (req, res) => {
  try {
    const blogs = await Blog.find().sort({ createdAt: -1 });
    res.render("blog", { blogs });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading blogs");
  }
});

// GET single blog by slug
router.get("/:slug", async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug });
    if (!blog) return res.status(404).send("Blog not found");

    const relatedBlogs = await Blog.find({ _id: { $ne: blog._id } })
      .sort({ createdAt: -1 })
      .limit(3);

    const articleUrl = buildCanonicalUrl(`/blog/${blog.slug}`);
    const articleImage = toAbsoluteUrl(blog.coverImage);
    const articleSchema = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: blog.title,
      ...(blog.excerpt ? { description: blog.excerpt } : {}),
      ...(articleImage ? { image: articleImage } : {}),
      ...(blog.createdAt ? { datePublished: new Date(blog.createdAt).toISOString() } : {}),
      ...(blog.updatedAt ? { dateModified: new Date(blog.updatedAt).toISOString() } : {}),
      author: { "@type": "Organization", name: "Auto Galleria" },
      publisher: { "@type": "Organization", name: "Auto Galleria" },
      mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl }
    };

    res.render("blog-details", {
      blog,
      relatedBlogs,
      ogImage: articleImage,
      ogImageAlt: blog.title,
      jsonLd: articleSchema
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading blog");
  }
});

module.exports = router;
