const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");

const app = express();
app.use(cors());
app.use(bodyParser.json());

/* ===============================
   MySQL CONNECTION POOL (FIXED)
   =============================== */
  
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: true
  }
});

/* ===============================
   HELPER: SQL ERROR HANDLER
   =============================== */
const sendSQLError = (res, err) => {
  console.error(err);
  return res.status(500).json({
    message: "Database error",
    error: err.message,
  });
};

/* ===============================
   HEALTH CHECK (OPTIONAL)
   =============================== */
app.get("/health", (req, res) => {
  res.json({ ok: true, message: "API is running" });
});

/* ===============================
   USER SIGNUP
   =============================== */
app.post("/api/signup", async (req, res) => {
  try {
    const { full_name, email, phone, password, confirmPassword } = req.body;

    if (!full_name || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: "Please fill all required fields" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    const [existing] = await db
      .promise()
      .query("SELECT id FROM users WHERE email = ?", [email]);

    if (existing.length > 0) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db
      .promise()
      .query(
        "INSERT INTO users (full_name, email, phone, password) VALUES (?, ?, ?, ?)",
        [full_name, email, phone || "", hashedPassword]
      );

    res.status(201).json({ message: "User signup successful" });
  } catch (err) {
    sendSQLError(res, err);
  }
});

/* ===============================
   USER LOGIN
   =============================== */
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const [users] = await db
      .promise()
      .query("SELECT * FROM users WHERE email = ?", [email]);

    if (users.length === 0) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const user = users[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    res.json({
      message: "Login success",
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (err) {
    sendSQLError(res, err);
  }
});

/* ===============================
   GET PLANTS (OPTIONAL FILTER)
   =============================== */
app.get("/api/plants", async (req, res) => {
  try {
    const { category } = req.query;

    let sql = "SELECT * FROM plants";
    let params = [];

    if (category) {
      sql += " WHERE category = ?";
      params.push(category);
    }

    const [plants] = await db.promise().query(sql, params);
    res.json(plants);
  } catch (err) {
    sendSQLError(res, err);
  }
});

/* ===============================
   ADD PLANT
   =============================== */
app.post("/api/plants", async (req, res) => {
  try {
    const { name, price, image, category } = req.body;

    if (!name || !price || !image || !category) {
      return res.status(400).json({ message: "Missing plant data" });
    }

    await db
      .promise()
      .query(
        "INSERT INTO plants (name, price, image, category) VALUES (?, ?, ?, ?)",
        [name, price, image, category]
      );

    res.status(201).json({ message: "Plant added" });
  } catch (err) {
    sendSQLError(res, err);
  }
});

/* ===============================
   FAVORITES
   =============================== */
app.get("/api/favorites/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    const [favorites] = await db.promise().query(
      `SELECT plants.* 
       FROM favorites 
       JOIN plants ON favorites.plant_id = plants.id
       WHERE favorites.user_id = ?`,
      [userId]
    );

    res.json(favorites);
  } catch (err) {
    sendSQLError(res, err);
  }
});

app.post("/api/favorites", async (req, res) => {
  try {
    const { user_id, plant_id } = req.body;

    if (!user_id || !plant_id) {
      return res.status(400).json({ message: "Missing user_id or plant_id" });
    }

    const [exists] = await db
      .promise()
      .query(
        "SELECT id FROM favorites WHERE user_id = ? AND plant_id = ?",
        [user_id, plant_id]
      );

    if (exists.length > 0) {
      return res.status(400).json({ message: "Already in favorites" });
    }

    await db
      .promise()
      .query(
        "INSERT INTO favorites (user_id, plant_id) VALUES (?, ?)",
        [user_id, plant_id]
      );

    res.json({ message: "Added to favorites" });
  } catch (err) {
    sendSQLError(res, err);
  }
});

app.delete("/api/favorites", async (req, res) => {
  try {
    const { user_id, plant_id } = req.body;

    await db
      .promise()
      .query(
        "DELETE FROM favorites WHERE user_id = ? AND plant_id = ?",
        [user_id, plant_id]
      );

    res.json({ message: "Removed from favorites" });
  } catch (err) {
    sendSQLError(res, err);
  }
});

/* ===============================
   CART
   =============================== */
app.get("/api/cart/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    const [cart] = await db.promise().query(
      `SELECT cart.id, plants.name, plants.price, plants.image, cart.quantity
       FROM cart
       JOIN plants ON cart.plant_id = plants.id
       WHERE cart.user_id = ?`,
      [userId]
    );

    res.json(cart);
  } catch (err) {
    sendSQLError(res, err);
  }
});

app.post("/api/cart", async (req, res) => {
  try {
    const { user_id, plant_id, quantity } = req.body;

    if (!user_id || !plant_id || !quantity) {
      return res.status(400).json({ message: "Missing cart data" });
    }

    const [existing] = await db
      .promise()
      .query(
        "SELECT * FROM cart WHERE user_id = ? AND plant_id = ?",
        [user_id, plant_id]
      );

    if (existing.length > 0) {
      await db
        .promise()
        .query(
          "UPDATE cart SET quantity = quantity + ? WHERE id = ?",
          [quantity, existing[0].id]
        );
      res.json({ message: "Cart updated" });
    } else {
      await db
        .promise()
        .query(
          "INSERT INTO cart (user_id, plant_id, quantity) VALUES (?, ?, ?)",
          [user_id, plant_id, quantity]
        );
      res.json({ message: "Added to cart" });
    }
  } catch (err) {
    sendSQLError(res, err);
  }
});

app.delete("/api/cart/:cartId", async (req, res) => {
  try {
    const cartId = req.params.cartId;

    await db.promise().query("DELETE FROM cart WHERE id = ?", [cartId]);
    res.json({ message: "Removed from cart" });
  } catch (err) {
    sendSQLError(res, err);
  }
});

/* ===============================
   CHECKOUT
   =============================== */
app.post("/api/checkout", async (req, res) => {
  try {
    const { user_id } = req.body;

    await db
      .promise()
      .query("DELETE FROM cart WHERE user_id = ?", [user_id]);

    res.json({ message: "Checkout successful" });
  } catch (err) {
    sendSQLError(res, err);
  }
});

/* ===============================
   START SERVER
   =============================== */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
