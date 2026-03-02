require("dotenv").config(); // load .env at the top
const mongoose = require("mongoose");
const Car = require("../models/Car");

async function backfillSlugs() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {}); // use Atlas connection, not localhost
    console.log("✅ Connected to MongoDB");

    const cars = await Car.find({ $or: [{ slug: { $exists: false } }, { slug: "" }] });
    console.log(`Found ${cars.length} cars missing slugs`);

    for (let car of cars) {
      car.slug = `${car.make}-${car.model}-${car.year}`
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      await car.save();
      console.log(`Updated car: ${car.make} ${car.model} → slug: ${car.slug}`);
    }

    console.log("🎉 Slug backfill complete!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

backfillSlugs();
