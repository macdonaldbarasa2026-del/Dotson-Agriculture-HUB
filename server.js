const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "database.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadDB() {
  if (!fs.existsSync(DATA_FILE)) {
    const db = { users: [], products: [], messages: [], subscribers: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    return db;
  }

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { users: [], products: [], messages: [], subscribers: [] };
  }
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function id() {
  return crypto.randomUUID();
}

function clean(value) {
  return String(value || "").trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;

  const [salt, originalHash] = stored.split(":");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");

  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(originalHash, "hex")
  );
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");

  if (req.method === "OPTIONS") return res.sendStatus(204);

  next();
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Dotson Agriculture HUB",
    independent: true
  });
});

app.get("/api/products", (req, res) => {
  res.json(db.products);
});

app.post("/api/register", (req, res) => {
  const name = clean(req.body.name);
  const email = clean(req.body.email).toLowerCase();
  const phone = clean(req.body.phone);
  const password = clean(req.body.password);

  if (!name || !email || !password) {
    return res.status(400).json({
      ok: false,
      error: "Name, email and password are required."
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      ok: false,
      error: "Password must be at least 6 characters."
    });
  }

  if (db.users.some(u => u.email === email)) {
    return res.status(409).json({
      ok: false,
      error: "A seller with this email already exists."
    });
  }

  const user = {
    id: id(),
    name,
    email,
    phone,
    passwordHash: hashPassword(password),
    role: "seller",
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  saveDB();

  res.status(201).json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role
    }
  });
});

app.post("/api/login", (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const password = clean(req.body.password);

  const user = db.users.find(u => u.email === email);

  if (!user) {
    return res.status(401).json({
      ok: false,
      error: "Invalid email or password."
    });
  }

  let valid = false;

  if (user.passwordHash) {
    valid = verifyPassword(password, user.passwordHash);
  } else if (user.password) {
    valid = user.password === password;

    if (valid) {
      user.passwordHash = hashPassword(password);
      delete user.password;
      saveDB();
    }
  }

  if (!valid) {
    return res.status(401).json({
      ok: false,
      error: "Invalid email or password."
    });
  }

  res.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role
    }
  });
});

app.post("/api/products", (req, res) => {
  const sellerId = clean(req.body.sellerId);
  const name = clean(req.body.name);
  const description = clean(req.body.description);
  const category = clean(req.body.category) || "Featured Products";
  const price = Number(req.body.price);

  if (!sellerId || !name || !description || !Number.isFinite(price)) {
    return res.status(400).json({
      ok: false,
      error: "Seller, product name, description and price are required."
    });
  }

  const seller = db.users.find(u => u.id === sellerId);

  if (!seller) {
    return res.status(401).json({
      ok: false,
      error: "Seller account not found."
    });
  }

  const product = {
    id: id(),
    sellerId,
    sellerName: seller.name,
    sellerEmail: seller.email,
    sellerPhone: seller.phone || "",
    name,
    description,
    category,
    price,
    image: clean(req.body.image),
    createdAt: new Date().toISOString()
  };

  db.products.push(product);
  saveDB();

  res.status(201).json({
    ok: true,
    product
  });
});

app.put("/api/products/:id", (req, res) => {
  const product = db.products.find(p => p.id === req.params.id);

  if (!product) {
    return res.status(404).json({
      ok: false,
      error: "Product not found."
    });
  }

  if (req.body.name !== undefined) product.name = clean(req.body.name);
  if (req.body.description !== undefined) product.description = clean(req.body.description);
  if (req.body.category !== undefined) product.category = clean(req.body.category);

  if (req.body.price !== undefined) {
    const price = Number(req.body.price);

    if (!Number.isFinite(price)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid product price."
      });
    }

    product.price = price;
  }

  if (req.body.image !== undefined) product.image = clean(req.body.image);

  saveDB();

  res.json({
    ok: true,
    product
  });
});

app.delete("/api/products/:id", (req, res) => {
  const before = db.products.length;

  db.products = db.products.filter(p => p.id !== req.params.id);

  if (db.products.length === before) {
    return res.status(404).json({
      ok: false,
      error: "Product not found."
    });
  }

  saveDB();

  res.json({ ok: true });
});

app.post("/api/contact", (req, res) => {
  const name = clean(req.body.name);
  const email = clean(req.body.email);
  const message = clean(req.body.message);
  const sellerId = clean(req.body.sellerId);
  const productId = clean(req.body.productId);

  if (!name || !email || !message) {
    return res.status(400).json({
      ok: false,
      error: "Name, email and message are required."
    });
  }

  db.messages.push({
    id: id(),
    name,
    email,
    message,
    sellerId,
    productId,
    createdAt: new Date().toISOString()
  });

  saveDB();

  res.status(201).json({
    ok: true,
    message: "Message sent successfully."
  });
});

app.get("/api/messages", (req, res) => {
  res.json(db.messages);
});

app.post("/api/subscribe", (req, res) => {
  const name = clean(req.body.name);
  const email = clean(req.body.email).toLowerCase();

  if (!email) {
    return res.status(400).json({
      ok: false,
      error: "Email is required."
    });
  }

  if (!db.subscribers.some(s => s.email === email)) {
    db.subscribers.push({
      id: id(),
      name,
      email,
      createdAt: new Date().toISOString()
    });

    saveDB();
  }

  res.status(201).json({
    ok: true,
    message: "Subscription successful."
  });
});

app.use(express.static(__dirname, {
  extensions: ["html"]
}));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dotson Agriculture HUB running on port ${PORT}`);
});
