
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const path = require("path");
const Database = require("better-sqlite3");
const Razorpay = require("razorpay");
const crypto = require("crypto");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));
app.use(express.static(path.join(__dirname, "public")));

const db = new Database(process.env.DB_PATH || "registrations.sqlite");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_no TEXT UNIQUE,
    student_name TEXT NOT NULL,
    father_name TEXT NOT NULL,
    dob TEXT NOT NULL,
    mobile TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 250,
    status TEXT NOT NULL DEFAULT 'PENDING',
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TEXT
  );
`);

const insertRegistration = db.prepare(`
  INSERT INTO registrations
    (student_name, father_name, dob, mobile, amount, status)
  VALUES
    (@student_name, @father_name, @dob, @mobile, 250, 'PENDING')
`);

const findOne = db.prepare("SELECT * FROM registrations WHERE id = ?");

function getRazorpay() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay keys are not configured");
  }

  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
}

// Create Razorpay order
app.post("/api/register", async (req, res) => {
  try {
    const { studentName, fatherName, dob, mobile } = req.body || {};

    if (![studentName, fatherName, dob, mobile].every(
      value => typeof value === "string" && value.trim()
    )) {
      return res.status(400).json({
        error: "ಎಲ್ಲಾ ಅಗತ್ಯ ವಿವರಗಳನ್ನು ಭರ್ತಿ ಮಾಡಿ."
      });
    }

    if (!/^[6-9]\d{9}$/.test(mobile.trim())) {
      return res.status(400).json({
        error: "ಸರಿಯಾದ 10 ಅಂಕಿಗಳ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ."
      });
    }

    if (studentName.trim().length > 120 || fatherName.trim().length > 120) {
      return res.status(400).json({
        error: "ಹೆಸರು ತುಂಬಾ ಉದ್ದವಾಗಿದೆ."
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return res.status(400).json({
        error: "ಸರಿಯಾದ ಜನ್ಮ ದಿನಾಂಕ ನಮೂದಿಸಿ."
      });
    }

    const rp = getRazorpay();

    const info = insertRegistration.run({
      student_name: studentName.trim(),
      father_name: fatherName.trim(),
      dob,
      mobile: mobile.trim()
    });

    const id = Number(info.lastInsertRowid);

    const order = await rp.orders.create({
      amount: 25000,
      currency: "INR",
      receipt: `stu_${id}`,
      notes: {
        registration_id: String(id)
      }
    });

    db.prepare(
      "UPDATE registrations SET razorpay_order_id = ? WHERE id = ?"
    ).run(order.id, id);

    res.status(201).json({
      registrationId: id,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      merchantName: process.env.MERCHANT_NAME || "Student Registration"
    });

  } catch (error) {
    console.error("Create order error:", error.message);

    res.status(500).json({
      error: "ಪಾವತಿ ಆರಂಭಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. Razorpay keys ಪರಿಶೀಲಿಸಿ."
    });
  }
});

// Verify payment on the server
app.post("/api/payments/verify", async (req, res) => {
  try {
    const {
      registrationId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body || {};

    const id = Number(registrationId);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: "ಅಮಾನ್ಯ ಅರ್ಜಿ ಸಂಖ್ಯೆ."
      });
    }

    const record = findOne.get(id);

    if (!record) {
      return res.status(404).json({
        error: "ಅರ್ಜಿ ಕಂಡುಬಂದಿಲ್ಲ."
      });
    }

    if (record.status === "PAID") {
      return res.json({
        success: true,
        registrationNumber: record.registration_no
      });
    }

    if (
      !record.razorpay_order_id ||
      record.razorpay_order_id !== razorpay_order_id ||
      typeof razorpay_payment_id !== "string" ||
      typeof razorpay_signature !== "string"
    ) {
      return res.status(400).json({
        error: "ಪಾವತಿ ವಿವರಗಳು ಹೊಂದಿಕೆಯಾಗುತ್ತಿಲ್ಲ."
      });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;

    if (!secret) {
      return res.status(503).json({
        error: "Razorpay secret Render ನಲ್ಲಿ ಹೊಂದಿಸಿಲ್ಲ."
      });
    }

    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${record.razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const expectedBuffer = Buffer.from(expected, "hex");
    const signatureBuffer = Buffer.from(razorpay_signature, "hex");

    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      return res.status(400).json({
        error: "ಪಾವತಿ signature ಪರಿಶೀಲನೆ ವಿಫಲವಾಗಿದೆ."
      });
    }

    const payment = await getRazorpay().payments.fetch(
      razorpay_payment_id
    );

    if (
      payment.order_id !== record.razorpay_order_id ||
      payment.amount !== 25000 ||
      payment.currency !== "INR" ||
      payment.status !== "captured"
    ) {
      return res.status(409).json({
        error: "ಪಾವತಿ ಇನ್ನೂ ಪೂರ್ಣವಾಗಿ ದೃಢಪಟ್ಟಿಲ್ಲ."
      });
    }

    const registrationNumber =
      `STU${new Date().getFullYear()}` +
      String(id).padStart(5, "0");

    const result = db.prepare(`
      UPDATE registrations
      SET status = 'PAID',
          registration_no = ?,
          razorpay_payment_id = ?,
          approved_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'PENDING'
    `).run(registrationNumber, razorpay_payment_id, id);

    if (result.changes === 0) {
      const latest = findOne.get(id);

      if (latest && latest.status === "PAID") {
        return res.json({
          success: true,
          registrationNumber: latest.registration_no
        });
      }

      return res.status(409).json({
        error: "ನೋಂದಣಿ ಸ್ಥಿತಿ ಬದಲಾಗಿದೆ. ಮತ್ತೆ ಪರಿಶೀಲಿಸಿ."
      });
    }

    res.json({
      success: true,
      registrationNumber,
      message: "ಪಾವತಿ ದೃಢಪಟ್ಟಿದೆ. ನೋಂದಣಿ ಯಶಸ್ವಿಯಾಗಿದೆ."
    });

  } catch (error) {
    console.error("Payment verification error:", error.message);

    res.status(500).json({
      error: "ಪಾವತಿ ಪರಿಶೀಲಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ಸಹಾಯಕ್ಕಾಗಿ ಸಂಪರ್ಕಿಸಿ."
    });
  }
});

// Check registration status
app.get("/api/registration/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({
      error: "ಅಮಾನ್ಯ ಅರ್ಜಿ ಸಂಖ್ಯೆ."
    });
  }

  const record = findOne.get(id);

  if (!record) {
    return res.status(404).json({
      error: "Registration ಕಂಡುಬಂದಿಲ್ಲ."
    });
  }

  res.json({
    status: record.status,
    registrationNumber: record.registration_no || null
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`Student registration app running on port ${port}`);
});
