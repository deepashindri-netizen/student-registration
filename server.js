```javascript
const form = document.querySelector("#form");
const submit = document.querySelector("#submit");
const payment = document.querySelector("#payment");
const result = document.querySelector("#result");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!form.reportValidity()) return;

  submit.disabled = true;
  submit.textContent = "ಪಾವತಿ ಸಿದ್ಧಪಡಿಸಲಾಗುತ್ತಿದೆ…";
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

    if (!window.Razorpay) {
      throw new Error("Razorpay Checkout ಲೋಡ್ ಆಗಿಲ್ಲ.");
    }

    const options = {
      key: data.keyId,
      amount: data.amount,
      currency: data.currency,
      name: data.merchantName,
      description: "Student Registration Fee",
      order_id: data.orderId,
      prefill: {
        name: payload.studentName,
        contact: payload.mobile
      },
      method: {
        upi: true,
        card: false,
        netbanking: false,
        wallet: false
      },
      handler: async function (paymentData) {
        try {
          const verifyResponse = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              registrationId: data.registrationId,
              razorpay_order_id: paymentData.razorpay_order_id,
              razorpay_payment_id: paymentData.razorpay_payment_id,
              razorpay_signature: paymentData.razorpay_signature
            })
          });

          const verified = await verifyResponse.json();
          if (!verifyResponse.ok) {
            throw new Error(verified.error || "ಪಾವತಿ ಪರಿಶೀಲನೆ ವಿಫಲವಾಗಿದೆ.");
          }

          result.textContent =
            "ಪಾವತಿ ಯಶಸ್ವಿಯಾಗಿದೆ. Registration Number: " +
            verified.registrationNumber;
          result.classList.remove("hidden");
          payment.classList.add("hidden");
          form.classList.add("hidden");
        } catch (error) {
          result.textContent = error.message;
          result.classList.remove("hidden");
        } finally {
          submit.disabled = false;
          submit.textContent = "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ";
        }
      },
      modal: {
        ondismiss: function () {
          submit.disabled = false;
          submit.textContent = "ಮತ್ತೆ ಪಾವತಿಸಿ";
        }
      },
      theme: {
        color: "#2457d6"
      }
    };

    const checkout = new Razorpay(options);
    checkout.on("payment.failed", function (response) {
      result.textContent =
        response.error.description || "ಪಾವತಿ ವಿಫಲವಾಗಿದೆ.";
      result.classList.remove("hidden");
      submit.disabled = false;
      submit.textContent = "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ";
    });

    checkout.open();
  } catch (error) {
    result.textContent = error.message;
    result.classList.remove("hidden");
    submit.disabled = false;
    submit.textContent = "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ";
  }
});
```
