
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const Razorpay = require("razorpay");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id BIGSERIAL PRIMARY KEY,
      "studentName" TEXT NOT NULL,
      "fatherName" TEXT NOT NULL,
      dob TEXT NOT NULL,
      mobile TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      "razorpayOrderId" TEXT,
      "paymentId" TEXT,
      "registrationNumber" TEXT,
      "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getRazorpay() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay keys are not configured.");
  }

  return {
    client: new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    }),
    keyId,
    keySecret
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/register", async (req, res) => {
  let registrationId;

  try {
    const { studentName, fatherName, dob, mobile } = req.body;

    if (
      !studentName?.trim() ||
      !fatherName?.trim() ||
      !dob ||
      !/^[6-9][0-9]{9}$/.test(String(mobile || "").trim())
    ) {
      return res.status(400).json({
        error: "ದಯವಿಟ್ಟು ಎಲ್ಲಾ ವಿವರಗಳನ್ನು ಸರಿಯಾಗಿ ನಮೂದಿಸಿ."
      });
    }

    const { client, keyId } = getRazorpay();

    const result = await pool.query(
      `INSERT INTO registrations
       ("studentName", "fatherName", dob, mobile, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id`,
      [
        studentName.trim(),
        fatherName.trim(),
        dob,
        String(mobile).trim()
      ]
    );

    registrationId = result.rows[0].id;

    const order = await client.orders.create({
      amount: 25000,
      currency: "INR",
      receipt: `student_${registrationId}`
    });

    await pool.query(
      `UPDATE registrations
       SET "razorpayOrderId" = $1
       WHERE id = $2`,
      [order.id, registrationId]
    );

    return res.json({
      registrationId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
      merchantName: "RABKAVI BANAHATTI GK COMPETITION"
    });
  } catch (error) {
    console.error("Registration error:", error.message || error);

    return res.status(500).json({
      error: "ಪಾವತಿ ಸಿದ್ಧಪಡಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಸಹಾಯ ಪಡೆಯಿರಿ."
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

    const result = await pool.query(
      `SELECT * FROM registrations WHERE id = $1`,
      [registrationId]
    );

    const registration = result.rows[0];

    if (
      !registration ||
      registration.razorpayOrderId !== razorpay_order_id
    ) {
      return res.status(400).json({
        error: "ನೋಂದಣಿ ಅಥವಾ ಪಾವತಿ Order ದಾಖಲೆ ಸಿಗಲಿಲ್ಲ. ಮತ್ತೆ ಪಾವತಿಸಬೇಡಿ; ಸಹಾಯ ಪಡೆಯಿರಿ."
      });
    }

    if (registration.status === "paid") {
      return res.json({
        success: true,
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
        error: "ಪಾವತಿ Captured ಆಗಿರುವುದು ದೃಢಪಟ್ಟಿಲ್ಲ."
      });
    }

    const registrationNumber =
      `STU${new Date().getFullYear()}${String(registration.id).padStart(5, "0")}`;

    await pool.query(
      `UPDATE registrations
       SET status = 'paid',
           "paymentId" = $1,
           "registrationNumber" = $2
       WHERE id = $3`,
      [
        razorpay_payment_id,
        registrationNumber,
        registration.id
      ]
    );

    return res.json({
      success: true,
      registrationNumber
    });
  } catch (error) {
    console.error("Payment verification error:", error.message || error);

    return res.status(500).json({
      error: "ಪಾವತಿ ಪರಿಶೀಲಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪಾವತಿಸಬೇಡಿ; ಸಹಾಯ ಪಡೆಯಿರಿ."
    });
  }
});

app.get("/api/registration/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, "studentName", status, "registrationNumber"
       FROM registrations
       WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "ನೋಂದಣಿ ದಾಖಲೆ ಸಿಗಲಿಲ್ಲ."
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Registration lookup error:", error.message || error);

    return res.status(500).json({
      error: "ನೋಂದಣಿ ವಿವರಗಳನ್ನು ಪಡೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ."
    });
  }
});

initializeDatabase()
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log("Student registration app running on port " + port);
    });
  })
  .catch((error) => {
    console.error("Database initialization error:", error.message || error);
    process.exit(1);
  });
