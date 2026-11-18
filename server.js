if (process.env.NODE_ENV !== "test") require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const express = require("express");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.RENTEASE_DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "rentease.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Initialize core base schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'landlord', 'tenant')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS properties (
    id TEXT PRIMARY KEY,
    landlord_id TEXT REFERENCES users(id),
    tenant_id TEXT UNIQUE REFERENCES users(id),
    lease_end TEXT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    type TEXT NOT NULL,
    bedrooms INTEGER NOT NULL,
    bathrooms INTEGER NOT NULL,
    rent REAL NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    property_id TEXT NOT NULL REFERENCES properties(id),
    tenant_id TEXT NOT NULL REFERENCES users(id),
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Paid', 'Pending')),
    method TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS maintenance_requests (
    id TEXT PRIMARY KEY,
    property_id TEXT NOT NULL REFERENCES properties(id),
    tenant_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('Normal', 'High', 'Urgent')),
    status TEXT NOT NULL CHECK (status IN ('Open', 'In progress', 'Resolved')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_properties_landlord ON properties(landlord_id);
  CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_requests_tenant ON maintenance_requests(tenant_id);
`);

// Safe non-destructive migrations to maximize database utility
function migrateDatabase() {
  const propertyCols = db.prepare("PRAGMA table_info(properties)").all().map((c) => c.name);
  if (!propertyCols.includes("city")) db.exec("ALTER TABLE properties ADD COLUMN city TEXT DEFAULT ''");
  if (!propertyCols.includes("state")) db.exec("ALTER TABLE properties ADD COLUMN state TEXT DEFAULT ''");
  if (!propertyCols.includes("zip")) db.exec("ALTER TABLE properties ADD COLUMN zip TEXT DEFAULT ''");
  if (!propertyCols.includes("sqft")) db.exec("ALTER TABLE properties ADD COLUMN sqft INTEGER DEFAULT 0");
  if (!propertyCols.includes("deposit")) db.exec("ALTER TABLE properties ADD COLUMN deposit REAL DEFAULT 0");
  if (!propertyCols.includes("status")) db.exec("ALTER TABLE properties ADD COLUMN status TEXT DEFAULT 'available'");
  if (!propertyCols.includes("amenities")) db.exec("ALTER TABLE properties ADD COLUMN amenities TEXT DEFAULT '[]'");
  if (!propertyCols.includes("image_url")) db.exec("ALTER TABLE properties ADD COLUMN image_url TEXT DEFAULT ''");
  if (!propertyCols.includes("description")) db.exec("ALTER TABLE properties ADD COLUMN description TEXT DEFAULT ''");
  if (!propertyCols.includes("latitude")) db.exec("ALTER TABLE properties ADD COLUMN latitude REAL DEFAULT 0");
  if (!propertyCols.includes("longitude")) db.exec("ALTER TABLE properties ADD COLUMN longitude REAL DEFAULT 0");

  const paymentCols = db.prepare("PRAGMA table_info(payments)").all().map((c) => c.name);
  if (!paymentCols.includes("reference_no")) db.exec("ALTER TABLE payments ADD COLUMN reference_no TEXT");
  if (!paymentCols.includes("period_month")) db.exec("ALTER TABLE payments ADD COLUMN period_month TEXT DEFAULT ''");
  if (!paymentCols.includes("notes")) db.exec("ALTER TABLE payments ADD COLUMN notes TEXT DEFAULT ''");

  const requestCols = db.prepare("PRAGMA table_info(maintenance_requests)").all().map((c) => c.name);
  if (!requestCols.includes("resolved_at")) db.exec("ALTER TABLE maintenance_requests ADD COLUMN resolved_at TEXT");
  if (!requestCols.includes("resolution_notes")) db.exec("ALTER TABLE maintenance_requests ADD COLUMN resolution_notes TEXT DEFAULT ''");
  if (!requestCols.includes("cost")) db.exec("ALTER TABLE maintenance_requests ADD COLUMN cost REAL DEFAULT 0");
  if (!requestCols.includes("photo_url")) db.exec("ALTER TABLE maintenance_requests ADD COLUMN photo_url TEXT DEFAULT ''");
  if (!requestCols.includes("resolution_photo_url")) db.exec("ALTER TABLE maintenance_requests ADD COLUMN resolution_photo_url TEXT DEFAULT ''");

  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      role TEXT NOT NULL,
      action_type TEXT NOT NULL,
      title TEXT NOT NULL,
      details TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS leases (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id),
      tenant_id TEXT NOT NULL REFERENCES users(id),
      landlord_id TEXT NOT NULL REFERENCES users(id),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      rent_amount REAL NOT NULL,
      deposit_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Active',
      signature_data TEXT DEFAULT '',
      signed_at TEXT DEFAULT '',
      signed_by TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      property_id TEXT REFERENCES properties(id),
      landlord_id TEXT NOT NULL REFERENCES users(id),
      category TEXT NOT NULL CHECK (category IN ('Repairs', 'Taxes', 'Insurance', 'Utilities', 'Mortgage', 'Management', 'Other')),
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      landlord_id TEXT NOT NULL REFERENCES users(id),
      property_id TEXT REFERENCES properties(id),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal', 'Important', 'Urgent')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL REFERENCES users(id),
      recipient_id TEXT NOT NULL REFERENCES users(id),
      property_id TEXT REFERENCES properties(id),
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_properties_tenant ON properties(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_payments_property ON payments(property_id);
    CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
    CREATE INDEX IF NOT EXISTS idx_requests_property ON maintenance_requests(property_id);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON maintenance_requests(status);
    CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_leases_property ON leases(property_id);
    CREATE INDEX IF NOT EXISTS idx_leases_tenant ON leases(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_property ON expenses(property_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_landlord ON expenses(landlord_id);
    CREATE INDEX IF NOT EXISTS idx_announcements_landlord ON announcements(landlord_id);
    CREATE INDEX IF NOT EXISTS idx_announcements_property ON announcements(property_id);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id);
  `);

  const leaseCols = db.prepare("PRAGMA table_info(leases)").all().map((c) => c.name);
  if (!leaseCols.includes("signature_data")) db.exec("ALTER TABLE leases ADD COLUMN signature_data TEXT DEFAULT ''");
  if (!leaseCols.includes("signed_at")) db.exec("ALTER TABLE leases ADD COLUMN signed_at TEXT DEFAULT ''");
  if (!leaseCols.includes("signed_by")) db.exec("ALTER TABLE leases ADD COLUMN signed_by TEXT DEFAULT ''");
}
migrateDatabase();

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
    this.read = database.prepare("SELECT sess, expires FROM sessions WHERE sid = ?");
    this.write = database.prepare("INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires");
    this.remove = database.prepare("DELETE FROM sessions WHERE sid = ?");
    this.touchStatement = database.prepare("UPDATE sessions SET expires = ? WHERE sid = ?");
    this.deleteExpired = database.prepare("DELETE FROM sessions WHERE expires <= ?");
  }

  get(sid, callback) {
    try {
      const row = this.read.get(sid);
      if (!row) return callback(null, null);
      if (row.expires <= Date.now()) {
        this.remove.run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.sess));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, value, callback = () => {}) {
    try {
      const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000;
      this.write.run(sid, JSON.stringify(value), expires);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  touch(sid, value, callback = () => {}) {
    try {
      const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000;
      this.touchStatement.run(expires, sid);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.remove.run(sid);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }
}

const insertUser = db.prepare("INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)");

function provisionAdmin() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  const configured = [ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD].some(Boolean);
  if (!configured) {
    console.warn("No admin account configured. Set ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD in .env to provision one.");
    return;
  }
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
    throw new Error("Admin setup requires ADMIN_NAME, ADMIN_EMAIL, and an ADMIN_PASSWORD of at least 12 characters.");
  }
  const email = ADMIN_EMAIL.trim().toLowerCase();
  const existing = db.prepare("SELECT id, role FROM users WHERE email = ?").get(email);
  if (existing) {
    if (existing.role !== "admin") throw new Error("ADMIN_EMAIL is already registered as a non-admin account.");
    return;
  }
  insertUser.run(crypto.randomUUID(), ADMIN_NAME.trim(), email, bcrypt.hashSync(ADMIN_PASSWORD, 12), "admin", new Date().toISOString());
  console.log(`Provisioned admin account ${email}.`);
}

