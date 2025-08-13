const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const userModel = require("../models/user");

const JWT_SECRET = process.env.JWT_SECRET_KEY;

// Redirect if logged in middleware
function redirectIfLoggedIn(req, res, next) {
  const token = req.cookies.token;
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      return res.redirect("/dashboard");
    } catch (err) {
      res.clearCookie("token");
    }
  }
  next();
}

// Register
router.get("/register", redirectIfLoggedIn, (req, res) => {
  res.render("register");
});

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await userModel.findOne({ email });
    if (existingUser) {
      return res.redirect("/register?error=User with this email is already exists");
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await userModel.create({ name, email, password: hash });

    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    res.cookie("token", token, {
      httpOnly: true,
      maxAge: 90 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });

    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal Server Error");
  }
});

// login
router.get("/login", redirectIfLoggedIn, (req, res) => {
  res.render("login");
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await userModel.findOne({ email });
    if (!user) return res.redirect("/login?error=user with this email does not exists.");

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.redirect("/login?error=Wrong password");

    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    res.cookie("token", token, {
      httpOnly: true,
      maxAge: 90 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });

    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal Server Error");
  }
});

// logout
router.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/");
});

module.exports = router;