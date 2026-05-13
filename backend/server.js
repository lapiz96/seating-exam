const express = require("express");
const multer = require("multer");
const xlsx = require("xlsx");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

const BACKEND_DIR = __dirname;
const PROJECT_ROOT = path.join(BACKEND_DIR, "..");
const FRONTEND_DIR = path.join(PROJECT_ROOT, "frontend");
const UPLOAD_DIR = path.join(BACKEND_DIR, "uploads");
const GENERATED_DIR = path.join(BACKEND_DIR, "generated");
const DATA_DIR = path.join(BACKEND_DIR, "data");

[UPLOAD_DIR, GENERATED_DIR, DATA_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// CORS: needed if HTML is on GitHub Pages and API is on another host (set ALLOWED_ORIGIN to your Pages URL in production)
app.use((req, res, next) => {
  const allowed = process.env.ALLOWED_ORIGIN || "*";
  res.header("Access-Control-Allow-Origin", allowed);
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
// Same UI at /seat-search.html and /frontend/seat-search.html (GitHub folder layout)
app.use(express.static(FRONTEND_DIR, { index: false }));
app.use("/frontend", express.static(FRONTEND_DIR, { index: false }));
app.use("/generated", express.static(GENERATED_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = `${Date.now()}-${file.originalname}`.replace(/\s+/g, "_");
    cb(null, safe);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".xlsx" && ext !== ".xls") {
      return cb(new Error("Only .xlsx or .xls files are allowed"));
    }
    cb(null, true);
  }
});

const sessions = new Map();
const arrangementsFile = path.join(DATA_DIR, "arrangements.json");

function loadArrangements() {
  if (!fs.existsSync(arrangementsFile)) return [];
  try {
    const content = fs.readFileSync(arrangementsFile, "utf8");
    return JSON.parse(content || "[]");
  } catch {
    return [];
  }
}

function saveArrangements(items) {
  fs.writeFileSync(arrangementsFile, JSON.stringify(items, null, 2), "utf8");
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]/g, "");
}

function getDeptCodePrefix(department) {
  const d = String(department || "").trim().toUpperCase();
  if (d === "CSE") return "CR";
  if (d === "ECE") return "EC";
  if (d === "EEE") return "EE";
  if (d === "ME" || d === "MECH") return "ME";
  if (d === "CE" || d === "CIVIL") return "CE";
  if (d === "IT") return "IT";
  return (d.replace(/[^A-Z]/g, "").slice(0, 2) || "ST");
}

function makeUniqueCode(base, usedCodes) {
  let candidate = base;
  let i = 2;
  while (usedCodes.has(candidate)) {
    candidate = `${base}-${i}`;
    i += 1;
  }
  usedCodes.add(candidate);
  return candidate;
}