provisionAdmin();

const app = express();
app.set("trust proxy", 1);
const server = require("node:http").createServer(app);
const io = new Server(server);
const sessionMiddleware = session({
  name: "rentease.sid",
  secret: process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex"),
  store: new SQLiteSessionStore(db),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24
  }
});

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://images.unsplash.com", "https://*.unsplash.com", "https://*.tile.openstreetmap.org", "https://unpkg.com"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));
app.use(express.json({ limit: "2mb" })); // Supports signature canvas data
app.use((req, _res, next) => {
  req.body = req.body && typeof req.body === "object" ? req.body : {};
  next();
});
app.use(sessionMiddleware);

io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  const userId = socket.request.session?.userId;
  const user = userId ? db.prepare("SELECT id, name, role, active FROM users WHERE id = ?").get(userId) : null;
  if (!user || !user.active) return next(new Error("Authentication required"));
  socket.user = user;
  return next();
});
io.on("connection", (socket) => {
  socket.join(`user:${socket.user.id}`);
  socket.join(`role:${socket.user.role}`);
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please wait a few minutes and try again." }
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireAuth(req, res, next) {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: "Sign in to continue." });
  const user = db.prepare("SELECT id, name, email, role, active FROM users WHERE id = ?").get(userId);
  if (!user || !user.active) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Your session is no longer active. Sign in again." });
  }
  req.user = user;
  return next();
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "You do not have permission to do that." });
    return next();
  };
}

function cleanString(value, label, maxLength = 180) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpError(400, `${label} is required and must be at most ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalString(value, maxLength = 2000, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const str = String(value).trim();
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

function positiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100000000) throw new HttpError(400, `${label} must be a positive number.`);
  return parsed;
}

function nonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function validDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new HttpError(400, `${label} must be a valid date.`);
  }
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new HttpError(400, `${label} must be a valid date.`);
  return value;
}

function newId() {
  return crypto.randomUUID();
}

function generateReferenceNo() {
  const year = new Date().getFullYear();
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `RE-${year}-${rand}`;
}

function currentIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function findPropertyForWrite(propertyId, user) {
  const property = db.prepare("SELECT * FROM properties WHERE id = ?").get(propertyId);
  if (!property) throw new HttpError(404, "Property not found.");
  if (user.role !== "admin" && property.landlord_id !== user.id) throw new HttpError(403, "You do not manage this property.");
  return property;
}

function broadcastDataChanged() {
  io.emit("data:changed");
}

function logActivity(userId, role, actionType, title, details, entityType = null, entityId = null) {
  try {
    db.prepare(`
      INSERT INTO activity_logs (id, user_id, role, action_type, title, details, entity_type, entity_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newId(), userId, role, actionType, title, details, entityType, entityId, new Date().toISOString());
  } catch (error) {
    console.error("Failed to write activity log:", error);
  }
}

function withErrorHandling(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

// ----------------- AUTH ROUTES -----------------

app.get("/api/auth/session", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare("SELECT id, name, email, role FROM users WHERE id = ? AND active = 1").get(req.session.userId);
  if (!user) return res.json({ user: null });
  return res.json({ user });
});

app.post("/api/auth/signup", authLimiter, withErrorHandling(async (req, res) => {
  const name = cleanString(req.body.name, "Name", 100);
  const email = cleanString(req.body.email, "Email", 254).toLowerCase();
  const password = req.body.password;
  const role = req.body.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  if (typeof password !== "string" || password.length < 10 || password.length > 128) {
    throw new HttpError(400, "Password must be between 10 and 128 characters.");
  }
  if (role !== "landlord" && role !== "tenant") throw new HttpError(400, "Choose a landlord or tenant account.");
  const id = newId();
  try {
    insertUser.run(id, name, email, await bcrypt.hash(password, 12), role, new Date().toISOString());
    logActivity(id, role, "account_created", `New ${role} registered`, `${name} (${email}) joined the workspace`, "user", id);
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") throw new HttpError(409, "An account with that email already exists.");
    throw error;
  }
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = id;
  await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
  broadcastDataChanged();
  res.status(201).json({ user: { id, name, email, role } });
}));

app.post("/api/auth/login", authLimiter, withErrorHandling(async (req, res) => {
  const email = cleanString(req.body.email, "Email", 254).toLowerCase();
  const password = req.body.password;
  if (typeof password !== "string" || password.length > 128) throw new HttpError(400, "Email or password is incorrect.");
  const user = db.prepare("SELECT id, name, email, password_hash, role, active FROM users WHERE email = ?").get(email);
  const matches = await bcrypt.compare(password, user?.password_hash || "$2a$12$4G8JvBEKS9Jc8hDRv1dHKeqzF1MVLzmTe64n8hBeV1m6f8x3gOR7C");
  if (!user || !user.active || !matches) throw new HttpError(401, "Email or password is incorrect.");
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}));

