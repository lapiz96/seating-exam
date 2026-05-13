# Smart Exam Seating Arrangement System

One document for this project: **how to go live**, **where data is stored (database)**, **how the app flows**, structure, and tech notes.

---

# Section 1 — Full live hosting (do this first if you want the site online)

## 1.1 What “live” means here

- **GitHub** = good place to **store code**. It does **not** run your Node server.
- **GitHub Pages** = free static website (HTML/CSS/JS only). **Upload Excel, PDF, seat search API do not run** on Pages alone.
- **Render (or Railway / Fly.io / a VPS)** = runs **Node.js** so the **full project** works (Excel, seating, PDF, find seat).

**For a complete live exam tool:** deploy on **Render** (or similar) with `npm start`. Use GitHub only to hold the repo, or add Pages later if you want a static front page.

---

## 1.2 Test on your computer first

1. Install **Node.js** (LTS): https://nodejs.org  
2. Open terminal in the project folder (where `package.json` is):

   ```text
   cd path\to\seating
   npm install
   npm run dev
   ```

3. Open browser:
   - Student: http://localhost:3000/ or http://localhost:3000/frontend/seat-search.html  
   - Admin: http://localhost:3000/admin or http://localhost:3000/frontend/admin.html  

4. Default admin (change for real use): **admin** / **admin123**  
5. Stop server: **Ctrl + C**

If port **3000** is busy:

```text
set PORT=3001
npm run dev
```

Then use http://localhost:3001/

---

## 1.3 Put the project on GitHub (code backup + deploy from there)

1. Create account at https://github.com → **New repository** (e.g. `seating`).  
2. In your project folder:

   ```text
   git init
   git add .
   git commit -m "first commit"
   git remote add origin https://github.com/YOUR_USERNAME/seating.git
   git branch -M main
   git push -u origin main
   ```

This only uploads files. It does **not** start the server on the internet.

---

## 1.4 Go fully live on Render (recommended)

1. Push repo to GitHub (1.3).  
2. https://render.com → sign in with GitHub → **New** → **Web Service** → pick this repo.  
3. Settings:
   - **Branch:** `main`
   - **Root directory:** empty (must see `package.json` at repo root)
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Runtime:** Node  

4. Create and wait for deploy. Use the URL Render gives you, e.g. `https://your-app.onrender.com`

5. Share these with users:
   - `https://your-app.onrender.com/` (student)
   - `https://your-app.onrender.com/admin` (admin)
   - Or `.../frontend/seat-search.html` and `.../frontend/admin.html`

**Notes:** Free tier may **sleep** when idle (first open can be slow). PDF needs enough RAM; if PDF fails, check Render logs.

---

## 1.5 GitHub Pages (optional — static pages only)

Use if you only need a **simple public HTML** view without server features.