function generateCodeFromRegNo(regNo, department, deptCounters, usedCodes) {
  const prefix = getDeptCodePrefix(department);
  const cleanReg = String(regNo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const trailingNumber = (cleanReg.match(/(\d+)$/) || [])[1];

  // Prefer department-wise running sequence style: CR1, EC1, ME1...
  deptCounters[prefix] = (deptCounters[prefix] || 0) + 1;
  const sequenceBase = `${prefix}${deptCounters[prefix]}`;
  if (!usedCodes.has(sequenceBase)) {
    usedCodes.add(sequenceBase);
    return sequenceBase;
  }

  // Fallback to reg-based suffix if a collision still happens.
  const regSuffix = trailingNumber ? String(Number(trailingNumber)) : String(deptCounters[prefix]);
  return makeUniqueCode(`${prefix}${regSuffix}`, usedCodes);
}

function parseStudentsFromExcel(filePath) {
  const workbook = xlsx.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

  if (!rows.length) {
    throw new Error("Excel file has no rows.");
  }

  const headerMap = {};
  Object.keys(rows[0]).forEach((k) => {
    headerMap[normalizeKey(k)] = k;
  });

  const regHeader =
    headerMap.registrationnumber ||
    headerMap.regno ||
    headerMap.registernumber ||
    headerMap.registrationno ||
    headerMap.regnumber ||
    headerMap.rollno;
  const codeHeader =
    headerMap.code ||
    headerMap.studentcode ||
    headerMap.studentid ||
    headerMap.id;
  const deptHeader = headerMap.department || headerMap.dept || headerMap.branch;

  if (!regHeader || !deptHeader) {
    throw new Error(
      "Required columns are missing. Required headers: Registration Number, Department."
    );
  }

  const usedCodes = new Set();
  const deptCounters = {};
  const students = rows
    .map((row) => ({
      code: codeHeader ? String(row[codeHeader] || "").trim().toUpperCase() : "",
      regNo: String(row[regHeader] || "").trim(),
      department: String(row[deptHeader] || "").trim().toUpperCase(),
      name: String(row.Name || row.name || "").trim(),
      semester: String(row.Semester || row.semester || "").trim(),
      subject: String(row.Subject || row.subject || "").trim(),
      className: String(row.Class || row.class || row.Section || row.section || "").trim()
    }))
    .filter((s) => s.regNo && s.department)
    .map((s) => ({
      ...s,
      code: s.code
        ? makeUniqueCode(s.code, usedCodes)
        : generateCodeFromRegNo(s.regNo, s.department, deptCounters, usedCodes)
    }));

  if (!students.length) {
    throw new Error("No valid student rows found.");
  }
  return students;
}

function shuffleArray(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function arrangeStudents(students, capacity) {
  const groups = students.reduce((acc, s) => {
    if (!acc[s.department]) acc[s.department] = [];
    acc[s.department].push(s);
    return acc;
  }, {});

  Object.keys(groups).forEach((dept) => {
    groups[dept] = shuffleArray(groups[dept]);
  });

  const result = [];
  let previousDept = null;

  while (result.length < capacity) {
    const options = Object.entries(groups)
      .filter(([, list]) => list.length > 0)
      .sort((a, b) => b[1].length - a[1].length);

    if (!options.length) break;

    let selected = options.find(([dept]) => dept !== previousDept);
    if (!selected) selected = options[0];

    const [dept, list] = selected;
    result.push(list.shift());
    previousDept = dept;
  }

  while (result.length < capacity) {
    result.push(null);
  }
  return result;
}

function toBenchLayout(ordered, leftCount, rightCount, studentsPerBench) {
  const rows = Math.max(leftCount, rightCount);
  const output = [];
  for (let i = 0; i < rows; i += 1) {
    output.push({
      left: i < leftCount ? { benchNo: `L${i + 1}`, students: [] } : null,
      right: i < rightCount ? { benchNo: `R${i + 1}`, students: [] } : null
    });
  }

  let idx = 0;
  for (let i = 0; i < rows; i += 1) {
    if (output[i].left) {
      for (let slot = 0; slot < studentsPerBench; slot += 1) {
        output[i].left.students.push(ordered[idx++] || null);
      }
    }
    if (output[i].right) {
      for (let slot = 0; slot < studentsPerBench; slot += 1) {
        output[i].right.students.push(ordered[idx++] || null);
      }
    }
  }
  return output;
}

function renderPdfHtml(payload) {
  const { examDetails, rows } = payload;
  const rowsHtml = rows
    .map((row) => {
      const left = row.left
        ? `<div class="bench-box">
            <div class="bench-title">Bench ${row.left.benchNo}</div>
            ${
              row.left.students.some(Boolean)
                ? row.left.students
                    .map((st, idx) =>
                      st
                        ? `<div class="slot"><span class="label">Seat ${idx + 1}:</span>
                            ${st.regNo} | ${st.department} | ${st.className || "-"}
                           </div>`
                        : `<div class="slot empty">Seat ${idx + 1}: Empty</div>`
                    )
                    .join("")
                : `<div class="empty">Empty</div>`
            }
          </div>`
        : `<div class="bench-box disabled"></div>`;

      const right = row.right
        ? `<div class="bench-box">
            <div class="bench-title">Bench ${row.right.benchNo}</div>
            ${
              row.right.students.some(Boolean)
                ? row.right.students
                    .map((st, idx) =>
                      st
                        ? `<div class="slot"><span class="label">Seat ${idx + 1}:</span>
                            ${st.regNo} | ${st.department} | ${st.className || "-"}
                           </div>`
                        : `<div class="slot empty">Seat ${idx + 1}: Empty</div>`
                    )
                    .join("")
                : `<div class="empty">Empty</div>`
            }
          </div>`
        : `<div class="bench-box disabled"></div>`;

      return `<div class="seat-row">${left}${right}</div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Seating Arrangement</title>
  <style>
    body{font-family: Arial, sans-serif; margin: 24px; color: #111;}
    .head{text-align:center; border:2px solid #111; padding:10px; margin-bottom:10px;}
    .head h1{margin:0; font-size:20px;}
    .head h2{margin:6px 0 0; font-size:16px;}
    .meta{border:1px solid #111; padding:8px; font-size:13px;}
    .meta-row{display:flex; justify-content:space-between; margin:3px 0;}
    .title{text-align:center; margin:14px 0 10px; font-weight:700; font-size:18px;}
    .side-head{display:flex; justify-content:space-between; font-weight:700; margin:8px 0;}
    .seat-row{display:flex; gap:18px; margin:10px 0;}
    .bench-box{flex:1; border:1.5px solid #111; padding:8px; min-height:88px; font-size:12px;}
    .bench-title{font-weight:700; margin-bottom:6px;}
    .slot{margin:3px 0;}
    .label{font-weight:700;}
    .empty{font-style:italic; color:#666;}
    .disabled{border-color:transparent;}
    .footer{margin-top:16px; border-top:1px solid #111; padding-top:10px; font-size:12px;}
  </style>
</head>
<body>
  <div class="head">
    <h1>${examDetails.collegeName || "COLLEGE OF ENGINEERING"}</h1>
    <h2>EXAM SEATING ARRANGEMENT</h2>
  </div>
  <div class="meta">
    <div class="meta-row"><span><b>Exam:</b> ${examDetails.examName}</span><span><b>Date:</b> ${examDetails.examDate}</span></div>
    <div class="meta-row"><span><b>Session:</b> ${examDetails.session}</span><span><b>Hall:</b> ${examDetails.hallName}</span></div>
    <div class="meta-row"><span><b>Subject:</b> ${examDetails.subject || "-"}</span><span><b>Class:</b> ${examDetails.className || "-"}</span></div>
    <div class="meta-row"><span><b>Department:</b> ${examDetails.department || "ALL"}</span><span><b>Semester:</b> ${examDetails.semester || "-"}</span></div>
  </div>
  <div class="title">SEATING ARRANGEMENT</div>
  <div class="side-head"><span>LEFT SIDE</span><span>RIGHT SIDE</span></div>
  ${rowsHtml}
  <div class="footer">
    Generated by Smart Exam Seating Arrangement System<br/>
    Prepared By: Exam Cell &nbsp;&nbsp;&nbsp; Signature: __________________
  </div>
</body>
</html>`;
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === "admin" && password === "admin123") {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, message: "Invalid credentials." });
});

app.post("/api/upload", upload.single("studentFile"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Excel file is required." });
    }
    const students = parseStudentsFromExcel(req.file.path);
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessions.set(sessionId, { students, sourceFile: req.file.filename });

    const departments = [...new Set(students.map((s) => s.department))];
    const classes = [...new Set(students.map((s) => s.className).filter(Boolean))];
    return res.json({
      sessionId,
      totalStudents: students.length,
      departments,
      classes,
      students: students.slice(0, 200)
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

app.post("/api/generate-preview", (req, res) => {
  try {
    const { sessionId, examDetails } = req.body;
    const data = sessions.get(sessionId);
    if (!data) return res.status(404).json({ message: "Session expired or invalid." });

    const left = Number(examDetails.leftBenches);
    const right = Number(examDetails.rightBenches);
    const perBench = Number(examDetails.studentsPerBench || 1);
    const capacity = (left + right) * perBench;
    const selectedDept = String(examDetails.department || "ALL").toUpperCase();
    const selectedClass = String(examDetails.className || "ALL").trim().toUpperCase();
    let eligibleStudents =
      selectedDept === "ALL"
        ? data.students
        : data.students.filter((s) => s.department === selectedDept);
    if (selectedClass !== "ALL") {
      eligibleStudents = eligibleStudents.filter(
        (s) => String(s.className || "").trim().toUpperCase() === selectedClass
      );
    }

    if (!eligibleStudents.length) {
      return res.status(400).json({
        message: `No students found for selected department: ${selectedDept}.`
      });
    }

    if (eligibleStudents.length > capacity) {
      return res.status(400).json({
        message: `Hall capacity is ${capacity}, but ${eligibleStudents.length} students match current selection.`
      });
    }

    const arranged = arrangeStudents(eligibleStudents, capacity);
    const rows = toBenchLayout(arranged, left, right, perBench);
    const arrangementId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessions.set(sessionId, { ...data, examDetails, rows, eligibleStudents, arrangementId });

    const arrangements = loadArrangements();
    const withoutCurrent = arrangements.filter((a) => a.arrangementId !== arrangementId);
    withoutCurrent.push({
      arrangementId,
      sessionId,
      createdAt: new Date().toISOString(),
      examDetails,
      rows
    });
    saveArrangements(withoutCurrent);

    return res.json({ rows, capacity, studentCount: eligibleStudents.length });
  } catch (error) {
    return res.status(500).json({ message: "Failed to generate preview." });
  }
});

app.post("/api/shuffle-again", (req, res) => {
  const { sessionId } = req.body;
  const data = sessions.get(sessionId);
  if (!data || !data.examDetails) {
    return res.status(404).json({ message: "Preview not available." });
  }

  const left = Number(data.examDetails.leftBenches);
  const right = Number(data.examDetails.rightBenches);
  const perBench = Number(data.examDetails.studentsPerBench || 1);
  const capacity = (left + right) * perBench;
  const sourceStudents = data.eligibleStudents || data.students;
  const arranged = arrangeStudents(sourceStudents, capacity);
  const rows = toBenchLayout(arranged, left, right, perBench);
  sessions.set(sessionId, { ...data, rows });
  if (data.arrangementId) {
    const arrangements = loadArrangements();
    const updated = arrangements.map((a) =>
      a.arrangementId === data.arrangementId ? { ...a, rows, examDetails: data.examDetails } : a
    );
    saveArrangements(updated);
  }
  return res.json({ rows });
});

app.post("/api/generate-pdf", async (req, res) => {
  const { sessionId } = req.body;
  const data = sessions.get(sessionId);
  if (!data || !data.rows || !data.examDetails) {
    return res.status(404).json({ message: "No seating preview available for PDF." });
  }

  try {
    const html = renderPdfHtml({ examDetails: data.examDetails, rows: data.rows });
    const fileName = `seating-${Date.now()}.pdf`;
    const outputPath = path.join(GENERATED_DIR, fileName);

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", right: "10mm", bottom: "15mm", left: "10mm" }
    });
    await browser.close();

    const base = process.env.PUBLIC_BASE_URL || "";
    const pdfPath = `/generated/${fileName}`;
    return res.json({ ok: true, fileName, url: pdfPath, fullUrl: base ? `${base.replace(/\/$/, "")}${pdfPath}` : "" });
  } catch (error) {
    return res.status(500).json({ message: `Failed to generate PDF: ${error.message}` });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/admin/clear-arrangements", (req, res) => {
  const { password } = req.body || {};
  if (password !== "admin123") {
    return res.status(401).json({ message: "Invalid password." });
  }
  saveArrangements([]);
  return res.json({ ok: true, message: "Saved seating data cleared. arrangements.json is now empty." });
});

app.get("/api/find-seat", (req, res) => {
  const regNo = String(req.query.regNo || "").trim().toUpperCase();
  if (!regNo) {
    return res.status(400).json({ message: "Registration number is required." });
  }

  const arrangements = loadArrangements().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  for (const arrangement of arrangements) {
    for (const row of arrangement.rows || []) {
      const sides = [
        { key: "left", bench: row.left },
        { key: "right", bench: row.right }
      ];
      for (const side of sides) {
        if (!side.bench) continue;
        const idx = (side.bench.students || []).findIndex(
          (st) => st && String(st.regNo || "").trim().toUpperCase() === regNo
        );
        if (idx >= 0) {
          const st = side.bench.students[idx];
          return res.json({
            found: true,
            benchNo: side.bench.benchNo,
            side: side.key,
            seatNumber: idx + 1,
            regNo: st.regNo,
            department: st.department,
            className: st.className || arrangement.examDetails?.className || "-",
            exam: arrangement.examDetails?.examName || "-",
            examDate: arrangement.examDetails?.examDate || "-",
            session: arrangement.examDetails?.session || "-",
            hall: arrangement.examDetails?.hallName || "-"
          });
        }
      }
    }
  }
  return res.status(404).json({ found: false, message: "Seat not found for this registration number." });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "seat-search.html"));
});

app.get("/index.html", (req, res) => {
  res.redirect("/");
});

app.get("/dashboard", (req, res) => {
  res.redirect("/admin");
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "admin.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
