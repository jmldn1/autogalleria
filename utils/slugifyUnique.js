const slugify = require("slugify");

/**
 * Generate a unique slug for a given model
 * @param {String} text - the base string (e.g., make + model, blog title)
 * @param {Object} Model - the Mongoose model to check against
 * @param {Object} options - optional settings such as excludeId
 * @returns {String} unique slug
 */
async function generateUniqueSlug(text, Model, options = {}) {
  const source = (text || "").toString().trim();
  const baseSlug = slugify(source || "item", { lower: true, strict: true });
  let slug = baseSlug;
  let counter = 1;

  const query = {
    slug,
    ...(options.excludeId ? { _id: { $ne: options.excludeId } } : {})
  };

  while (await Model.findOne(query)) {
    slug = `${baseSlug}-${counter++}`;
    query.slug = slug;
  }

  return slug;
}

module.exports = generateUniqueSlug;
