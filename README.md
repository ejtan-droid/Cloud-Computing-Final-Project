# Web-Based Automated Stock Management System for Small Businesses
CS 315 Cloud Computing – University of San Agustin. A responsive web app for sari-sari stores: products, sales, automatic stock deduction, low-stock alerts, and daily/weekly/monthly reports.

**Stack:** HTML/CSS/JavaScript + Bootstrap 5 · Python FastAPI · PostgreSQL (Supabase) · GitHub · Render.

## Folder structure
```
app/            main.py (API), models.py, db.py, config.py, security.py, seed.py
app/static/     index.html, style.css, app.js (the website)
database/       schema.sql (optional manual table creation)
tests/          automated tests (pytest)
SETUP_GUIDE_WINDOWS.md   GITHUB_DEPLOYMENT_GUIDE.md   MOBILE_DEMO_GUIDE.md
.env.example  .gitignore  requirements.txt  render.yaml
```

## Quick start (Windows PowerShell, inside the project folder)
```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env        # then edit .env (see SETUP_GUIDE_WINDOWS.md)
python -m app.seed                 # creates tables + demo data
uvicorn app.main:app --reload      # open http://127.0.0.1:8000
python -m pytest                   # run tests
```

## Demo account (demonstration only – never store real data in it)
Username `demo` · Password `Demo@12345`. Reset its sample data any time: `python -m app.seed --reset` (touches only the demo account).

## Features
Registration/login/logout (bcrypt hashes, HttpOnly cookie token) · per-owner data isolation · dashboard from real data (totals, low stock, today's sales, 7-day chart) · product CRUD with search and delete confirmation · sales with automatic total and atomic stock deduction · in-app low-stock alerts (stock ≤ threshold) · reports (daily, weekly Mon–Sun, monthly, date filter, CSV, print) · `/health` endpoint.

## Design notes
- Sales use a single conditional `UPDATE ... WHERE quantity >= requested` plus the sale insert in one transaction, so stock can never go negative, even with two phones selling at once.
- Sales store a snapshot of product name/price, so reports stay correct after a product is edited or deleted.
- Money uses `NUMERIC(12,2)`; timestamps are stored in UTC and shown/grouped in `APP_TIMEZONE` (default Asia/Manila).
- SQLite (`sqlite:///./local_dev.db`) is allowed only as a quick local option and for automated tests. Deployment uses PostgreSQL.

## Verification status (honest summary)
| Item | Status |
|---|---|
| 11 automated tests (auth, isolation, validation, sales, stock, low stock, reports, seed) | Passed, on SQLite |
| App starts; `/health`, login, dashboard API checked with a live server | Passed, on SQLite |
| Real Supabase (PostgreSQL) connection | **Not tested** – needs your credentials |
| Render deployment, public URL | **Not performed** |
| Visual check in phone/desktop browsers at 360/390/768/desktop widths | **Not tested** – built with Bootstrap responsive classes; please check yourselves |
| Rate limiting / brute-force protection | Not included (out of scope) |

## Checklist of things YOU must do
- [ ] Follow SETUP_GUIDE_WINDOWS.md and confirm tests pass on your PC
- [ ] Create the Supabase project; put the connection string in `.env` (never share it)
- [ ] Run `python -m app.seed` against Supabase
- [ ] Open the site on desktop and phone; fix anything that looks wrong
- [ ] Push to GitHub (without `.env`), deploy on Render, set env vars
- [ ] Open the live URL on a phone and test every feature
- [ ] Take backup screenshots / a screen recording while it works
- [ ] Rehearse with MOBILE_DEMO_GUIDE.md; do a final visit to the URL the day before
- [ ] Fill in your paper's screenshots, survey results, references, and replace sample numbers with your real evaluation data
