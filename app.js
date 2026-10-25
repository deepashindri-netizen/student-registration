const form = document.querySelector("#form");
const submit = document.querySelector("#submit");
const payment = document.querySelector("#payment");
const result = document.querySelector("#result");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!form.reportValidity()) return;
  submit.disabled = true;
  submit.textContent = "ನೋಂದಣಿ ವಿವರಗಳನ್ನು ಸಲ್ಲಿಸಲಾಗುತ್ತಿದೆ…";
  result.classList.add("hidden");
  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    document.querySelector("#paymentNote").textContent = data.note;
    document.querySelector("#qr").src = data.qrDataUrl;
    document.querySelector("#upiLink").href = data.paymentUri;
    payment.classList.remove("hidden");
    payment.scrollIntoView({ behavior: "smooth", block: "center" });
    submit.textContent = "UPI QR ಸಿದ್ಧವಾಗಿದೆ";
  } catch (err) {
    result.textContent = err.message;
    result.classList.remove("hidden");
    submit.disabled = false;
    submit.textContent = "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ";
  }
});
