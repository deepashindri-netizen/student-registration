
const form = document.querySelector("#form");
const submit = document.querySelector("#submit");
const result = document.querySelector("#result");

function showMessage(message, isError = false) {
  result.textContent = message;
  result.classList.remove("hidden");
  result.classList.toggle("error", isError);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.reportValidity()) return;

  if (typeof Razorpay === "undefined") {
    showMessage("ಪಾವತಿ ವ್ಯವಸ್ಥೆ ಲಭ್ಯವಿಲ್ಲ. ಪುಟವನ್ನು ಮರುತೆರೆದು ಪ್ರಯತ್ನಿಸಿ.", true);
    return;
  }

  submit.disabled = true;
  submit.textContent = "ದಯವಿಟ್ಟು ಕಾಯಿರಿ...";
  result.classList.add("hidden");

  try {
    const payload = Object.fromEntries(new FormData(form).entries());

    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "ನೋಂದಣಿ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.");
    }

    const checkout = new Razorpay({
      key: data.keyId,
      amount: data.amount,
      currency: data.currency,
      name: data.merchantName,
      description: "ವಿದ್ಯಾರ್ಥಿ ನೋಂದಣಿ ಶುಲ್ಕ",
      order_id: data.orderId,
      theme: { color: "#0b397b" },

      handler: async function (paymentResponse) {
        submit.textContent = "ಪಾವತಿ ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ...";

        try {
          const verifyResponse = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              registrationId: data.registrationId,
              razorpay_order_id: paymentResponse.razorpay_order_id,
              razorpay_payment_id: paymentResponse.razorpay_payment_id,
              razorpay_signature: paymentResponse.razorpay_signature
            })
          });

          const verified = await verifyResponse.json();

          if (!verifyResponse.ok || !verified.success) {
            throw new Error(verified.error || "ಪಾವತಿ ಪರಿಶೀಲನೆ ವಿಫಲವಾಗಿದೆ.");
          }

          form.reset();
          showMessage(
            "ಪಾವತಿ ಯಶಸ್ವಿಯಾಗಿದೆ! ನಿಮ್ಮ ನೋಂದಣಿ ಸಂಖ್ಯೆ: " +
            verified.registrationNumber
          );
        } catch (error) {
          showMessage(
            error.message + " ಹಣ ಕಡಿತವಾಗಿದ್ದರೆ ಮತ್ತೆ ಪಾವತಿಸಬೇಡಿ; ನಿರ್ವಾಹಕರನ್ನು ಸಂಪರ್ಕಿಸಿ.",
            true
          );
        } finally {
          submit.disabled = false;
          submit.textContent = "ನೋಂದಣಿ ಮಾಡಿ ಪಾವತಿಸಿ";
        }
      },

      modal: {
        ondismiss: function () {
          submit.disabled = false;
          submit.textContent = "ನೋಂದಣಿ ಮಾಡಿ ಪಾವತಿಸಿ";
          showMessage("ಪಾವತಿ ಪೂರ್ಣಗೊಂಡಿಲ್ಲ. ಹಣ ಕಡಿತವಾಗಿದೆಯೇ ಎಂದು ಮೊದಲು ಪರಿಶೀಲಿಸಿ.", true);
        }
      }
    });

    checkout.on("payment.failed", function () {
      submit.disabled = false;
      submit.textContent = "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ";
      showMessage("ಪಾವತಿ ವಿಫಲವಾಗಿದೆ. ಹಣ ಕಡಿತವಾಗಿದೆಯೇ ಎಂದು ಪರಿಶೀಲಿಸಿ.", true);
    });

    checkout.open();

  } catch (error) {
    showMessage(error.message || "ದೋಷ ಸಂಭವಿಸಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.", true);
    submit.disabled = false;
    submit.textContent = "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ";
  }
});

