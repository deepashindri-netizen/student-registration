# Kannada Student Registration Website

## What is included
- Kannada student form: student name, father name, DOB, mobile number
- ₹250 UPI payment intent and generated QR code
- Node.js/Express backend and SQLite registration database
- Admin review panel at `/admin.html`
- Registration number generation after admin verifies payment
- SMS provider integration hook (provider-specific adapter still required)

## Run locally
1. Install Node.js 18+.
2. Copy `.env.example` to `.env` and set your real `UPI_ID`, `MERCHANT_NAME`, and a strong `ADMIN_PASSWORD`.
3. In this folder run:
   ```bash
   npm install
   npm start
   ```
4. Visit `http://localhost:3000` for the form and `http://localhost:3000/admin.html` for admin.

## Important payment/SMS notes
This scaffold uses a UPI intent/QR. It does NOT verify bank payment automatically.
The student provides the UPI reference; the administrator must independently verify the payment in their bank/UPI merchant app before approving. Only then is a registration number generated.
For automated confirmation, use a merchant payment provider with server-side verified webhooks; do not trust browser redirects or user-entered UTR alone.
SMS sending requires a chosen provider and provider-specific API integration. In India, business SMS may require approved sender ID/template and DLT registration. The current adapter deliberately does not claim to send SMS until configured.
Never put API keys, admin password, or payment secrets in client-side JS.
Student DOB and mobile are personal data: configure hosting, access controls, privacy notice, retention and backups appropriately before public use.

## Online hosting
Deploy the Node app to a host that supports Node.js and persistent storage. Set environment variables in the hosting dashboard. SQLite requires a persistent disk; otherwise use a managed database. Configure HTTPS and your real domain. Do not deploy with the example admin password.
