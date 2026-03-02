const slugify = require("slugify");

/**
 * Generate a unique slug for a given model
 * @param {String} text - the base string (e.g., make + model, blog title)
 * @param {Object} Model - the Mongoose model to check against
 * @returns {String} unique slug
 */
async function generateUniqueSlug(text, Model) {
  const baseSlug = slugify(text, { lower: true, strict: true });
  let slug = baseSlug;
  let counter = 1;

  while (await Model.findOne({ slug })) {
    slug = `${baseSlug}-${counter++}`;
  }

  return slug;
}

module.exports = generateUniqueSlug;
