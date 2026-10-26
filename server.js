
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const Razorpay = require("razorpay");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const db = new Database("students.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentName TEXT NOT NULL,
    fatherName TEXT NOT NULL,
    dob TEXT NOT NULL,
    mobile TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    razorpayOrderId TEXT,
    paymentId TEXT,
    registrationNumber TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

function getRazorpay() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay keys are not configured.");
  }

  return {
    client: new Razorpay({ key_id: keyId, key_secret: keySecret }),
    keyId,
    keySecret
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/register", async (req, res) => {
  try {
    const { studentName, fatherName, dob, mobile } = req.body;

    if (
      !studentName?.trim() ||
      !fatherName?.trim() ||
      !dob ||
      !/^[0-9]{10}$/.test(String(mobile || "").trim())
    ) {
      return res.status(400).json({
        error: "ದಯವಿಟ್ಟು ಎಲ್ಲಾ ವಿವರಗಳನ್ನು ಸರಿಯಾಗಿ ನಮೂದಿಸಿ."
      });
    }

    const { client, keyId } = getRazorpay();

    const insert = db.prepare(`
      INSERT INTO registrations
      (studentName, fatherName, dob, mobile, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);

    const record = insert.run(
      studentName.trim(),
      fatherName.trim(),
      dob,
      String(mobile).trim()
    );

    const registrationId = record.lastInsertRowid;

    try {
      const order = await client.orders.create({
        amount: 25000,
        currency: "INR",
        receipt: `student_${registrationId}`
      });

      db.prepare(`
        UPDATE registrations
        SET razorpayOrderId = ?
        WHERE id = ?
      `).run(order.id, registrationId);

      return res.json({
        registrationId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId,
        merchantName: "Student Registration"
      });
    } catch (error) {
      db.prepare("DELETE FROM registrations WHERE id = ?")
        .run(registrationId);
      throw error;
    }
  } catch (error) {
    console.error("Registration error:", error.message);
    return res.status(500).json({
      error: "ಪಾವತಿ ಸಿದ್ಧಪಡಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. Razorpay keys ಮತ್ತು settings ಪರಿಶೀಲಿಸಿ."
    });
  }
});

app.post("/api/payments/verify", async (req, res) => {
  try {
    const {
      registrationId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    if (
      !registrationId ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        error: "ಪಾವತಿ ಪರಿಶೀಲನೆಗೆ ಬೇಕಾದ ವಿವರಗಳು ಲಭ್ಯವಿಲ್ಲ."
      });
    }

    const { client, keySecret } = getRazorpay();

    const registration = db.prepare(`
      SELECT * FROM registrations WHERE id = ?
    `).get(registrationId);

    if (
      !registration ||
      registration.razorpayOrderId !== razorpay_order_id
    ) {
      return res.status(400).json({
        error: "Registration ಅಥವಾ order ಸರಿಯಾಗಿಲ್ಲ."
      });
    }

    if (registration.status === "paid") {
      return res.json({
        registrationNumber: registration.registrationNumber
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const supplied = Buffer.from(razorpay_signature, "hex");
    const expected = Buffer.from(expectedSignature, "hex");

    if (
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)
    ) {
      return res.status(400).json({
        error: "ಪಾವತಿ ಸಹಿ ಪರಿಶೀಲನೆ ವಿಫಲವಾಗಿದೆ."
      });
    }

    const payment = await client.payments.fetch(razorpay_payment_id);

    if (
      payment.order_id !== razorpay_order_id ||
      payment.amount !== 25000 ||
      payment.currency !== "INR" ||
      payment.status !== "captured"
    ) {
      return res.status(400).json({
        error: "ಪಾವತಿ ಇನ್ನೂ ಯಶಸ್ವಿಯಾಗಿ ದೃಢಪಟ್ಟಿಲ್ಲ."
      });
    }

    const registrationNumber =
      `STU${new Date().getFullYear()}${String(registration.id).padStart(5, "0")}`;

    db.prepare(`
      UPDATE registrations
      SET status = 'paid',
          paymentId = ?,
          registrationNumber = ?
      WHERE id = ?
    `).run(
      razorpay_payment_id,
      registrationNumber,
      registration.id
    );

    return res.json({ registrationNumber });
  } catch (error) {
    console.error("Payment verification error:", error.message);
    return res.status(500).json({
      error: "ಪಾವತಿ ಪರಿಶೀಲಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."
    });
  }
});

app.get("/api/registration/:id", (req, res) => {
  const registration = db.prepare(`
    SELECT id, studentName, status, registrationNumber
    FROM registrations
    WHERE id = ?
  `).get(req.params.id);

  if (!registration) {
    return res.status(404).json({
      error: "ನೋಂದಣಿ ದಾಖಲೆ ಸಿಗಲಿಲ್ಲ."
    });
  }

  return res.json(registration);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Student registration app running on port ${port}`);
});