app.post("/api/auth/logout", requireAuth, (req, res, next) => {
  const userId = req.user.id;
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("rentease.sid", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    io.in(`user:${userId}`).disconnectSockets(true);
    return res.json({ ok: true });
  });
});

// ----------------- MAIN WORKSPACE DATA (AGGREGATED & SCOPED) -----------------

app.get("/api/data", requireAuth, (req, res) => {
  const user = req.user;
  let properties;
  if (user.role === "admin") {
    properties = db.prepare(`
      SELECT p.*, u.name AS tenant_name, u.email AS tenant_email, l.name AS landlord_name
      FROM properties p
      LEFT JOIN users u ON u.id = p.tenant_id
      LEFT JOIN users l ON l.id = p.landlord_id
      ORDER BY p.created_at DESC
    `).all();
  } else if (user.role === "landlord") {
    properties = db.prepare(`
      SELECT p.*, u.name AS tenant_name, u.email AS tenant_email, l.name AS landlord_name
      FROM properties p
      LEFT JOIN users u ON u.id = p.tenant_id
      LEFT JOIN users l ON l.id = p.landlord_id
      WHERE p.landlord_id = ?
      ORDER BY p.created_at DESC
    `).all(user.id);
  } else {
    properties = db.prepare(`
      SELECT p.*, u.name AS tenant_name, u.email AS tenant_email, l.name AS landlord_name, l.email AS landlord_email
      FROM properties p
      LEFT JOIN users u ON u.id = p.tenant_id
      LEFT JOIN users l ON l.id = p.landlord_id
      WHERE p.tenant_id = ?
      ORDER BY p.created_at DESC
    `).all(user.id);
  }

  const propertyIds = properties.map((p) => p.id);
  let tenants = [];
  let payments = [];
  let requests = [];
  let users = [];
  let activities = [];
  let expenses = [];
  let announcements = [];
  let leases = [];
  let messages = [];

  if (propertyIds.length) {
    const placeholders = propertyIds.map(() => "?").join(",");
    tenants = db.prepare(`
      SELECT u.id, u.name, u.email, p.id AS property_id, p.name AS property_name, p.lease_end, p.rent
      FROM properties p
      JOIN users u ON u.id = p.tenant_id
      WHERE p.id IN (${placeholders})
    `).all(...propertyIds);

    const tenantPaymentScope = user.role === "tenant" ? " AND pay.tenant_id = ?" : "";
    const tenantRequestScope = user.role === "tenant" ? " AND r.tenant_id = ?" : "";
    const tenantScope = user.role === "tenant" ? [user.id] : [];

    payments = db.prepare(`
      SELECT pay.id, pay.tenant_id, pay.property_id, pay.amount, pay.date, pay.status, pay.method,
             pay.reference_no, pay.period_month, pay.notes,
             u.name AS tenant_name, u.email AS tenant_email, p.name AS property_name
      FROM payments pay
      JOIN users u ON u.id = pay.tenant_id
      JOIN properties p ON p.id = pay.property_id
      WHERE pay.property_id IN (${placeholders})${tenantPaymentScope}
      ORDER BY pay.date DESC, pay.created_at DESC
    `).all(...propertyIds, ...tenantScope);

    requests = db.prepare(`
      SELECT r.id, r.tenant_id, r.property_id, r.title, r.description, r.category, r.priority, r.status,
             r.cost, r.resolved_at, r.resolution_notes, r.photo_url, r.resolution_photo_url, r.created_at AS date,
             u.name AS tenant_name, p.name AS property_name
      FROM maintenance_requests r
      JOIN users u ON u.id = r.tenant_id
      JOIN properties p ON p.id = r.property_id
      WHERE r.property_id IN (${placeholders})${tenantRequestScope}
      ORDER BY r.created_at DESC
    `).all(...propertyIds, ...tenantScope);

    leases = db.prepare(`
      SELECT l.*, p.name AS property_name, u.name AS tenant_name
      FROM leases l
      JOIN properties p ON p.id = l.property_id
      JOIN users u ON u.id = l.tenant_id
      WHERE l.property_id IN (${placeholders})
      ORDER BY l.created_at DESC
    `).all(...propertyIds);
  }

  if (user.role === "tenant" && !tenants.some((t) => t.id === user.id)) {
    tenants = [{ id: user.id, name: user.name, email: user.email, property_id: null, lease_end: null }];
  }

  if (user.role === "admin") {
    users = db.prepare("SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at DESC").all();
    activities = db.prepare("SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 25").all();
    expenses = db.prepare(`
      SELECT e.*, p.name AS property_name FROM expenses e
      LEFT JOIN properties p ON p.id = e.property_id
      ORDER BY e.date DESC LIMIT 50
    `).all();
    announcements = db.prepare("SELECT a.*, u.name AS author_name FROM announcements a JOIN users u ON u.id = a.landlord_id ORDER BY a.created_at DESC").all();
  } else if (user.role === "landlord") {
    activities = db.prepare(`
      SELECT * FROM activity_logs
      WHERE user_id = ? OR entity_id IN (SELECT id FROM properties WHERE landlord_id = ?)
      ORDER BY created_at DESC LIMIT 20
    `).all(user.id, user.id);
    expenses = db.prepare(`
      SELECT e.*, p.name AS property_name FROM expenses e
      LEFT JOIN properties p ON p.id = e.property_id
      WHERE e.landlord_id = ?
      ORDER BY e.date DESC
    `).all(user.id);
    announcements = db.prepare("SELECT * FROM announcements WHERE landlord_id = ? ORDER BY created_at DESC").all(user.id);
  } else {
    activities = db.prepare("SELECT * FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 15").all(user.id);
    const assignedProperty = properties[0];
    announcements = assignedProperty
      ? db.prepare("SELECT a.*, u.name AS author_name FROM announcements a JOIN users u ON u.id = a.landlord_id WHERE a.property_id = ? OR a.property_id IS NULL OR a.property_id = '' ORDER BY a.created_at DESC").all(assignedProperty.id)
      : [];
  }

  // Messages involving current user
  messages = db.prepare(`
    SELECT m.*, s.name AS sender_name, r.name AS recipient_name
    FROM messages m
    JOIN users s ON s.id = m.sender_id
    JOIN users r ON r.id = m.recipient_id
    WHERE m.sender_id = ? OR m.recipient_id = ?
    ORDER BY m.created_at ASC
  `).all(user.id, user.id);

  // Database-computed portfolio statistics (using SQL aggregations)
  const totalCollected = payments.filter((p) => p.status === "Paid").reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const netIncome = totalCollected - totalExpenses;

  let stats = {
    totalProperties: properties.length,
    occupiedProperties: properties.filter((p) => p.tenant_id).length,
    vacantProperties: properties.filter((p) => !p.tenant_id).length,
    occupancyRate: properties.length ? Math.round((properties.filter((p) => p.tenant_id).length / properties.length) * 100) : 0,
    totalMonthlyRent: properties.reduce((sum, p) => sum + Number(p.rent || 0), 0),
    totalCollected,
    totalPending: payments.filter((p) => p.status === "Pending").reduce((sum, p) => sum + Number(p.amount || 0), 0),
    totalExpenses,
    netIncome,
    openTickets: requests.filter((r) => r.status !== "Resolved").length
  };

  res.json({
    user,
    properties: properties.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      city: p.city || "",
      state: p.state || "",
      zip: p.zip || "",
      type: p.type,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      sqft: p.sqft || 0,
      rent: p.rent,
      deposit: p.deposit || 0,
      latitude: p.latitude || 0,
      longitude: p.longitude || 0,
      status: p.tenant_id ? "occupied" : (p.status || "available"),
      amenities: (() => { try { return JSON.parse(p.amenities || "[]"); } catch { return []; } })(),
      imageUrl: p.image_url || "",
      description: p.description || "",
      landlordId: p.landlord_id,
      landlordName: p.landlord_name || "",
      tenantId: p.tenant_id || "",
      tenantName: p.tenant_name || "",
      tenantEmail: p.tenant_email || "",
      leaseEnd: p.lease_end || "",
      createdAt: p.created_at
    })),
    tenants: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      email: t.email,
      propertyId: t.property_id || "",
      propertyName: t.property_name || "",
      leaseEnd: t.lease_end || "",
      rent: t.rent || 0
    })),
    payments: payments.map((p) => ({
      id: p.id,
      tenantId: p.tenant_id,
      tenantName: p.tenant_name,
      tenantEmail: p.tenant_email,
      propertyId: p.property_id,
      propertyName: p.property_name,
      amount: p.amount,
      date: p.date,
      status: p.status,
      method: p.method,
      referenceNo: p.reference_no || `RE-${p.id.slice(0, 8).toUpperCase()}`,
      periodMonth: p.period_month || "",
      notes: p.notes || ""
    })),
    requests: requests.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      propertyId: r.property_id,
      propertyName: r.property_name,
      title: r.title,
      description: r.description,
      category: r.category,
      priority: r.priority,
      status: r.status,
      cost: r.cost || 0,
      photoUrl: r.photo_url || "",
      resolutionPhotoUrl: r.resolution_photo_url || "",
      resolvedAt: r.resolved_at || null,
      resolutionNotes: r.resolution_notes || "",
      date: r.date.slice(0, 10)
    })),
    expenses: expenses.map((e) => ({
      id: e.id,
      propertyId: e.property_id,
      propertyName: e.property_name || "General Portfolio",
      category: e.category,
      amount: e.amount,
      date: e.date,
      description: e.description
    })),
    announcements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      priority: a.priority,
      propertyId: a.property_id || "",
      authorName: a.author_name || "Management",
      createdAt: a.created_at
    })),
    leases: leases.map((l) => ({
      id: l.id,
      propertyId: l.property_id,
      propertyName: l.property_name,
      tenantId: l.tenant_id,
      tenantName: l.tenant_name,
      startDate: l.start_date,
      endDate: l.end_date,
      rentAmount: l.rent_amount,
      depositAmount: l.deposit_amount,
      status: l.status,
      signatureData: l.signature_data || "",
      signedAt: l.signed_at || "",
      signedBy: l.signed_by || ""
    })),
    messages: messages.map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      senderName: m.sender_name,
      recipientId: m.recipient_id,
      recipientName: m.recipient_name,
      message: m.message,
      createdAt: m.created_at
    })),
    activity: activities.map((a) => ({
      id: a.id,
      role: a.role,
      actionType: a.action_type,
      title: a.title,
      details: a.details,
      entityType: a.entity_type,
      entityId: a.entity_id,
      createdAt: a.created_at
    })),
    stats,
    users
  });
});

