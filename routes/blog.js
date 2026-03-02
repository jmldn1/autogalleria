const express = require("express");
const router = express.Router();
const Blog = require("../models/Blog");

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
    res.render("blog-details", { blog });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading blog");
  }
});

module.exports = router;
