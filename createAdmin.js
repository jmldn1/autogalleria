require('dotenv').config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Admin = require("./models/Admin"); // make sure you have an Admin model

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected ✅"))
  .catch(err => console.error("MongoDB connection error:", err));

async function createAdmin() {
  try {
    const hashedPassword = await bcrypt.hash("password123", 10); // hash the password
    const admin = new Admin({
      username: "admin",
      password: hashedPassword
    });
    await admin.save();
    console.log("✅ Admin created successfully!");
  } catch (err) {
    console.error("Error creating admin:", err);
  } finally {
    await mongoose.connection.close();
  }
}

createAdmin();
