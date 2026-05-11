# Smart Exam Seating Arrangement System — Project Report

This document explains the **folder layout**, **workflow**, **tech stack**, **how data moves through the app**, **pain points**, and **where the important code lives**. Wording is kept simple for college reports or handover notes.

---

## 1. Folder structure

Project root (where you run `npm run dev`):

```text
seating/
├── package.json              # Dependencies and npm scripts
├── package-lock.json
├── node_modules/             # Installed libraries (do not edit by hand)
├── PROJECT_REPORT.md         # This file
├── backend/                  # Server (Node.js)
│   ├── server.js             # Main API, Excel parsing, seating logic, PDF
│   ├── data/
│   │   ├── arrangements.json   # Saved seating layouts (created at runtime)
│   │   └── students-template.csv # Example Excel column names
│   ├── uploads/              # Uploaded Excel files
│   └── generated/          # Generated PDF files (served under /generated/...)
└── frontend/                 # Static pages (HTML, CSS, JS)
    ├── seat-search.html      # Public home: find seat by register number
    ├── seat-search.js
    ├── admin.html            # Admin: upload, create exam, preview, PDF
    ├── admin.js
    ├── style.css
    ├── index.html            # Legacy (optional)
    └── script.js             # Legacy (optional)
```

**Rule of thumb:** anything the browser loads directly lives under `frontend/`. Anything that reads files, talks to Excel, or builds PDFs lives under `backend/`.

---

## 2. Tech stack

| Layer | Technology | Role |
|--------|------------|------|
| Backend | **Node.js** + **Express** | HTTP server, REST-style JSON APIs, file upload |
| Excel | **xlsx** | Reads `.xlsx` / `.xls`, turns rows into JavaScript objects |
| Upload | **multer** | Saves uploaded file to `backend/uploads/` |
| PDF | **puppeteer** | Opens HTML in a headless browser and prints to PDF |
| Frontend | **HTML + CSS + JavaScript** (no React build step) | Admin UI and public seat search |
| Storage (simple) | **In-memory `Map`** + **JSON file** | Session data in RAM; last arrangements on disk |

---

## 3. User-facing workflow

### A. Public student (no admin login)

1. Open `http://localhost:3000/` → loads `seat-search.html`.
2. Student types **registration number** and searches.
3. Browser calls `GET /api/find-seat?regNo=...`.
4. Server searches saved arrangements in `backend/data/arrangements.json` and returns bench, hall, exam info if found.

### B. Admin (exam cell)

1. Open `http://localhost:3000/admin` → `admin.html`.
2. Login via `POST /api/login` (demo credentials in code; not safe for real production).
3. **Upload Excel** → `POST /api/upload` → file stored, rows parsed, `sessionId` returned.
4. **Create exam** (exam name, date, session, hall, benches, optional subject/semester, department/class filters).
5. **Generate preview** → `POST /api/generate-preview` → seating grid JSON returned; also appended to `arrangements.json` so students can search later.
6. **Shuffle again** (optional) → `POST /api/shuffle-again`.
7. **Generate PDF** → `POST /api/generate-pdf` → Puppeteer writes file under `backend/generated/`, link like `/generated/seating-....pdf`.

---

## 4. How data converts and flows (step by step)

### Step 1: Excel → student list

- Multer saves the file to `backend/uploads/`.
- `xlsx.readFile` reads the workbook; first sheet is used.
- First row is treated as **headers**. Headers are normalized (spaces and case removed) so similar names still match.
- Each row becomes an object: at minimum **registration number** and **department**; optional **class**, **name**, etc.
- If Excel has a **Code** column, it can be used; otherwise an internal-style code is generated for ordering (display in UI/PDF focuses on reg no / dept / class).

**Important code:** `parseStudentsFromExcel` in `backend/server.js` (starts around line 109).

### Step 2: Filter who sits this exam

- Admin picks **department** (or “All”) and **class** (or “All”) in the form.
- Server keeps only matching students before seating.

**Important code:** `POST /api/generate-preview` — filter block around lines 373–383 in `backend/server.js`.

### Step 3: Shuffle / spread departments

- Students are grouped by department, shuffled inside each group.
- Seats are filled one-by-one trying **not** to pick the same department twice in a row (reduces neighbors from same dept).

**Important code:** `arrangeStudents` (around lines 179–212) and `shuffleArray` in `backend/server.js`.

### Step 4: Ordered list → left/right benches

- Hall has **left bench count** and **right bench count**, and optionally **students per bench** (1 or 2).
- The flat ordered list is placed row-by-row: for each row, left bench(es) then right bench(es).

**Important code:** `toBenchLayout` (around lines 214–237) in `backend/server.js`.

### Step 5: Layout → PDF

- Same layout is turned into one big HTML string (`renderPdfHtml`).
- Puppeteer loads that HTML and calls `page.pdf(...)` to write a file under `backend/generated/`.

**Important code:** `renderPdfHtml` and `POST /api/generate-pdf` in `backend/server.js`.

### Step 6: Save for public search

- When preview is generated, a record `{ arrangementId, examDetails, rows, ... }` is pushed into `arrangements.json`.
- `GET /api/find-seat` scans newest-first until the registration number appears in any bench.