// ----------------- PROPERTY ENDPOINTS (TRANSACTIONAL) -----------------

app.post("/api/properties", requireAuth, allowRoles("landlord", "admin"), withErrorHandling(async (req, res) => {
  const name = cleanString(req.body.name, "Property name");
  const address = cleanString(req.body.address, "Address");
  const type = cleanString(req.body.type, "Property type", 50);
  const bedrooms = Number(req.body.bedrooms);
  const bathrooms = Number(req.body.bathrooms);
  const rent = positiveNumber(req.body.rent, "Rent");

  const city = optionalString(req.body.city, 100);
  const state = optionalString(req.body.state, 50);
  const zip = optionalString(req.body.zip, 20);
  const sqft = nonNegativeNumber(req.body.sqft, 0);
  const deposit = nonNegativeNumber(req.body.deposit, rent);
  const description = optionalString(req.body.description, 1000);
  const imageUrl = optionalString(req.body.imageUrl, 500);
  const amenities = Array.isArray(req.body.amenities) ? JSON.stringify(req.body.amenities.map(String)) : "[]";
  const latitude = (req.body.latitude !== undefined && req.body.latitude !== "" && !isNaN(Number(req.body.latitude))) ? Number(req.body.latitude) : (37.7749 + (Math.random() - 0.5) * 0.1);
  const longitude = (req.body.longitude !== undefined && req.body.longitude !== "" && !isNaN(Number(req.body.longitude))) ? Number(req.body.longitude) : (-122.4194 + (Math.random() - 0.5) * 0.1);

  if (!Number.isInteger(bedrooms) || bedrooms < 0 || bedrooms > 100 || !Number.isInteger(bathrooms) || bathrooms < 0 || bathrooms > 100) {
    throw new HttpError(400, "Bedroom and bathroom counts must be whole numbers from 0 to 100.");
  }

  let landlordId = req.user.id;
  if (req.user.role === "admin" && req.body.landlordId) {
    const landlord = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'landlord' AND active = 1").get(req.body.landlordId);
    if (!landlord) throw new HttpError(400, "Choose an active landlord account.");
    landlordId = landlord.id;
  }

  const id = newId();
  const createdAt = new Date().toISOString();

  const createPropertyTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO properties (id, landlord_id, name, address, city, state, zip, type, bedrooms, bathrooms, sqft, rent, deposit, amenities, image_url, description, latitude, longitude, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
    `).run(id, landlordId, name, address, city, state, zip, type, bedrooms, bathrooms, sqft, rent, deposit, amenities, imageUrl, description, latitude, longitude, createdAt);

    logActivity(req.user.id, req.user.role, "property_created", `Added property "${name}"`, `${type} with ${bedrooms} bed, ${bathrooms} bath ($${rent}/mo)`, "property", id);
  });

  createPropertyTx();
  broadcastDataChanged();
  res.status(201).json({ id });
}));

app.get("/api/properties/:id", requireAuth, withErrorHandling(async (req, res) => {
  const property = db.prepare(`
    SELECT p.*, u.name AS tenant_name, u.email AS tenant_email, l.name AS landlord_name, l.email AS landlord_email
    FROM properties p
    LEFT JOIN users u ON u.id = p.tenant_id
    LEFT JOIN users l ON l.id = p.landlord_id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!property) throw new HttpError(404, "Property not found.");
  if (req.user.role === "landlord" && property.landlord_id !== req.user.id) throw new HttpError(403, "Access denied.");
  if (req.user.role === "tenant" && property.tenant_id !== req.user.id) throw new HttpError(403, "Access denied.");

  const payments = db.prepare("SELECT * FROM payments WHERE property_id = ? ORDER BY date DESC").all(property.id);
  const requests = db.prepare("SELECT * FROM maintenance_requests WHERE property_id = ? ORDER BY created_at DESC").all(property.id);
  const leases = db.prepare("SELECT * FROM leases WHERE property_id = ? ORDER BY created_at DESC").all(property.id);
  const expenses = db.prepare("SELECT * FROM expenses WHERE property_id = ? ORDER BY date DESC").all(property.id);

  res.json({
    property: {
      ...property,
      amenities: (() => { try { return JSON.parse(property.amenities || "[]"); } catch { return []; } })()
    },
    payments,
    requests,
    leases,
    expenses
  });
}));

