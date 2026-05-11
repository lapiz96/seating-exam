const input = document.getElementById("searchRegNo");
const btn = document.getElementById("searchBtn");
const msg = document.getElementById("searchMessage");
const result = document.getElementById("resultCard");

btn.addEventListener("click", async () => {
  msg.textContent = "";
  result.classList.add("hidden");
  const regNo = input.value.trim();
  if (!regNo) {
    msg.textContent = "Please enter registration number.";
    return;
  }

  const res = await fetch(`/api/find-seat?regNo=${encodeURIComponent(regNo)}`);
  const data = await res.json();
  if (!res.ok) {
    msg.textContent = data.message || "Seat not found.";
    return;
  }

  result.innerHTML = `
    <h3>Seat Found</h3>
    <p><b>Reg No:</b> ${data.regNo}</p>
    <p><b>Bench:</b> ${data.benchNo} (Seat ${data.seatNumber})</p>
    <p><b>Hall:</b> ${data.hall}</p>
    <p><b>Exam:</b> ${data.exam}</p>
    <p><b>Date:</b> ${data.examDate}</p>
    <p><b>Session:</b> ${data.session}</p>
    <p><b>Department:</b> ${data.department}</p>
    <p><b>Class:</b> ${data.className}</p>
  `;
  result.classList.remove("hidden");
});