1. Repo on GitHub → **Settings** → **Pages** → Source: branch **main**, folder **/** (root).  
2. Site URL: `https://YOUR_USERNAME.github.io/REPO_NAME/`  
3. Root **`index.html`** in this project links to `frontend/seat-search.html` and `frontend/admin.html`.  
4. **Upload / PDF / find seat will fail** on Pages unless you point the browser to a **Render** backend (1.6).

---

## 1.6 GitHub Pages + Render together (HTML on GitHub, API on Render)

1. Deploy full app on Render (1.4). Copy the **https** URL.  
2. Open `frontend/api-config.js` in your code.  
3. Set:

```js
window.API_BASE = "https://your-app.onrender.com";
```

4. Commit and push again to GitHub Pages.

Server already sends **CORS** headers so the browser can call Render from `github.io`. For production you can set env **`ALLOWED_ORIGIN`** to your exact GitHub Pages URL.

---

## 1.7 Hosting checklist

| Step | Done? |
|------|--------|
| `npm install` + `npm run dev` works on PC | |
| Code pushed to GitHub | |
| Render Web Service: build `npm install`, start `npm start` | |
| Share **Render** URL for real exam use | |
| (Optional) GitHub Pages + `window.API_BASE` in `frontend/api-config.js` | |

---

## 1.8 Common hosting problems

| Problem | Try this |
|---------|----------|
| `npm` not found | Install Node, restart terminal |
| Port in use | `set PORT=3001` then `npm run dev` |
| Blank site on GitHub Pages | Wait 2 min; branch **main**, folder **root**; `index.html` at repo root |
| Upload works locally but not on `github.io` | Normal — use Render or set `window.API_BASE` in `frontend/api-config.js` |
| Seat search “not found” | Admin must **Generate preview** once so data saves (Section 2) |

---

# Section 2 — Database and data storage (how your data is kept)

This project does **not** use MySQL or MongoDB in the code you have. It uses **files + memory** instead. Think of it as a **simple file-based store**, not a full database server.

## 2.1 What stores what

| Storage | File / place | What it holds | When it is used |
|---------|----------------|---------------|-----------------|
| **Session memory** | Inside Node (`Map` in RAM) | After Excel upload: `sessionId`, full student list for that upload | **Until the server restarts.** Then admin must upload Excel again. |
| **“Database” file (JSON)** | `backend/data/arrangements.json` | Saved seating plans: exam info + bench layout so **Find my seat** can search by register number | **Written** when admin clicks **Generate seating preview**. **Read on every** student search (`/api/find-seat`). Not one-time — each search opens and scans this file (newest exams first). |
| **Uploaded Excel** | `backend/uploads/` | Copy of each uploaded `.xlsx` / `.xls` | Kept on disk until you delete manually. |
| **PDF output** | `backend/generated/` | Generated PDF files | Created when admin clicks **Generate PDF**. |

## 2.2 Is `arrangements.json` a real database?

- For a **college project / demo**: yes, it works like a small **persistent database** for seat lookup.  
- For **heavy production** (many users at once): you would later move to PostgreSQL, MongoDB, etc.

## 2.3 After you host on Render — does data survive?

- **Yes**, as long as the service keeps the same **disk** and you do not wipe it.  
- If Render **redeploys** from scratch or you use **ephemeral** storage without a disk add-on, the file could reset — check Render docs for “persistent disk” if you need guarantees.  
- **Free tier sleep** does not erase disk; it only pauses the process.

## 2.4 How to clear and start fresh (new JSON)

- In **Admin** → Upload section: **Clear saved seating (JSON)** + admin password → empties `arrangements.json`.  
- Student search will find nothing until you **generate preview** again.  
- Old PDFs in `backend/generated/` are **not** deleted automatically.

## 2.5 Data fetch summary (one-time vs every time)

| Action | One-time or every time? |
|--------|-------------------------|
| Excel upload → data in **RAM** (session) | Lost on **server restart** — upload again |
| **Generate preview** | Writes / updates **`arrangements.json`** |
| Student **Find my seat** | **Every** request **reads** `arrangements.json` again |
| **Shuffle again** | Updates RAM + updates saved arrangement if already linked to an `arrangementId` |

---

# Section 3 — Working flow (how the website works)

## 3.1 Admin flow

1. Login → **Upload Excel** → server parses rows → returns `sessionId` (stored in server RAM).  
2. **Create exam** (name, date, hall, benches, department/class filters, etc.).  
3. **Generate preview** → filters students → seating algorithm → builds left/right benches → saves to **`arrangements.json`** → student search can work.  
4. Optional: **Shuffle again**.  
5. **Generate PDF** → HTML layout → Puppeteer → file in **`backend/generated/`**.

## 3.2 Student flow

1. Open seat search page → enter **registration number**.  
2. Browser calls **`GET /api/find-seat?regNo=...`**.  
3. Server reads **`arrangements.json`**, searches benches, returns hall / bench / exam info if found.

## 3.3 Data conversion pipeline (simple)

```text
Excel file → (multer saves disk) → xlsx reads rows → JavaScript objects
         → filter by dept/class → arrangeStudents → toBenchLayout
         → save JSON to arrangements.json + return to browser for preview
         → optional: renderPdfHtml → Puppeteer → PDF file on disk
```

---

# Section 4 — Project folder structure

```text
seating/
├── README.md                 ← this file (only project guide)
├── index.html                ← home links (e.g. GitHub Pages)
├── .nojekyll                 ← for GitHub Pages
├── package.json
├── backend/
│   ├── server.js
│   ├── data/
│   │   ├── arrangements.json   ← created at runtime (seat lookup)
│   │   └── students-template.csv
│   ├── uploads/              ← uploaded Excel
│   └── generated/            ← PDFs
└── frontend/
    ├── seat-search.html / .js
    ├── admin.html / .js
    ├── api-config.js
    └── style.css
```

---

# Section 5 — Tech stack

| Part | Technology |
|------|------------|
| Server | Node.js + Express |
| Excel | `xlsx` |
| Upload | `multer` |
| PDF | `puppeteer` |
| Frontend | HTML, CSS, JavaScript |
| Data | In-memory `Map` + JSON file |

---

# Section 6 — Main API routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/login` | Admin login |
| POST | `/api/upload` | Upload Excel |
| POST | `/api/generate-preview` | Build seating + save to JSON |
| POST | `/api/shuffle-again` | Reshuffle |
| POST | `/api/generate-pdf` | Create PDF |
| POST | `/api/admin/clear-arrangements` | Clear `arrangements.json` (password) |
| GET | `/api/find-seat?regNo=` | Public seat lookup |

---

# Section 7 — Important code (where to look)

| Topic | Location |
|-------|----------|
| Paths, static files, CORS | `backend/server.js` (top) |
| Excel parsing | `parseStudentsFromExcel` in `backend/server.js` |
| Seating logic | `arrangeStudents`, `toBenchLayout` in `backend/server.js` |
| Save / load JSON | `loadArrangements`, `saveArrangements`, `generate-preview`, `find-seat` in `backend/server.js` |
| Admin UI | `frontend/admin.js` |
| Student search | `frontend/seat-search.js` |

---

# Section 8 — Limitations (honest)

- Session (`sessionId`) is **lost on restart** — re-upload Excel.  
- `arrangements.json` is fine for projects; not ideal for huge concurrent writes.  
- Admin login is **demo-level** (hardcoded password in code).  
- Puppeteer needs Chromium; can be heavy on small free hosts.  
- Wrong Excel headers or class spelling breaks import/filter.

---

# Section 9 — One-paragraph summary

The **frontend** is static pages; the **backend** runs on **Node** and handles Excel, seating rules, PDFs, and APIs. **Live hosting** means running that Node process on a host like **Render**, while **GitHub** can hold code and optionally **GitHub Pages** for static HTML only. **Data** lives in **RAM** for the current upload session and in **`backend/data/arrangements.json`** for persistent seat lookup, which is **read on every student search** and **updated when the admin generates a preview**.