// ----------------- TENANT ASSIGNMENT (TRANSACTIONAL) -----------------

app.post("/api/tenants/assign", requireAuth, allowRoles("landlord", "admin"), withErrorHandling(async (req, res) => {
  const email = cleanString(req.body.email, "Tenant email", 254).toLowerCase();
  const propertyId = cleanString(req.body.propertyId, "Property");
  const property = findPropertyForWrite(propertyId, req.user);
  if (property.tenant_id) throw new HttpError(409, "That property already has a tenant.");
  const tenant = db.prepare("SELECT id, name, role, active FROM users WHERE email = ?").get(email);
  if (!tenant || tenant.role !== "tenant" || !tenant.active) {
    throw new HttpError(404, "The tenant must first create an active account with this email address.");
  }
  const currentProperty = db.prepare("SELECT id FROM properties WHERE tenant_id = ?").get(tenant.id);
  if (currentProperty) throw new HttpError(409, "That tenant is already assigned to a property.");
  const leaseEnd = validDate(req.body.leaseEnd, "Lease end date");

  const assignTenantTx = db.transaction(() => {
    db.prepare("UPDATE properties SET tenant_id = ?, lease_end = ?, status = 'occupied' WHERE id = ?").run(tenant.id, leaseEnd, property.id);

    const leaseId = newId();
    const startDate = currentIsoDate();
    db.prepare(`
      INSERT INTO leases (id, property_id, tenant_id, landlord_id, start_date, end_date, rent_amount, deposit_amount, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?)
    `).run(leaseId, property.id, tenant.id, property.landlord_id, startDate, leaseEnd, property.rent, property.deposit || 0, new Date().toISOString());

    logActivity(req.user.id, req.user.role, "tenant_assigned", `Assigned tenant to "${property.name}"`, `${tenant.name} assigned with lease ending ${leaseEnd}`, "property", property.id);
  });

  assignTenantTx();
  broadcastDataChanged();
  res.status(200).json({ ok: true });
}));

// ----------------- DIGITAL LEASE SIGNING (E-SIGNATURE) -----------------

app.post("/api/leases/:id/sign", requireAuth, withErrorHandling(async (req, res) => {
  const lease = db.prepare("SELECT * FROM leases WHERE id = ?").get(req.params.id);
  if (!lease) throw new HttpError(404, "Lease contract not found.");
  if (req.user.role === "tenant" && lease.tenant_id !== req.user.id) throw new HttpError(403, "Access denied.");
  if (req.user.role === "landlord" && lease.landlord_id !== req.user.id) throw new HttpError(403, "Access denied.");

  const signatureData = cleanString(req.body.signatureData, "Signature data", 1000000);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE leases
    SET signature_data = ?, signed_at = ?, signed_by = ?
    WHERE id = ?
  `).run(signatureData, now, req.user.name, lease.id);

  logActivity(req.user.id, req.user.role, "lease_signed", `Digital lease agreement signed`, `Signed by ${req.user.name} on ${now.slice(0, 10)}`, "lease", lease.id);
  broadcastDataChanged();
  res.json({ ok: true, signedAt: now });
}));

// ----------------- EXPENSE MANAGEMENT (NOI / CASH FLOW) -----------------

app.post("/api/expenses", requireAuth, allowRoles("landlord", "admin"), withErrorHandling(async (req, res) => {
  const propertyId = req.body.propertyId ? cleanString(req.body.propertyId, "Property") : null;
  if (propertyId) findPropertyForWrite(propertyId, req.user);

  const amount = positiveNumber(req.body.amount, "Expense amount");
  const date = validDate(req.body.date, "Expense date");
  const category = cleanString(req.body.category, "Category", 50);
  const description = cleanString(req.body.description, "Description", 500);
  if (!["Repairs", "Taxes", "Insurance", "Utilities", "Mortgage", "Management", "Other"].includes(category)) {
    throw new HttpError(400, "Choose a valid expense category.");
  }

  const id = newId();
  db.prepare(`
    INSERT INTO expenses (id, property_id, landlord_id, category, amount, date, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, propertyId, req.user.id, category, amount, date, description, new Date().toISOString());

  logActivity(req.user.id, req.user.role, "expense_recorded", `Logged ${category} expense of $${amount}`, description, "expense", id);
  broadcastDataChanged();
  res.status(201).json({ id });
}));

