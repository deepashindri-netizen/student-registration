
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { Pool } = require("pg");
const Razorpay = require("razorpay");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Keep uploaded files in memory temporarily, then save them in PostgreSQL.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 2
  },
  fileFilter: (req, file, callback) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return callback(new Error("ಫೋಟೋ ಮತ್ತು ಸಹಿಗೆ JPG, PNG ಅಥವಾ WebP ಫೈಲ್ ಬಳಸಿ."));
    }
    callback(null, true);
  }
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

  // Add columns safely; existing registrations are not deleted.
  await pool.query(`
    ALTER TABLE registrations
      ADD COLUMN IF NOT EXISTS "examinationMode" TEXT NOT NULL DEFAULT 'Online',
      ADD COLUMN IF NOT EXISTS qualification TEXT,
      ADD COLUMN IF NOT EXISTS caste TEXT,
      ADD COLUMN IF NOT EXISTS gender TEXT,
      ADD COLUMN IF NOT EXISTS "aadhaarLast4" TEXT,
      ADD COLUMN IF NOT EXISTS address TEXT,
      ADD COLUMN IF NOT EXISTS pincode TEXT,
      ADD COLUMN IF NOT EXISTS photo BYTEA,
      ADD COLUMN IF NOT EXISTS "photoMime" TEXT,
      ADD COLUMN IF NOT EXISTS signature BYTEA,
      ADD COLUMN IF NOT EXISTS "signatureMime" TEXT
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

// Register student details and save photo/signature in PostgreSQL.
app.post(
  "/api/register",
  upload.fields([
    { name: "photo", maxCount: 1 },
    { name: "signature", maxCount: 1 }
  ]),
  async (req, res) => {
    let registrationId;

    try {
      const {
        studentName,
        fatherName,
        dob,
        mobile,
        examinationMode,
        qualification,
        caste,
        gender,
        aadhaar,
        address,
        pincode
      } = req.body;

      const photo = req.files?.photo?.[0];
      const signature = req.files?.signature?.[0];

      if (
        !studentName?.trim() ||
        !fatherName?.trim() ||
        !dob ||
        !/^[6-9][0-9]{9}$/.test(String(mobile || "").trim()) ||
        !["Online", "Offline"].includes(examinationMode) ||
        !qualification?.trim() ||
        !caste?.trim() ||
        !["Male", "Female", "Other"].includes(gender) ||
        !/^\d{12}$/.test(String(aadhaar || "").trim()) ||
        !address?.trim() ||
        !/^\d{6}$/.test(String(pincode || "").trim()) ||
        !photo ||
        !signature
      ) {
        return res.status(400).json({
          error: "ಎಲ್ಲಾ ವಿವರಗಳನ್ನು ಭರ್ತಿ ಮಾಡಿ. ಸರಿಯಾದ ಫೋಟೋ ಮತ್ತು ಸಹಿಯನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ."
        });
      }

      const { client, keyId } = getRazorpay();

      const result = await pool.query(
        `INSERT INTO registrations (
          "studentName", "fatherName", dob, mobile, status,
          "examinationMode", qualification, caste, gender,
          "aadhaarLast4", address, pincode,
          photo, "photoMime", signature, "signatureMime"
        )
        VALUES (
          $1, $2, $3, $4, 'pending',
          $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15
        )
        RETURNING id`,
        [
          studentName.trim(),
          fatherName.trim(),
          dob,
          String(mobile).trim(),
          examinationMode,
          qualification.trim(),
          caste.trim(),
          gender,
          String(aadhaar).trim().slice(-4),
          address.trim(),
          String(pincode).trim(),
          photo.buffer,
          photo.mimetype,
          signature.buffer,
          signature.mimetype
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
        error: "ನೋಂದಣಿ ಅಥವಾ ಪಾವತಿ ಸಿದ್ಧಪಡಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಸಹಾಯ ಪಡೆಯಿರಿ."
      });
    }
  }
);

// Verify Razorpay payment before marking registration as paid.
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

// Return basic registration status only; do not expose Aadhaar or uploaded files.
app.get("/api/registration/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, "studentName", status, "registrationNumber",
              "examinationMode"
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

// Friendly errors for invalid uploads and files over 2 MB.
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: "ಫೋಟೋ ಅಥವಾ ಸಹಿ 2 MB ಮೀರಬಾರದು. ಚಿಕ್ಕ ಫೈಲ್ ಆಯ್ಕೆಮಾಡಿ."
    });
  }

  if (error) {
    return res.status(400).json({
      error: error.message || "ಅಪ್ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ."
    });
  }

  next();
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
