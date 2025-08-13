// config/cloudinary.js
const cloudinary = require("cloudinary").v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Test connection
cloudinary.api
  .ping()
  .then(() => console.log("Cloudinary connection successful ✓"))
  .catch((error) =>
    console.error("Cloudinary connection failed ✗:", error.message)
  );

module.exports = cloudinary;