// ----------------- IN-APP REAL-TIME MESSAGING -----------------

app.post("/api/messages", requireAuth, withErrorHandling(async (req, res) => {
  const recipientId = cleanString(req.body.recipientId, "Recipient");
  const messageText = cleanString(req.body.message, "Message", 2000);
  const propertyId = req.body.propertyId || null;

  const recipient = db.prepare("SELECT id, name FROM users WHERE id = ? AND active = 1").get(recipientId);
  if (!recipient) throw new HttpError(404, "Recipient user not found.");

  const id = newId();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO messages (id, sender_id, recipient_id, property_id, message, created_at, read)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(id, req.user.id, recipient.id, propertyId, messageText, now);

  const payload = {
    id,
    senderId: req.user.id,
    senderName: req.user.name,
    recipientId: recipient.id,
    recipientName: recipient.name,
    message: messageText,
    createdAt: now
  };

  io.to(`user:${recipient.id}`).emit("chat:message", payload);
  io.to(`user:${req.user.id}`).emit("chat:message", payload);
  res.status(201).json(payload);
}));

// ----------------- COMMUNITY ANNOUNCEMENTS -----------------

app.post("/api/announcements", requireAuth, allowRoles("landlord", "admin"), withErrorHandling(async (req, res) => {
  const title = cleanString(req.body.title, "Announcement title", 180);
  const content = cleanString(req.body.content, "Content", 2000);
  const priority = req.body.priority || "Normal";
  const propertyId = req.body.propertyId ? cleanString(req.body.propertyId, "Property") : null;
  if (propertyId) findPropertyForWrite(propertyId, req.user);

  const id = newId();
  db.prepare(`
    INSERT INTO announcements (id, landlord_id, property_id, title, content, priority, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, propertyId, title, content, priority, new Date().toISOString());

  logActivity(req.user.id, req.user.role, "announcement_posted", `Notice: "${title}"`, content.slice(0, 100), "announcement", id);
  broadcastDataChanged();
  res.status(201).json({ id });
}));

// ----------------- CONTACT US / SUPPORT INQUIRIES -----------------

app.post("/api/contact", withErrorHandling(async (req, res) => {
  const name = cleanString(req.body.name, "Name", 100);
  const email = cleanString(req.body.email, "Email", 254).toLowerCase();
  const category = cleanString(req.body.category || "General Inquiry", "Category", 60);
  const subject = cleanString(req.body.subject, "Subject", 200);
  const message = cleanString(req.body.message, "Message", 4000);
  const userId = req.session?.userId || null;

  const id = newId();
  db.prepare(`
    INSERT INTO contact_messages (id, user_id, name, email, category, subject, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, name, email, category, subject, message, new Date().toISOString());

  logActivity(userId || id, "contact", "contact_inquiry", `Inquiry: "${subject}"`, `From ${name} (${email}) - ${category}`, "contact", id);
  res.status(201).json({ ok: true, id, message: "Thank you for reaching out! Our support team will get back to you shortly." });
}));

// ----------------- PAYMENTS & RENT RECORDING -----------------

app.post("/api/payments", requireAuth, allowRoles("landlord", "admin"), withErrorHandling(async (req, res) => {
  const property = findPropertyForWrite(cleanString(req.body.propertyId, "Property"), req.user);
  if (!property.tenant_id) throw new HttpError(400, "Assign a tenant before recording rent.");
  const amount = positiveNumber(req.body.amount, "Amount");
  const date = validDate(req.body.date, "Payment date");
  const method = cleanString(req.body.method, "Payment method", 60);
  const notes = optionalString(req.body.notes, 255);
  const refNo = generateReferenceNo();
  const periodMonth = optionalString(req.body.periodMonth, 50, new Date(date).toLocaleString("en-US", { month: "long", year: "numeric" }));
  const id = newId();

  const recordPaymentTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO payments (id, property_id, tenant_id, amount, date, status, method, reference_no, period_month, notes, created_at)
      VALUES (?, ?, ?, ?, ?, 'Paid', ?, ?, ?, ?, ?)
    `).run(id, property.id, property.tenant_id, amount, date, method, refNo, periodMonth, notes, new Date().toISOString());

    logActivity(req.user.id, req.user.role, "payment_recorded", `Recorded payment of $${amount}`, `Method: ${method} for ${property.name} (Ref: ${refNo})`, "payment", id);
  });

  recordPaymentTx();
  broadcastDataChanged();
  res.status(201).json({ id, referenceNo: refNo });
}));

app.post("/api/payments/pay", requireAuth, allowRoles("tenant"), withErrorHandling(async (req, res) => {
  const property = db.prepare("SELECT * FROM properties WHERE tenant_id = ?").get(req.user.id);
  if (!property) throw new HttpError(400, "Your account is not assigned to a rental property yet.");
  const method = cleanString(req.body.method, "Payment method", 60);
  const date = currentIsoDate();
  const periodMonth = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
  const refNo = generateReferenceNo();
  const pending = db.prepare("SELECT id FROM payments WHERE tenant_id = ? AND status = 'Pending' ORDER BY date DESC LIMIT 1").get(req.user.id);

  let id;
  const payRentTx = db.transaction(() => {
    if (pending) {
      id = pending.id;
      db.prepare("UPDATE payments SET status = 'Paid', method = ?, date = ?, reference_no = COALESCE(reference_no, ?) WHERE id = ?")
        .run(method, date, refNo, id);
    } else {
      id = newId();
      db.prepare(`
        INSERT INTO payments (id, property_id, tenant_id, amount, date, status, method, reference_no, period_month, created_at)
        VALUES (?, ?, ?, ?, ?, 'Paid', ?, ?, ?, ?)
      `).run(id, property.id, req.user.id, property.rent, date, method, refNo, periodMonth, new Date().toISOString());
    }

    logActivity(req.user.id, "tenant", "rent_paid", `Simulated rent payment of $${property.rent}`, `Paid via ${method} for ${property.name} (Ref: ${refNo})`, "payment", id);
  });

  payRentTx();
  broadcastDataChanged();
  res.status(201).json({ id, referenceNo: refNo, simulated: true });
}));

app.patch("/api/payments/:id/paid", requireAuth, allowRoles("landlord", "admin"), withErrorHandling(async (req, res) => {
  const payment = db.prepare("SELECT pay.*, p.landlord_id, p.name AS property_name FROM payments pay JOIN properties p ON p.id = pay.property_id WHERE pay.id = ?").get(req.params.id);
  if (!payment) throw new HttpError(404, "Payment not found.");
  if (req.user.role !== "admin" && payment.landlord_id !== req.user.id) throw new HttpError(403, "You do not manage this payment.");
  if (payment.status !== "Pending") throw new HttpError(409, "Only pending payments can be marked as paid.");

  const refNo = payment.reference_no || generateReferenceNo();
  const markPaidTx = db.transaction(() => {
    db.prepare("UPDATE payments SET status = 'Paid', method = CASE WHEN method = '—' THEN 'Bank transfer' ELSE method END, reference_no = ? WHERE id = ?")
      .run(refNo, payment.id);

    logActivity(req.user.id, req.user.role, "payment_confirmed", `Marked payment for ${payment.property_name} as Paid`, `Amount: $${payment.amount} (Ref: ${refNo})`, "payment", payment.id);
  });

  markPaidTx();
  broadcastDataChanged();
  return res.json({ ok: true, referenceNo: refNo });
}));

// ----------------- MAINTENANCE TICKETS WITH PHOTOS -----------------

app.post("/api/maintenance", requireAuth, allowRoles("tenant"), withErrorHandling(async (req, res) => {
  const property = db.prepare("SELECT id, name FROM properties WHERE tenant_id = ?").get(req.user.id);
  if (!property) throw new HttpError(400, "Your account is not assigned to a rental property yet.");
  const title = cleanString(req.body.title, "Request title", 180);
  const description = cleanString(req.body.description, "Description", 2000);
  const category = cleanString(req.body.category, "Category", 50);
  const priority = req.body.priority;
  const photoUrl = optionalString(req.body.photoUrl, 500);
  if (!["Normal", "High", "Urgent"].includes(priority)) throw new HttpError(400, "Choose a valid priority.");
  const id = newId();

  const createMaintenanceTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO maintenance_requests (id, property_id, tenant_id, title, description, category, priority, status, photo_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?)
    `).run(id, property.id, req.user.id, title, description, category, priority, photoUrl, new Date().toISOString());

    logActivity(req.user.id, "tenant", "maintenance_reported", `New request: "${title}"`, `${priority} priority (${category}) for ${property.name}`, "maintenance", id);
  });

  createMaintenanceTx();
  broadcastDataChanged();
  res.status(201).json({ id });
}));