**Important code:** `loadArrangements` / `saveArrangements` (lines 48–60), save block inside `generate-preview` (lines 402–411), and `GET /api/find-seat` (from line 477) in `backend/server.js`.

---

## 5. Main API routes (quick reference)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/login` | Admin login check |
| POST | `/api/upload` | Upload Excel, returns `sessionId` + preview rows sample |
| POST | `/api/generate-preview` | Apply filters + seating + save to `arrangements.json` |
| POST | `/api/shuffle-again` | Re-run seating with same filters |
| POST | `/api/generate-pdf` | Create PDF in `generated/` |
| GET | `/api/find-seat?regNo=` | Public seat lookup |
| GET | `/api/health` | Simple alive check |
| GET | `/` | Student search page |
| GET | `/admin` | Admin page |

---

## 6. Important frontend files

| File | Role |
|------|------|
| `frontend/admin.js` | Calls upload, preview, shuffle, PDF APIs; builds department/class dropdowns from upload response |
| `frontend/seat-search.js` | Calls `/api/find-seat` and shows result card |
| `frontend/admin.html` / `seat-search.html` | Page structure and links to CSS/JS |

---

## 7. Pain points and limitations (honest list)

1. **Server restart clears in-memory sessions**  
   The `sessionId` from upload lives in a `Map` in RAM. If Node restarts before PDF/preview steps, the admin may need to upload again. Saved `arrangements.json` still allows **seat search** for already-generated layouts.

2. **`arrangements.json` is not a real database**  
   Concurrent writes, very large files, or corruption risk are possible if many admins hit the server at once. Fine for demos; production would use PostgreSQL/MongoDB.

3. **Admin security is demo-level**  
   Login is a fixed username/password in server code. Fine for college project; **not** acceptable for real student data without hashing, HTTPS, sessions, and role control.

4. **Puppeteer / Chromium**  
   First install can download a large browser binary. PDF generation can fail on locked-down PCs or missing dependencies. Firewall/offline installs need extra setup.

5. **Port conflicts**  
   Default port is `3000`. If another app uses it, you get `EADDRINUSE` — either stop the other app or set another port (e.g. `set PORT=3001` on Windows before `npm run dev`).

6. **Excel discipline**  
   Headers must be readable (first row, no merged title rows above). Wrong column names → “required columns missing” style errors. Class values in Excel must match the dropdown value if filtering by class (same spelling/case after normalization).

7. **Seat search picks latest matching arrangement**  
   Logic scans saved arrangements in reverse time order. If the same student appears in multiple saved exams, the **newest** match wins — may confuse if old files are not cleaned.

8. **multer 1.x**  
   npm may warn about deprecated multer 1.x; upgrading to 2.x is a future maintenance task.

9. **Legacy files**  
   `frontend/index.html` and `frontend/script.js` may be leftovers from an older single-page flow; the live flow uses `admin.html` + `admin.js` and `seat-search.html` + `seat-search.js`.

---

## 8. How to run (reminder)

From the project root:

```bash
npm install
npm run dev
```

- Student: `http://localhost:3000/`
- Admin: `http://localhost:3000/admin`

---

## 9. Code excerpts for reports (reference)

Paths below are relative to project root `seating/`.

### Server paths and static hosting

```11:25:backend/server.js
const BACKEND_DIR = __dirname;
const PROJECT_ROOT = path.join(BACKEND_DIR, "..");
const FRONTEND_DIR = path.join(PROJECT_ROOT, "frontend");
const UPLOAD_DIR = path.join(BACKEND_DIR, "uploads");
const GENERATED_DIR = path.join(BACKEND_DIR, "generated");
const DATA_DIR = path.join(BACKEND_DIR, "data");
// ...
app.use(express.static(FRONTEND_DIR, { index: false }));
app.use("/generated", express.static(GENERATED_DIR));
```

### Seating algorithm (department spread)

```179:212:backend/server.js
function arrangeStudents(students, capacity) {
  const groups = students.reduce((acc, s) => {
    if (!acc[s.department]) acc[s.department] = [];
    acc[s.department].push(s);
    return acc;
  }, {});
  // ... shuffle groups, pick next student avoiding same dept as previous when possible
  return result;
}
```

### Preview + persist for student search

```363:413:backend/server.js
app.post("/api/generate-preview", (req, res) => {
  // ... filter by department/class, capacity check
  const arranged = arrangeStudents(eligibleStudents, capacity);
  const rows = toBenchLayout(arranged, left, right, perBench);
  // ... sessions.set(...); save to arrangements.json
});
```

---

## 10. Summary (one paragraph)

This system separates **frontend** (static HTML/CSS/JS for admin and public seat search) from **backend** (Express server that accepts Excel uploads, parses students, filters by department/class, assigns seats to reduce same-department neighbors, previews layout, saves results for lookup, and renders PDFs via Puppeteer). Data moves from **Excel file → JSON-like objects → ordered seat list → bench grid → HTML for PDF → PDF file**, while a simple **JSON file** stores arrangements so students can find their bench by registration number without admin access.

---

*End of report.*
