const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const postModel = require("../models/post");
const userModel = require("../models/user");
const mongoose = require("mongoose");
const uploadFile = require("../middleware/multer.middleware");
const fs = require("fs");
const path = require("path");
const cloudinary = require("../config/cloudinary");

const JWT_SECRET = process.env.JWT_SECRET_KEY;

// Middleware to check if logged in
function isLoggedIn(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect("/login");

  try {
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data;
    next();
  } catch (err) {
    res.clearCookie("token");
    return res.redirect("/login");
  }
}

// Dashboard
router.get("/dashboard", isLoggedIn, async (req, res) => {
  try {
    const user = await userModel.findById(req.user.id).lean();
    if (!user) {
      res.clearCookie("token");
      return res.redirect("/login");
    }

    const allPosts = await postModel
      .find({})
      .populate("user")
      .sort({ date: -1 })
      .lean();

    res.render("dashboard", { user, allPosts });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.clearCookie("token");
    res.redirect("/login");
  }
});

// Profile page
router.get("/profile", isLoggedIn, async (req, res) => {
  try {
    const user = await userModel.findById(req.user.id).lean();
    if (!user) {
      res.clearCookie("token");
      return res.redirect("/login");
    }

    // Get only the logged-in user's posts
    const myPosts = await postModel
      .find({ user: req.user.id })
      .populate("user")
      .sort({ date: -1 })
      .lean();

    res.render("profile", { user, myPosts });
  } catch (err) {
    console.error("Profile page error:", err);
    res.clearCookie("token");
    res.redirect("/login");
  }
});

// Delete post route
router.delete("/posts/:id", isLoggedIn, async (req, res) => {
  try {
    const postId = req.params.id;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    // Find the post and check if it belongs to the logged-in user
    const post = await postModel.findOne({
      _id: postId,
      user: req.user.id,
    });

    if (!post) {
      return res.status(404).json({ error: "Post not found or unauthorized" });
    }

    // If post has an image on Cloudinary, delete it
    if (post.imgUrl) {
      try {
        // Extract public_id from Cloudinary URL
        const urlParts = post.imgUrl.split("/");
        const publicIdWithExtension = urlParts[urlParts.length - 1];
        const publicId = `uploads/${publicIdWithExtension.split(".")[0]}`;

        // Delete from Cloudinary
        await cloudinary.uploader.destroy(publicId);
        // console.log(`Deleted image from Cloudinary: ${publicId}`);
      } catch (cloudinaryError) {
        console.error("Error deleting image from Cloudinary:", cloudinaryError);
        // Continue with post deletion even if image deletion fails
      }
    }

    // Delete the post from database
    await postModel.findByIdAndDelete(postId);

    // Remove post reference from user's posts array
    await userModel.findByIdAndUpdate(req.user.id, {
      $pull: { post: postId },
    });

    // console.log(`Post ${postId} deleted successfully`);
    res.status(200).json({ message: "Post deleted successfully" });
  } catch (err) {
    console.error("Error deleting post:", err);
    res.status(500).json({ error: "Error deleting post. Please try again." });
  }
});

// Create post form
router.get("/create-post", isLoggedIn, async (req, res) => {
  try {
    const user = await userModel.findById(req.user.id).lean();
    if (!user) {
      res.clearCookie("token");
      return res.redirect("/login");
    }
    res.render("create-post", { user });
  } catch (err) {
    console.error("Create post page error:", err);
    res.clearCookie("token");
    res.redirect("/login");
  }
});

// Create post - ON CLOUDINARY
router.post(
  "/create-post",
  isLoggedIn,
  uploadFile.single("file"),
  async (req, res) => {
    try {
      const { content } = req.body;

      // Validate content
      if (!content || content.trim().length === 0) {
        // Clean up uploaded file if it exists
        if (req.file) {
          fs.unlink(req.file.path, (err) => {
            if (err) console.error("Error deleting file:", err);
          });
        }
        return res.status(400).send("Content is required");
      }

      // Create post data
      const postData = {
        user: req.user.id,
        content: content.trim(),
        date: new Date(),
      };

      // Handle image upload to Cloudinary if file exists
      if (req.file) {
        try {
          const localFilePath = req.file.path;
          // console.log("Starting Cloudinary upload for:", localFilePath);

          // Upload to Cloudinary
          const result = await cloudinary.uploader.upload(localFilePath, {
            folder: "uploads", // Cloudinary folder
            resource_type: "auto", // Auto-detect file type
            transformation: [
              { width: 1000, height: 1000, crop: "limit" },
              { quality: "auto", fetch_format: "auto" },
            ],
          });

          // console.log("Cloudinary upload successful:", result.secure_url);

          // Store Cloudinary URL in postData
          postData.imgUrl = result.secure_url;

          // Remove local temp file after successful upload
          fs.unlink(localFilePath, (err) => {
            if (err) console.error("Failed to delete local file:", err);
            // else console.log("Local temp file deleted successfully");
          });
        } catch (cloudinaryError) {
          console.error("Cloudinary upload failed:", cloudinaryError);

          // Clean up local file
          if (req.file && req.file.path) {
            fs.unlink(req.file.path, (err) => {
              if (err)
                console.error(
                  "Error deleting file after Cloudinary error:",
                  err
                );
            });
          }

          return res.status(500).send("Image upload failed. Please try again.");
        }
      }

      // console.log("Creating post with final data:", postData);

      // Save post to DB
      const newPost = await postModel.create(postData);

      // Update user's post array
      await userModel.findByIdAndUpdate(req.user.id, {
        $push: { post: newPost._id },
      });

      // console.log("Post created successfully with ID:", newPost._id);
      res.redirect("/dashboard");
    } catch (err) {
      console.error("Error creating post:", err);

      // Clean up uploaded file if there was an error
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, (unlinkErr) => {
          if (unlinkErr)
            console.error("Error deleting file after error:", unlinkErr);
        });
      }

      res.status(500).send("Error creating post. Please try again.");
    }
  }
);

module.exports = router;
