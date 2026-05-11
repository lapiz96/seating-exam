const state = {
  sessionId: null,
  rows: [],
  pdfUrl: ""
};

const el = {
  loginView: document.getElementById("loginView"),
  appView: document.getElementById("appView"),
  loginForm: document.getElementById("loginForm"),
  loginMessage: document.getElementById("loginMessage"),
  uploadBtn: document.getElementById("uploadBtn"),
  excelFile: document.getElementById("excelFile"),
  uploadMessage: document.getElementById("uploadMessage"),
  uploadStats: document.getElementById("uploadStats"),
  studentTable: document.getElementById("studentTable"),
  studentBody: document.querySelector("#studentTable tbody"),
  previewBtn: document.getElementById("previewBtn"),
  previewMessage: document.getElementById("previewMessage"),
  previewRows: document.getElementById("previewRows"),
  shuffleBtn: document.getElementById("shuffleBtn"),
  pdfBtn: document.getElementById("pdfBtn"),
  pdfMessage: document.getElementById("pdfMessage"),
  pdfLink: document.getElementById("pdfLink"),
  finalMessage: document.getElementById("finalMessage"),
  departmentSelect: document.getElementById("departmentSelect"),
  navBtns: document.querySelectorAll(".nav-btn")
};

function switchStep(step) {
  document.querySelectorAll(".step-card").forEach((card) => card.classList.remove("active-step"));
  document.getElementById(`step-${step}`).classList.add("active-step");
  el.navBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.step === step));
}

function getExamPayload() {
  return {
    examName: document.getElementById("examName").value.trim(),
    examDate: document.getElementById("examDate").value,
    className: document.getElementById("className").value.trim(),
    session: document.getElementById("session").value.trim(),
    subject: document.getElementById("subject").value.trim(),
    department: document.getElementById("departmentSelect").value,
    semester: document.getElementById("semester").value.trim(),
    hallName: document.getElementById("hallName").value.trim(),
    leftBenches: Number(document.getElementById("leftBenches").value || 0),
    rightBenches: Number(document.getElementById("rightBenches").value || 0),
    studentsPerBench: Number(document.getElementById("studentsPerBench").value || 1),
    collegeName: document.getElementById("collegeName").value.trim()
  };
}

function validateExamPayload(payload) {
  if (!state.sessionId) return "Upload an Excel file first.";
  if (!payload.examName || !payload.examDate || !payload.className || !payload.subject || !payload.hallName) {
    return "Fill exam name, date, class, subject and hall name.";
  }
  if (payload.leftBenches < 1 || payload.rightBenches < 1) {
    return "Left and right bench count must be at least 1.";
  }
  if (payload.studentsPerBench < 1 || payload.studentsPerBench > 2) {
    return "Students per bench must be 1 or 2.";
  }
  return "";
}

function renderPreview(rows) {
  el.previewRows.innerHTML = "";
  rows.forEach((r) => {
    const row = document.createElement("div");
    row.className = "seat-row";
    row.appendChild(buildSeatBox(r.left));
    row.appendChild(buildSeatBox(r.right));
    el.previewRows.appendChild(row);
  });
}

function buildSeatBox(bench) {
  const div = document.createElement("div");
  div.className = "seat-box";
  if (!bench) return div;

  const students = bench.students || [];
  div.innerHTML = `
    <div class="seat-title">Bench ${bench.benchNo}</div>
    ${
      students.some(Boolean)
        ? students
            .map((student, idx) =>
              student
                ? `<div><b>Seat ${idx + 1}:</b> ${student.code} | ${student.regNo} | ${student.department}</div>`
                : `<div><b>Seat ${idx + 1}:</b> Empty</div>`
            )
            .join("")
        : `<div class="seat-empty">Empty</div>`
    }
  `;
  return div;
}

el.navBtns.forEach((btn) => btn.addEventListener("click", () => switchStep(btn.dataset.step)));

el.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  el.loginMessage.textContent = "";
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) {
    el.loginMessage.textContent = "Invalid username or password.";
    return;
  }
  el.loginView.classList.add("hidden");
  el.appView.classList.remove("hidden");
});

el.uploadBtn.addEventListener("click", async () => {
  const file = el.excelFile.files[0];
  el.uploadMessage.textContent = "";
  if (!file) {
    el.uploadMessage.textContent = "Choose an Excel file to upload.";
    return;
  }

  const formData = new FormData();
  formData.append("studentFile", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();

  if (!res.ok) {
    el.uploadMessage.textContent = data.message || "Upload failed.";
    return;
  }

  state.sessionId = data.sessionId;
  el.uploadMessage.textContent = "Excel uploaded and parsed successfully.";
  el.uploadStats.classList.remove("hidden");
  el.uploadStats.innerHTML = `
    <div><b>Total Students:</b> ${data.totalStudents}</div>
    <div><b>Departments:</b> ${data.departments.join(", ")}</div>
    <div><b>Session ID:</b> ${data.sessionId}</div>
  `;
  el.departmentSelect.innerHTML = `<option value="ALL">Department (All)</option>`;
  data.departments.forEach((dept) => {
    const option = document.createElement("option");
    option.value = dept;
    option.textContent = `Department (${dept})`;
    el.departmentSelect.appendChild(option);
  });
  el.studentTable.classList.remove("hidden");
  el.studentBody.innerHTML = "";
  data.students.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${s.code}</td><td>${s.regNo}</td><td>${s.department}</td>`;
    el.studentBody.appendChild(tr);
  });
  switchStep("exam");
});

el.previewBtn.addEventListener("click", async () => {
  const examDetails = getExamPayload();
  const err = validateExamPayload(examDetails);
  el.previewMessage.textContent = err;
  if (err) return;

  const res = await fetch("/api/generate-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: state.sessionId, examDetails })
  });
  const data = await res.json();
  if (!res.ok) {
    el.previewMessage.textContent = data.message || "Failed to generate preview.";
    return;
  }
  state.rows = data.rows;
  renderPreview(data.rows);
  switchStep("preview");
});

el.shuffleBtn.addEventListener("click", async () => {
  if (!state.sessionId) return;
  const res = await fetch("/api/shuffle-again", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: state.sessionId })
  });
  const data = await res.json();
  if (!res.ok) {
    el.pdfMessage.textContent = data.message || "Shuffle failed.";
    return;
  }
  state.rows = data.rows;
  renderPreview(data.rows);
});

el.pdfBtn.addEventListener("click", async () => {
  el.pdfMessage.textContent = "Generating PDF. Please wait...";
  const res = await fetch("/api/generate-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: state.sessionId })
  });
  const data = await res.json();
  if (!res.ok) {
    el.pdfMessage.textContent = data.message || "PDF generation failed.";
    return;
  }
  state.pdfUrl = data.url;
  el.pdfMessage.textContent = "PDF generated successfully.";
  el.pdfLink.href = data.url;
  el.pdfLink.classList.remove("hidden");
  el.finalMessage.textContent = `File: ${data.fileName}`;
  switchStep("pdf");
});