app.patch("/api/maintenance/:id/status", requireAuth, allowRoles("landlord", "admin"), withErrorHandling(async (req, res) => {
  const request = db.prepare("SELECT r.*, p.landlord_id, p.name AS property_name FROM maintenance_requests r JOIN properties p ON p.id = r.property_id WHERE r.id = ?").get(req.params.id);
  if (!request) throw new HttpError(404, "Maintenance request not found.");
  if (req.user.role !== "admin" && request.landlord_id !== req.user.id) throw new HttpError(403, "You do not manage this request.");
  const nextStatus = request.status === "Open" ? "In progress" : request.status === "In progress" ? "Resolved" : "";
  if (!nextStatus) throw new HttpError(409, "This request is already resolved.");

  const resolutionNotes = optionalString(req.body.resolutionNotes, 500);
  const resolutionPhotoUrl = optionalString(req.body.resolutionPhotoUrl, 500);
  const cost = nonNegativeNumber(req.body.cost, request.cost || 0);
  const resolvedAt = nextStatus === "Resolved" ? new Date().toISOString() : null;

  const updateMaintenanceTx = db.transaction(() => {
    db.prepare(`
      UPDATE maintenance_requests
      SET status = ?, resolved_at = COALESCE(?, resolved_at), resolution_notes = CASE WHEN ? != '' THEN ? ELSE resolution_notes END, resolution_photo_url = CASE WHEN ? != '' THEN ? ELSE resolution_photo_url END, cost = ?
      WHERE id = ?
    `).run(nextStatus, resolvedAt, resolutionNotes, resolutionNotes, resolutionPhotoUrl, resolutionPhotoUrl, cost, request.id);

    logActivity(req.user.id, req.user.role, "maintenance_advanced", `Ticket "${request.title}" progressed to ${nextStatus}`, `Property: ${request.property_name}`, "maintenance", request.id);
  });

  updateMaintenanceTx();
  broadcastDataChanged();
  return res.json({ status: nextStatus });
}));

// ----------------- ADMIN CONTROLS & SQL DATABASE METRICS -----------------

app.patch("/api/admin/users/:id/active", requireAuth, allowRoles("admin"), withErrorHandling(async (req, res) => {
  if (req.params.id === req.user.id) throw new HttpError(400, "You cannot deactivate your own admin account.");
  if (typeof req.body.active !== "boolean") throw new HttpError(400, "Choose whether the account should be active.");

  const target = db.prepare("SELECT name, email, role FROM users WHERE id = ?").get(req.params.id);
  const result = db.prepare("UPDATE users SET active = ? WHERE id = ? AND role != 'admin'").run(req.body.active ? 1 : 0, req.params.id);
  if (!result.changes) throw new HttpError(404, "Non-admin account not found.");

  if (!req.body.active) {
    db.prepare("DELETE FROM sessions WHERE sess LIKE ?").run(`%"userId":"${req.params.id}"%`);
    io.in(`user:${req.params.id}`).disconnectSockets(true);
  }

  logActivity(req.user.id, "admin", "user_status_changed", `${req.body.active ? "Restored" : "Deactivated"} account for ${target?.name || req.params.id}`, `Target email: ${target?.email || ""}`, "user", req.params.id);
  broadcastDataChanged();
  return res.json({ ok: true });
}));

