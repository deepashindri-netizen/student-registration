const pass = document.querySelector("#password");
const list = document.querySelector("#list");
document.querySelector("#load").addEventListener("click", loadRecords);
async function loadRecords() {
  list.textContent = "Loading…";
  try {
    const r = await fetch("/api/admin/registrations", { headers: { "x-admin-password": pass.value } });
    const rows = await r.json();
    if (!r.ok) throw new Error(rows.error || "Admin access failed");
    list.innerHTML = "";
    if (!rows.length) { list.textContent = "ಇನ್ನೂ ನೋಂದಣಿಗಳಿಲ್ಲ."; return; }
    rows.forEach(row => {
      const card = document.createElement("article");
      card.className = "features";
      card.style.display = "block";
      card.style.margin = "14px 0";
      const details = document.createElement("p");
      details.textContent = `#${row.id} · ${row.student_name} · ${row.father_name} · DOB ${row.dob} · ${row.mobile} · ₹${row.amount} · ${row.status} · UPI ref: ${row.upi_txn_ref || "ಇಲ್ಲ"}`;
      card.append(details);
      if (row.status === "PENDING" && row.upi_txn_ref) {
        const button = document.createElement("button");
        button.textContent = "ಪಾವತಿ ಪರಿಶೀಲಿಸಿ & Approve";
        button.addEventListener("click", () => approve(row.id));
        card.append(button);
      }
      if (row.registration_no) {
        const reg = document.createElement("b");
        reg.textContent = `Registration Number: ${row.registration_no}`;
        card.append(reg);
      }
      list.append(card);
    });
  } catch (e) { list.textContent = e.message; }
}
async function approve(id) {
  if (!confirm("UPI ಪಾವತಿಯನ್ನು ನಿಮ್ಮ ಬ್ಯಾಂಕ್/UPI app ನಲ್ಲಿ ಪರಿಶೀಲಿಸಿದ್ದೀರಾ?")) return;
  const r = await fetch(`/api/admin/registrations/${id}/approve`, {
    method: "POST", headers: { "x-admin-password": pass.value }
  });
  const data = await r.json();
  if (!r.ok) { alert(data.error || "Approve failed"); return; }
  alert(`Approved: ${data.registration.registration_no}\nSMS: ${data.sms}`);
  loadRecords();
}