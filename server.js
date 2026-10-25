require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const path = require("path");
const Database = require("better-sqlite3");
const QRCode = require("qrcode");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));
app.use(express.static(path.join(__dirname, "public")));

const db = new Database(process.env.DB_PATH || "registrations.sqlite");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS registrations ( const columns = db.prepare(
  "PRAGMA table_info(registrations)"
).all().map(column => column.name);

if (!columns.includes("razorpay_order_id")) {
  db.exec("ALTER TABLE registrations ADD COLUMN razorpay_order_id TEXT");
}

if (!columns.includes("razorpay_payment_id")) {
  db.exec("ALTER TABLE registrations ADD COLUMN razorpay_payment_id TEXT");
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_no TEXT UNIQUE,
  student_name TEXT NOT NULL,
  father_name TEXT NOT NULL,
  dob TEXT NOT NULL,
  mobile TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 250,
  upi_txn_ref TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT
);
`);

const insertRegistration = db.prepare(`
INSERT INTO registrations (student_name, father_name, dob, mobile, amount, upi_txn_ref, status)
VALUES (@student_name, @father_name, @dob, @mobile, 250, @upi_txn_ref, 'PENDING')
`);
const findOne = db.prepare("SELECT * FROM registrations WHERE id = ?");
const allRegs = db.prepare("SELECT * FROM registrations ORDER BY id DESC");
const approve = db.prepare(`
UPDATE registrations SET status='PAID', registration_no=?, approved_at=CURRENT_TIMESTAMP
WHERE id=? AND status='PENDING'
`);

function adminAuth(req, res, next) {
  const provided = req.headers["x-admin-password"];
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected === "change-this-to-a-long-random-password") {
    return res.status(503).json({ error: "Admin password ಅನ್ನು .env ನಲ್ಲಿ ಸುರಕ್ಷಿತವಾಗಿ ಹೊಂದಿಸಿ." });
  }
  if (!provided || provided !== expected) return res.status(401).json({ error: "Admin authentication ವಿಫಲವಾಗಿದೆ." });
  next();
}

app.get("/api/config", (req, res) => {
  res.json({ merchantName: process.env.MERCHANT_NAME || "Student Registration", upiConfigured: Boolean(process.env.UPI_ID) });
});

app.post("/api/register", async (req, res) => {
  const { studentName, fatherName, dob, mobile, upiTxnRef = "" } = req.body || {};
  if (![studentName, fatherName, dob, mobile].every(v => typeof v === "string" && v.trim())) {
    return res.status(400).json({ error: "ಎಲ್ಲಾ ಅಗತ್ಯ ವಿವರಗಳನ್ನು ಭರ್ತಿ ಮಾಡಿ." });
  }
  if (!/^[6-9]\d{9}$/.test(mobile.trim())) return res.status(400).json({ error: "ಸರಿಯಾದ 10 ಅಂಕಿಗಳ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ." });
  if (studentName.length > 120 || fatherName.length > 120 || upiTxnRef.length > 100) {
    return res.status(400).json({ error: "ನಮೂದಿಸಿದ ವಿವರಗಳು ತುಂಬಾ ಉದ್ದವಾಗಿವೆ." });
  }
  const upiId = process.env.UPI_ID;
  if (!upiId) return res.status(503).json({ error: "UPI_ID .env ನಲ್ಲಿ configure ಆಗಿಲ್ಲ." });

  const info = insertRegistration.run({
    student_name: studentName.trim(),
    father_name: fatherName.trim(),
    dob,
    mobile: mobile.trim(),
    upi_txn_ref: upiTxnRef.trim()
  });
  const record = findOne.get(info.lastInsertRowid);
  const txnNote = `Student fee ${record.id}`;
  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(process.env.MERCHANT_NAME || "Student Registration")}&am=250.00&cu=INR&tn=${encodeURIComponent(txnNote)}`;
  const qrDataUrl = await QRCode.toDataURL(upiUrl, { width: 260, margin: 1 });
  res.status(201).json({
    id: record.id,
    amount: 250,
    paymentUri: upiUrl,
    qrDataUrl,
    status: "PENDING",
    note: "ಪಾವತಿಸಿದ ನಂತರ UPI Transaction ID ನಮೂದಿಸಿ. Admin ಪಾವತಿ ಪರಿಶೀಲಿಸಿ ದೃಢೀಕರಿಸಿದ ಮೇಲೆ Registration Number ಮತ್ತು SMS ಕಳುಹಿಸಲಾಗುತ್ತದೆ."
  });
});

app.get("/api/admin/registrations", adminAuth, (req, res) => {
  res.json(allRegs.all());
});

app.post("/api/admin/registrations/:id/approve", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const record = findOne.get(id);
  if (!record) return res.status(404).json({ error: "Registration ಕಂಡುಬಂದಿಲ್ಲ." });
  if (record.status !== "PENDING") return res.status(409).json({ error: "ಈ ನೋಂದಣಿ ಈಗಾಗಲೇ ಪರಿಶೀಲಿಸಲಾಗಿದೆ." });
  if (!record.upi_txn_ref) return res.status(400).json({ error: "UPI Transaction ID ಇಲ್ಲ. ಪಾವತಿ ಪರಿಶೀಲಿಸಿ ID ಸೇರಿಸಿ." });

  const regNo = `STU${new Date().getFullYear()}${String(id).padStart(5, "0")}`;
  approve.run(regNo, id);
  const updated = findOne.get(id);
  let smsResult = "SMS provider ಇನ್ನೂ configure ಆಗಿಲ್ಲ.";
  try {
    smsResult = await sendRegistrationSms(updated);
  } catch (e) {
    console.error("SMS failed:", e.message);
    smsResult = "Registration approved; SMS send failed. Check provider setup.";
  }
  res.json({ registration: updated, sms: smsResult });
});

async function sendRegistrationSms(registration) {
  // Plug in your approved SMS provider here. Never place SMS credentials in browser JS.
  // Indian bulk/transactional SMS generally requires provider account, approved sender ID/template and DLT compliance.
  if (!process.env.SMS_PROVIDER || !process.env.SMS_API_KEY) {
    return "SMS configuration ಇಲ್ಲ; SMS ಕಳುಹಿಸಲಾಗಿಲ್ಲ. Provider credentials ಸೇರಿಸಿ.";
  }
  // Intentionally do not guess a provider endpoint or API contract.
  // Implement the chosen provider's documented API in this function.
  return "SMS provider credentials found, but provider-specific API adapter must be configured.";
}

app.get("/api/registration/:id", (req, res) => {
  const record = findOne.get(Number(req.params.id));
  if (!record) return res.status(404).json({ error: "Registration ಕಂಡುಬಂದಿಲ್ಲ." });
  // Public status lookup reveals only limited information.
  res.json({ status: record.status, registrationNumber: record.registration_no || null });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Student registration app running on port ${port}`));
