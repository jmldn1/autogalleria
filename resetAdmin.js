require('dotenv').config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Admin = require("./models/Admin");

const MONGO_URI = process.env.MONGO_URI || "yourMongoUriHere";

async function resetAdmin() {
  try {
    // 1️⃣ Connect to MongoDB
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log("✅ MongoDB connected");

    // 2️⃣ Delete old admin (if exists)
    const deleteResult = await Admin.deleteOne({ username: "admin" });
    if (deleteResult.deletedCount) console.log("🗑️ Old admin deleted");

    // 3️⃣ Create new admin
    const password = "SuperSecure123!"; // CHANGE this to your new password
    const hash = await bcrypt.hash(password, 10);

    const newAdmin = new Admin({ username: "admin", password: hash });
    await newAdmin.save();
    console.log("✅ New admin created with username: admin and password:", password);

    // 4️⃣ Optionally clear old sessions (MongoDB sessions collection)
    const db = mongoose.connection.db;
    const sessionsColl = await db.collection("sessions");
    const cleared = await sessionsColl.deleteMany({});
    console.log(`🧹 Cleared ${cleared.deletedCount} old session(s)`);

    console.log("🎉 Admin reset complete. You can now log in!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error resetting admin:", err);
    process.exit(1);
  }
}

resetAdmin();