// Database Health & Performance Stats
app.get("/api/admin/db-stats", requireAuth, allowRoles("admin"), (_req, res) => {
  try {
    const tableCounts = {
      users: db.prepare("SELECT COUNT(*) AS c FROM users").get().c,
      properties: db.prepare("SELECT COUNT(*) AS c FROM properties").get().c,
      payments: db.prepare("SELECT COUNT(*) AS c FROM payments").get().c,
      maintenance_requests: db.prepare("SELECT COUNT(*) AS c FROM maintenance_requests").get().c,
      leases: db.prepare("SELECT COUNT(*) AS c FROM leases").get().c,
      expenses: db.prepare("SELECT COUNT(*) AS c FROM expenses").get().c,
      announcements: db.prepare("SELECT COUNT(*) AS c FROM announcements").get().c,
      messages: db.prepare("SELECT COUNT(*) AS c FROM messages").get().c,
      activity_logs: db.prepare("SELECT COUNT(*) AS c FROM activity_logs").get().c,
      sessions: db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c
    };

    const dbPath = path.join(DATA_DIR, "rentease.sqlite");
    const stat = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null;
    const sizeKB = stat ? Math.round(stat.size / 1024) : 0;
    const walPath = path.join(DATA_DIR, "rentease.sqlite-wal");
    const walKB = fs.existsSync(walPath) ? Math.round(fs.statSync(walPath).size / 1024) : 0;

    const indices = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all();

    res.json({
      dbFile: "rentease.sqlite",
      databaseSizeKB: sizeKB,
      walSizeKB: walKB,
      journalMode: db.pragma("journal_mode", { simple: true }),
      foreignKeys: Boolean(db.pragma("foreign_keys", { simple: true })),
      tableCounts,
      indices
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download SQLite Database Backup
app.get("/api/admin/db-backup", requireAuth, allowRoles("admin"), (_req, res) => {
  const dbPath = path.join(DATA_DIR, "rentease.sqlite");
  if (!fs.existsSync(dbPath)) return res.status(404).json({ error: "Database file not found." });
  res.download(dbPath, `rentease-backup-${new Date().toISOString().slice(0, 10)}.sqlite`);
});

// Seed Demo Data endpoint
app.post("/api/demo/seed", requireAuth, allowRoles("landlord", "admin"), withErrorHandling(async (req, res) => {
  const landlordId = req.user.role === "landlord" ? req.user.id : (req.body.landlordId || req.user.id);
  const sampleProperties = [
    {
      name: "The Grand Skyline Penthouse",
      address: "742 Evergreen Terrace, Suite 18A",
      city: "San Francisco",
      state: "CA",
      zip: "94107",
      type: "Apartment",
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1850,
      rent: 4200,
      deposit: 4200,
      latitude: 37.7749,
      longitude: -122.4194,
      imageUrl: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80",
      description: "Modern luxury penthouse with floor-to-ceiling panoramic skyline views, private balcony, and concierge.",
      amenities: ["City View", "Private Balcony", "Gym & Pool", "In-Unit Laundry", "Covered Parking", "Pet Friendly"]
    },
    {
      name: "Oakridge Contemporary Townhome",
      address: "128 Highland Avenue",
      city: "Austin",
      state: "TX",
      zip: "78701",
      type: "Townhouse",
      bedrooms: 2,
      bathrooms: 2,
      sqft: 1420,
      rent: 2650,
      deposit: 2650,
      latitude: 30.2672,
      longitude: -97.7431,
      imageUrl: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=80",
      description: "Sunlit two-story designer townhome featuring quartz kitchen island, high ceilings, and attached 2-car garage.",
      amenities: ["Attached Garage", "Quartz Countertops", "High Ceilings", "Smart Thermostat", "Dog Park"]
    },
    {
      name: "Lakeside Modern Villa",
      address: "405 Waterfront Drive",
      city: "Seattle",
      state: "WA",
      zip: "98103",
      type: "House",
      bedrooms: 4,
      bathrooms: 3,
      sqft: 2600,
      rent: 5400,
      deposit: 5400,
      latitude: 47.6062,
      longitude: -122.3321,
      imageUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80",
      description: "Stunning craftsman lakeside home with private dock, expansive wraparound deck, and outdoor fireplace.",
      amenities: ["Waterfront", "Private Dock", "Fireplace", "Fenced Yard", "Chef's Kitchen", "EV Charger"]
    }
  ];

  const seedTx = db.transaction(() => {
    for (const prop of sampleProperties) {
      const pid = newId();
      db.prepare(`
        INSERT INTO properties (id, landlord_id, name, address, city, state, zip, type, bedrooms, bathrooms, sqft, rent, deposit, amenities, image_url, description, latitude, longitude, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
      `).run(pid, landlordId, prop.name, prop.address, prop.city, prop.state, prop.zip, prop.type, prop.bedrooms, prop.bathrooms, prop.sqft, prop.rent, prop.deposit, JSON.stringify(prop.amenities), prop.imageUrl, prop.description, prop.latitude, prop.longitude, new Date().toISOString());
    }

    // Sample expense
    db.prepare(`
      INSERT INTO expenses (id, property_id, landlord_id, category, amount, date, description, created_at)
      VALUES (?, NULL, ?, 'Insurance', 350, ?, 'Quarterly landlord property casualty policy', ?)
    `).run(newId(), landlordId, currentIsoDate(), new Date().toISOString());

    // Sample announcement
    db.prepare(`
      INSERT INTO announcements (id, landlord_id, property_id, title, content, priority, created_at)
      VALUES (?, ?, NULL, 'Annual Fire Safety & Filter Replacement', 'HVAC filters will be delivered and safety detectors checked on the 15th.', 'Important', ?)
    `).run(newId(), landlordId, new Date().toISOString());

    logActivity(req.user.id, req.user.role, "demo_data_seeded", "Loaded curated demo properties", "Added 3 luxury sample rentals, expenses, and community notices", "system", null);
  });

  seedTx();
  broadcastDataChanged();
  res.status(201).json({ ok: true, count: sampleProperties.length });
}));

// ----------------- STATIC FILES & ERROR HANDLING -----------------

app.get(["/", "/index.html"], (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/styles.css", (_req, res) => res.sendFile(path.join(__dirname, "styles.css")));
app.get("/app.js", (_req, res) => res.sendFile(path.join(__dirname, "app.js")));
app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found." }));

app.use((error, req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "That record already exists." });
  console.error("Request failed:", error);
  return res.status(500).json({ error: "The server could not complete that request." });
});

const cleanupTimer = setInterval(() => {
  db.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now());
}, 60 * 60 * 1000);
cleanupTimer.unref();

server.listen(PORT, () => {
  console.log(`RentEase is running at http://localhost:${PORT}`);
  if (!process.env.SESSION_SECRET) console.warn("Set SESSION_SECRET in .env to keep sessions valid when the server restarts.");
});

function shutdown() {
  clearInterval(cleanupTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
