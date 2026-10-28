
const form = document.querySelector("#form");
const submit = document.querySelector("#submit");
const result = document.querySelector("#result");

function showMessage(message, isError = false) {
  result.textContent = message;
  result.classList.remove("hidden");
  result.classList.toggle("error", isError);
}

function downloadReceipt(details) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("PDF ವ್ಯವಸ್ಥೆ ಲಭ್ಯವಿಲ್ಲ. ಪುಟವನ್ನು ಮರುತೆರೆದು ಪ್ರಯತ್ನಿಸಿ.");
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();

  const pageWidth = pdf.internal.pageSize.getWidth();

  // Header
  pdf.setFillColor(16, 42, 86);
  pdf.rect(0, 0, pageWidth, 42, "F");

  pdf.setTextColor(255, 214, 107);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(17);
  pdf.text("GENERAL KNOWLEDGE EXAMINATION", pageWidth / 2, 15, {
    align: "center"
  });

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(13);
  pdf.text("STUDENT REGISTRATION RECEIPT", pageWidth / 2, 27, {
    align: "center"
  });

  pdf.setTextColor(30, 45, 65);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);

  pdf.text("Payment Status: SUCCESSFUL", 20, 58);
  pdf.text("Registration Number:", 20, 76);
  pdf.text("Student Name:", 20, 92);
  pdf.text("Examination Mode:", 20, 108);
  pdf.text("Registration Fee:", 20, 124);
  pdf.text("Payment ID:", 20, 140);

  pdf.setFont("helvetica", "bold");
  pdf.text(String(details.registrationNumber), 75, 76);
  pdf.text(String(details.studentName), 75, 92);
  pdf.text(String(details.examinationMode), 75, 108);
  pdf.text("INR 250", 75, 124);

  pdf.setFont("helvetica", "normal");
  const paymentIdLines = pdf.splitTextToSize(
    String(details.paymentId),
    pageWidth - 95
  );
  pdf.text(paymentIdLines, 75, 140);

  pdf.setDrawColor(224, 181, 75);
  pdf.line(20, 165, pageWidth - 20, 165);

  pdf.setFontSize(10);
  pdf.setTextColor(90, 100, 115);
  pdf.text(
    "Please keep this receipt for future reference.",
    pageWidth / 2,
    178,
    { align: "center" }
  );

  pdf.text(
    "Generated after successful payment verification.",
    pageWidth / 2,
    186,
    { align: "center" }
  );

  const safeName = String(details.registrationNumber).replace(
    /[^a-zA-Z0-9_-]/g,
    "_"
  );

  pdf.save(`Registration_Receipt_${safeName}.pdf`);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.reportValidity()) return;

  if (typeof Razorpay === "undefined") {
    showMessage("Payment system unavailable. Please reload the page.", true);
    return;
  }

  submit.disabled = true;
  submit.textContent = "Please wait...";
  result.classList.add("hidden");

  try {
    const formData = new FormData(form);

    const studentName = String(formData.get("studentName") || "");
    const examinationMode = String(formData.get("examinationMode") || "");

    const response = await fetch("/api/register", {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Registration could not be created.");
    }

    const checkout = new Razorpay({
      key: data.keyId,
      amount: data.amount,
      currency: data.currency,
      name: data.merchantName,
      description: "Student Registration Fee",
      order_id: data.orderId,
      theme: { color: "#123f76" },

      handler: async function (paymentResponse) {
        submit.textContent = "Verifying payment...";

        try {
          const verifyResponse = await fetch("/api/payments/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              registrationId: data.registrationId,
              razorpay_order_id: paymentResponse.razorpay_order_id,
              razorpay_payment_id: paymentResponse.razorpay_payment_id,
              razorpay_signature: paymentResponse.razorpay_signature
            })
          });

          const verified = await verifyResponse.json();

          if (!verifyResponse.ok || !verified.success) {
            throw new Error(
              verified.error || "Payment verification failed."
            );
          }

          showMessage(
            "Payment successful! Registration Number: " +
            verified.registrationNumber
          );

          try {
            downloadReceipt({
              registrationNumber: verified.registrationNumber,
              studentName,
              examinationMode,
              paymentId: paymentResponse.razorpay_payment_id
            });
          } catch (pdfError) {
            showMessage(
              "Payment successful. Registration Number: " +
              verified.registrationNumber +
              ". PDF could not be downloaded automatically. " +
              pdfError.message,
              true
            );
          }
        } catch (error) {
          showMessage(
            error.message +
            " If money was deducted, please do not pay again until checking the payment status.",
            true
          );
        } finally {
          submit.disabled = false;
          submit.textContent = "REGISTER & PAY ₹250";
        }
      },

      modal: {
        ondismiss: function () {
          submit.disabled = false;
          submit.textContent = "REGISTER & PAY ₹250";
          showMessage(
            "Payment window closed. Check payment status before trying again.",
            true
          );
        }
      }
    });

    checkout.on("payment.failed", function () {
      submit.disabled = false;
      submit.textContent = "TRY AGAIN";
      showMessage(
        "Payment failed. Please check whether money was deducted.",
        true
      );
    });

    checkout.open();
  } catch (error) {
    showMessage(error.message || "An error occurred.", true);
    submit.disabled = false;
    submit.textContent = "TRY AGAIN";
  }
});
