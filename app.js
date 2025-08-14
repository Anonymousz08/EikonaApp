const express = require("express");
const app = express();
require("dotenv").config();
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const multer = require("multer");
const favicon = require("serve-favicon");

// Import routes
const authRoutes = require("./routes/auth.routes");
const dashboardRoutes = require("./routes/dashboard.routes");

// Security middleware - Add helmet first
app.use(
  helmet({
    contentSecurityPolicy: false, // Disable CSP for now due to inline styles
  })
);

// CORS configuration
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Compression for better performance
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Strict rate limit for auth endpoints
// const authLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 10, // 10 attempts per 15 minutes
//   message: "Too many login attempts, please try again later.",
//   standardHeaders: true,
//   legacyHeaders: false,
// });

// Apply rate limiting
// app.use("/login", authLimiter);
// app.use("/register", authLimiter);

// Basic middleware
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.json({ limit: "10mb" })); // Add size limit
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(favicon(path.join(__dirname, "public", "favicon.png")));

// Static file serving with caching
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
  })
);

// Improved MongoDB connection with better error handling
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("✓ Connected to MongoDB");
  })
  .catch((error) => {
    console.error("✗ MongoDB connection error:", error);
    process.exit(1); // Exit if database connection fails
  });

// MongoDB connection event handlers
mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("MongoDB disconnected");
});

// Graceful shutdown
process.on("SIGINT", async () => {
  try {
    await mongoose.connection.close();
    console.log("MongoDB connection closed through app termination");
    process.exit(0);
  } catch (err) {
    console.error("Error during graceful shutdown:", err);
    process.exit(1);
  }
});

// Home route with improved error handling
app.get("/", (req, res) => {
  const token = req.cookies.token;
  if (token) {
    const jwt = require("jsonwebtoken");
    try {
      jwt.verify(token, process.env.JWT_SECRET_KEY);
      return res.redirect("/dashboard");
    } catch (err) {
      res.clearCookie("token");
    }
  }
  res.redirect("/login");
});

// Health check endpoint (useful for deployment platforms)
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Use routes
app.use("/", authRoutes);
app.use("/", dashboardRoutes);

// Global error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);

  // Multer file upload errors
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ error: "File too large. Maximum size is 50MB." });
    }
    return res.status(400).json({ error: "File upload error." });
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({ error: "Invalid token." });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({ error: "Token expired." });
  }

  // MongoDB errors
  if (err.name === "ValidationError") {
    return res.status(400).json({ error: "Validation error." });
  }

  if (err.name === "CastError") {
    return res.status(400).json({ error: "Invalid data format." });
  }

  // Default error response
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Something went wrong!"
        : err.message,
  });
});

// 404 handler for undefined routes
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "API endpoint not found" });
  } else {
    res.status(404).render("404", {
      message: "Page not found",
      title: "Page Not Found",
    });
  }
});

// Server startup
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  // console.log(`🚀 Server running on http://localhost:${PORT}`);
  // console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
});

// Graceful server shutdown
const gracefulShutdown = () => {
  console.log("Received kill signal, shutting down gracefully...");
  server.close(() => {
    console.log("HTTP server closed.");
    mongoose.connection.close(false, () => {
      console.log("MongoDB connection closed.");
      process.exit(0);
    });
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down"
    );
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
