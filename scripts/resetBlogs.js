require('dotenv').config();

const mongoose = require('mongoose');
const Blog = require('../models/Blog');

async function resetBlogs() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required to reset blog posts.');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const result = await Blog.deleteMany({});
  console.log(`Deleted ${result.deletedCount} blog post${result.deletedCount === 1 ? '' : 's'}.`);
}

resetBlogs()
  .catch((error) => {
    console.error('Unable to reset blog posts:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());