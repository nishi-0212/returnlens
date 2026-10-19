# ReturnLens: Returns & Refund Root-Cause Agent

ReturnLens analyses product returns across orders, return reasons, customer reviews, product listings, shipments,
manufacturing batches, quality inspections and change logs. It groups what customers complain about, traces each
recurring problem to its likely cause (a batch, a supplier, a carrier, a listing or packaging change), puts a price on it,
recommends a specific corrective action, and later checks whether the fix actually worked.

It never calls a supplier or manufacturing defect *confirmed* on correlation alone: a finding is confirmed only when a
record documents the cause itself (a failed inspection report, the carrier's own damage scans).

```
Upload → Return analytics → Complaint groups → Root causes → Financial impact → Corrective actions → Did it work?
```

## Quick start (local)

Requirements: Python 3.11+ (3.12 recommended), Node 18+, a MongoDB database (MongoDB Atlas free tier works).

**Backend**

```bash
cd backend
python -m pip install -r requirements.txt
copy .env.example .env          # macOS/Linux: cp .env.example .env
# edit .env: MONGODB_URI (required), JWT_SECRET, optionally GROQ_API_KEY
python -m uvicorn app.main:app --reload --port 8000
```

API docs (Swagger): http://localhost:8000/docs · health check: http://localhost:8000/api/health

**Frontend**

```bash
cd frontend
npm install
copy .env.example .env          # VITE_API_URL=http://localhost:8000
npm run dev
```

Open http://localhost:5173, create an account, then **Upload data → Load the sample store**.

**Tests**

```bash
cd backend
python -m pytest
```

## Environment variables (`backend/.env`)

| Variable | Default | What it does |
|---|---|---|
| `MONGODB_URI` | `mongodb://localhost:27017` | MongoDB connection string |
| `MONGODB_DB` | `returnlens` | Database name (you can share an Atlas cluster with other apps) |
| `JWT_SECRET` | dev value | Secret for signing login tokens. Use a long random string |
| `JWT_EXPIRE_MINUTES` | `10080` | Session length (7 days) |
| `GROQ_API_KEY` | empty | Optional. Enables AI help (see "AI") |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq model (a non-Llama model) |
| `LLM_TIMEOUT_SECONDS` | `60` | Per-request timeout for the LLM |
| `FRONTEND_ORIGINS` | localhost | Comma-separated origins allowed by CORS (no trailing slash) |
| `MAX_UPLOAD_MB` | `15` | Largest file accepted |
| `MONITOR_ENABLED` | `true` | Daily check of completed fixes and alerts |
| `MONITOR_INTERVAL_MINUTES` | `60` | How often the daily-check loop wakes up (each workspace is checked once a day) |

Frontend: `VITE_API_URL` in `frontend/.env` (the backend URL, no trailing slash).

## The sample store (what to try)

`backend/app/sample_data/` holds 5½ months of a store's data (about 8,600 order lines, 630 returns, 720 reviews, 7,600
shipments, 38 batches, inspections, a change log and a Word QA report) with problems planted in it. The agent finds them:

| Planted problem | What ReturnLens reports | Status |
|---|---|---|
| Earbuds batch B-EB-0712 has a charging fault; inspection INSP-0419 failed it | Defects concentrated in that batch, 16% vs 1% | **Confirmed** (inspection record) |
| Glass vase and lamp break with carrier ParcelPro; the carrier logged damage scans | Transit damage concentrated in ParcelPro | **Confirmed** (carrier scans) |
| Sneakers changed supplier on Jun 1; the new supplier's QA report notes a short last | Sizing complaints jump after the supplier change | **Confirmed** (QA document) |
| Mug set moved to a single-wall box on Jun 15 | Packaging damage rose after the packaging change | Likely |
| Linen shirt got new photos/description on Jul 20 | "Not as described" rose after the listing update | Likely |
| Blender batch B-BL-0801 ships without the lid seal (no inspection on file) | Missing components concentrated in that batch | Likely (asks for an inspection report) |
| Jeans have steady fit complaints with no pattern | Sizing spread across the product | Possible |

**Add the next six weeks** (Upload page, step 2) marks six recommended fixes as implemented on the first day of the new
period, then uploads six more weeks of data in which five of those fixes really worked. You then see:

* the earbud batch, mug packaging, linen-shirt listing, sneaker last and blender batch fixes as **Improved**
  (significant drop, same product mix, other products didn't move),
* the carrier fix as **Inconclusive**, with a **"came back" alert** because transit damage keeps happening,
* new and resolved findings in "what changed since the last run".

## What it does (features)

**1. Data ingestion**
* CSV and Excel (one record type per sheet, several sheets per workbook) plus Word/PDF/text inspection reports.
* Eight record types: orders, returns, products/listings, reviews, shipments, batches, inspections and the change log.
* The type is detected from the columns (or picked by the user). Column names are mapped through synonyms ("RMA #",
  "Order Number", "Item SKU" …) to one standard schema.
* Validation per row: dates, quantities, negative amounts, missing IDs. Bad rows are skipped and reported (row, field,
  reason); good rows continue. Duplicate rows are detected, and re-uploads update records by natural key.
* Linking: each return is linked to its order line, product, supplier, batch and shipment. Missing batch IDs are
  inferred from the batch table, and marked as inferred.

**2. Return analytics**
* Total orders, units, returned units and return rate (by order date, so returns stay with their order's period).
* Refunds, and return-related costs (recorded vs estimated).
* Breakdowns by SKU, supplier, category, batch, reason, carrier and month. Weekly trends for return rate and refunds,
  with weeks still collecting returns marked.
* Baselines: the last 30 settled days vs the 90 days before, with a two-proportion z-test. Unusual increases are
  flagged for products, suppliers, categories and carriers, and batches far worse than their product's other batches.

**3. Complaint clustering**
* Reason codes, return comments and low-rated reviews are normalized.
* Each complaint is placed in a group by phrase patterns that recognise different wording for the same problem:
  sizing, defective, damaged packaging, damaged in delivery, not as described, missing components, poor quality,
  wrong item, late delivery, plus not-a-product-problem groups.
* Optionally the LLM places complaints the patterns couldn't (validated against the fixed groups).
* scikit-learn TF-IDF plus agglomerative clustering finds sub-themes within each group.
* Each group shows orders affected, wording variants with counts, and representative complaints (closest to the
  group's centre), with every record available.

**4. Root-cause investigation**
* For each group and product, the complaint rate is tested inside vs outside every batch, supplier, carrier and
  warehouse, and before vs after every listing, supplier, packaging and size-chart change.
* Tests use a two-proportion z-test with Bonferroni correction for the number of places checked. The best explanation
  is chosen from the causes that fit that kind of complaint.
* Statuses: **confirmed** needs a strong pattern plus a corroborating record; **likely** is a strong, significant
  pattern; **possible** is a weak or spread pattern.
* Every finding lists its supporting records (returns, reviews, inspections, carrier scans, changes), confidence, the
  comparison table, a weekly chart, alternative explanations and the missing data needed to verify it.

**5. Financial impact**
* Each return gets refund, return shipping, replacement, handling and write-off costs. Recorded amounts are used
  as-is; missing ones are estimated from editable assumptions.
* Recorded and estimated amounts are always shown separately.
* Totals by product, supplier, batch, complaint group and root cause, and the highest-cost recurring problems by
  monthly cost.

**6. Recommendations**
* One corrective action per finding, specific to the cause: batch inspection plus supplier quality review,
  packaging drop tests, carrier review, listing revision, size-chart and fit guidance, supplier spec comparison or a
  fulfilment audit.
* Each has a priority (money × certainty), owner, deadline and expected monthly savings.
* Approve, reject, or mark completed with the date it went live; owner and deadline are editable.
* Re-running the analysis never duplicates recommendations or overrides your decisions.

**7. Dashboard and investigation page**
* KPIs, trend charts, breakdowns and unusual increases. Filters (date range, SKU, category, supplier, batch,
  complaint group, root cause) live in the URL and apply to every chart.
* A dedicated investigation page per finding: complaint group, source evidence (click any ID to open the original
  record with its order and shipment), comparisons, chart, financial impact, alternatives, missing data,
  corrective action and the before/after result.

**8. Corrective-action verification**
* Compares equal-length periods before and after the implementation date, using only orders whose returns have
  had 14 days to arrive.
* Uses complaint rate per ordered unit (volume-independent), holds product mix fixed, and uses the same complaint
  on other products as a control.
* Verdicts:
  * **Improved** or **worsened** only with p < 0.05, a change of at least 20%, enough data, and no matching move in
    the control.
  * **Inconclusive** otherwise, with the reason, plus caveats (other changes in the window, seasonality).
  * **Too early** when there is too little settled data after the fix.
* Alerts when a fixed problem comes back, a result gets worse, or a product's or supplier's return rate rises. Alerts
  are refreshed after every analysis and by the daily check.

**Platform**
* JWT authentication (bcrypt, login throttling, show-password toggle).
* Workspaces (like chats) with strict per-user scoping, so another user's IDs return 404.
* In-process background queue with live stage progress, stop/cancel, and a re-run when new data arrives mid-run.
* Versioned analysis runs with "what changed". Request logging with request IDs, and friendly validation errors.
* Light, dark and system themes; respects reduced-motion settings.

## AI (Groq), always grounded

Without `GROQ_API_KEY` everything works on the rules: grouping, statistics, findings, costs and recommendations. With a
key the LLM is used for two jobs, and every output is validated and persisted:

1. **Complaint classification help.** Complaints the patterns couldn't place are sent in batches. The JSON must
   match the schema, use the given IDs, and use only the fixed group keys; anything else is dropped.
2. **Finding narratives.** The top findings' summaries are rewritten from the computed facts. A rewrite is
   rejected (the rule-based text is kept) if it contains a number that isn't in the facts, or claims more certainty
   than the status allows (e.g. "confirmed" for a likely finding). The UI marks AI summaries and keeps the rule-based
   version one click away.

The LLM never decides a status, a cost or a verdict; those come from the data.

## Architecture

```
frontend/ (React 18 + TypeScript + Vite + Tailwind)
  pages/       Home, Auth, Uploads, Overview, Complaints, Findings, Investigation, Costs, Actions, Verify
  components/  AppShell (top bar with the 7-step track, workspace menu, live job pill),
               charts (calendar heatmap, complaint→cause flow, case bubbles, cost waterfall, before/after
               slopes, dumbbells, peer dot strip, gauge, waffle, mosaic, word chips; all with a Table view),
               FilterBar, RecordDrawer (evidence viewer), RecActions, LiveRun
  lib/         api client (JWT + X-Workspace-Id), auth, theme, workspaces, jobs, filters, types

backend/ (FastAPI + PyMongo async + pandas + scikit-learn)
  app/main.py          app, CORS, request logging, error handling
  app/services/casefile.py  investigation page extras: peer comparison and dated timeline
  app/deps.py          current user + workspace scope (authorization)
  app/routers/         auth, workspaces, uploads, insights (overview, facets, complaints, costs, runs,
                       records), findings (findings, recommendations, verification, alerts, re-run),
                       jobs, demo
  app/services/
    ingest.py          file reading, kind detection, column synonyms, row validation, documents
    importer.py        upsert by natural key, upload reports
    dataset.py         load + link (orders ↔ returns ↔ products ↔ batches ↔ shipments), cache
    clustering.py      complaint taxonomy, patterns, TF-IDF sub-themes, representatives
    analytics.py       rates, filters, trends, breakdowns, baselines, unusual increases
    investigate.py     root-cause tests, change points, corroboration, status rules, evidence
    costs.py           cost lines, recorded vs estimated, assumptions
    recommend.py       cause-specific corrective actions
    verify.py          before/after verification, control group, alerts
    analysis.py        the run: stages, persistence, run diff
    ai.py / llm.py     Groq JSON calls, schema validation, grounding checks
    jobs.py            background queue, stages, cancel, daily check
    workspaces.py      scoping, stats, cache versioning
```

**MongoDB collections** (all data rows carry `user_id = "<user>:<workspace>"`):
* Data: `orders`, `returns`, `products`, `reviews`, `shipments`, `batches`, `inspections`, `changes`, each with a
  unique `key` per workspace.
* Results: `findings` (keyed), `recommendations` (one per finding), `alerts` (keyed), `runs` (versioned history).
* Operations: `uploads`, `jobs`, `events`, `settings` (cost assumptions).
* Accounts: `users`, `workspaces`.

## API

Authentication: `Authorization: Bearer <token>`. Workspace data also needs `X-Workspace-Id: <id>`.
Interactive docs at `/docs`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | Create account / sign in → token |
| GET | `/api/auth/me` | Current user |
| GET/POST | `/api/workspaces` | List (with stats) / new workspace (reuses an empty one) |
| PATCH/DELETE | `/api/workspaces/{id}` | Rename / delete one; `DELETE /api/workspaces` clears all |
| POST | `/api/uploads` | Upload a file (`file`, optional `kind`); starts the analysis when orders and returns exist |
| GET | `/api/uploads` | Upload history with per-sheet results and row errors |
| GET | `/api/overview` | KPIs (incl. cost lines), weekly trend, daily rates (heatmap), complaint→cause flows, breakdowns, baselines, spikes, batch outliers, all open findings (filters as query params) |
| GET | `/api/facets` | Values for the filter menus |
| GET | `/api/complaints` | Complaint groups (filters apply) |
| GET | `/api/complaints/{group}/records` | Every return/review in a group (paged) |
| GET | `/api/findings` | Root-cause findings (`status`, `cause`, `sku`, `include_resolved`) |
| GET | `/api/findings/{id}` | Investigation page data: finding, evidence, complaint group, action, verification, peers (rate of every batch/supplier/carrier) and a dated timeline |
| POST | `/api/analysis/run` | Re-run the analysis |
| GET | `/api/costs` | Financial impact (filters apply) |
| GET/PUT | `/api/costs/assumptions` | Read / change the estimate assumptions |
| GET | `/api/recommendations` | Corrective actions |
| PATCH | `/api/recommendations/{id}` | `{status: approved\|rejected\|completed\|proposed, implemented_at, owner, due_date, note}` |
| GET | `/api/recommendations/{id}/verification` | Before/after result |
| GET | `/api/verification` | All completed actions with results, plus alerts |
| GET/PATCH | `/api/alerts`, `/api/alerts/{id}` | List / mark read or dismissed |
| GET | `/api/runs` | Analysis history and what changed |
| GET | `/api/records/{kind}/{id}` | Original record (return, review, order, inspection, shipment, change, product, batch) |
| GET | `/api/jobs`, `/api/jobs/{id}` | Analysis progress; `POST /api/jobs/{id}/cancel` stops it |
| POST | `/api/demo/sample`, `/api/demo/update` | Load the sample store / the next six weeks |
| GET | `/api/demo/files`, `/api/demo/files/{name}` | Sample files (templates) |
| DELETE | `/api/demo/data` | Clear the current workspace |

Filters for overview/complaints/costs: `date_from`, `date_to` (YYYY-MM-DD), `sku`, `category`, `supplier`, `batch`,
`cluster`, `cause`.

## Tests

`backend/tests/`:

* `test_ingest.py`: kind detection for every sample file, column mapping, row validation, Excel with several sheets,
  Word inspection reports.
* `test_clustering.py`: different wording grouped together, reason codes, positive reviews excluded, themes.
* `test_engines.py`: on the sample store, every planted cause is found with the right status. Correlation alone is
  never confirmed. Costs split recorded/estimated, assumptions only change estimates, baselines, filters,
  recommendations match the cause, and verification returns improved, inconclusive and too early.
* `test_api.py`: auth, upload validation report, the whole workflow (sample → findings → evidence → costs →
  approve/reject/complete → verification), re-runs don't duplicate, new data changes the analysis and raises
  alerts, workspace isolation, empty workspace reuse.

## Deploy

**Backend on Render**: New → Web Service → this repo. Then:
* Root Directory `backend`.
* Build `python -m pip install -r requirements.txt`.
* Start `python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
* Env vars: `PYTHON_VERSION=3.12.7`, `MONGODB_URI`, `MONGODB_DB=returnlens`, `JWT_SECRET`, `GROQ_API_KEY`,
  `FRONTEND_ORIGINS`.

In MongoDB Atlas → Network Access, allow `0.0.0.0/0`. `render.yaml` has the same settings.

**Frontend on Vercel**: import the repo, then:
* Root Directory `frontend`, framework Vite.
* Env var `VITE_API_URL=https://<your-render-service>.onrender.com`.

Then add the Vercel URL to `FRONTEND_ORIGINS` on Render.

## Known limitations

* Statistics are designed for operational decisions, not for publication:
  * two-proportion z-tests with a Bonferroni correction;
  * the before/after check is observational (no randomised control), and says so;
  * seasonality is not modelled, only flagged as a caveat.
* Return rates by order date need time to settle. The last ~14 days are marked "still collecting returns" and are
  left out of baselines and verification.
* Complaint patterns are tuned for English text. Other languages fall back to reason codes, or to the LLM when a key
  is set.
* Scanned PDFs (images without text) can't be read.
* The background queue is in-process. A run that is interrupted by a restart is resumed when the server starts,
  but there is no separate worker fleet. On Render's free tier the service sleeps after 15 minutes idle, and
  the daily check only runs while it's awake.
* Integrations (Shopify, ERP, carrier APIs) are not included. Uploads are the data source, and the ingestion module
  is where integrations would plug in.
