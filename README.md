# RentEase — Modern Rental Management Platform

RentEase is a modern, responsive, multi-user rental management web platform built with Node.js, Express, SQLite (WAL mode with multi-table atomic transactions), and Socket.IO for real-time collaboration.

It is designed for property owners (landlords), residents (tenants), and platform administrators.

---

## Key Highlights & Architectural Features

### 1. Robust SQLite Database Architecture
* **WAL Journaling & Foreign Keys:** Full write-ahead logging (`PRAGMA journal_mode = WAL`) and strict relational integrity (`PRAGMA foreign_keys = ON`).
* **Multi-Table Atomic Transactions:** Complex operations—such as property creation, tenant lease assignment, payment recording, and maintenance progression—run inside atomic SQLite transactions (`db.transaction`).
* **Audit Activity Logging:** All actions (payments, maintenance submissions, tenant assignments, account status changes) persist into an `activity_logs` table.
* **Lease Contracts & e-Signatures:** Formal lease contracts are archived in the `leases` table with terms, rent, deposits, and digital base64 e-signature captures (`signature_data`, `signed_at`, `signed_by`).
* **Operating Expenses & Net Income (NOI):** Itemized expenses tracked in the `expenses` table across categories (Repairs, Taxes, Insurance, Utilities, Mortgage).
* **Community Announcements:** Real-time broadcasts persisted in the `announcements` table with urgency levels (Normal, Important, Urgent).
* **In-App Messaging:** Conversational direct message history stored in the `messages` table with instant Socket.IO transmission.
* **SQL Indexes:** Optimized performance with compound indexes on properties, payments, dates, tenant scopes, expenses, messages, and activity logs.
* **Database Diagnostics & Backup:** Administrative monitoring (`GET /api/admin/db-stats`) and point-in-time `.sqlite` raw backup download (`GET /api/admin/db-backup`).
* **Curated Demo Seeder:** Instant one-click portfolio population (`POST /api/demo/seed`) to explore sample luxury penthouses, townhomes, and villas.

### 2. Modern, Professional UI / UX System
* **Dark / Light Mode Switcher:** Persistent theme toggle with smooth transitions and local storage persistence.
* **Interactive Property Map (Leaflet.js / OpenStreetMap):** Live interactive map view displaying all portfolio properties across cities with custom pins showing occupancy status and monthly rent pills.
* **Expense & Net Operating Income (NOI) Calculator:** Visual KPI cards calculating gross rent collected, operating expenses, Net Operating Income (NOI), and profit margin percentage.
* **In-App Resident-Landlord Chat:** Real-time direct messaging between residents and property managers via Socket.IO.
* **Digital Lease e-Signature Pad:** Interactive HTML5 canvas signature pad allowing tenants and landlords to sign agreements directly in the browser.
* **Maintenance Photo Attachments:** Photo documentation of repair issues and visual proof of completion.
* **Financial CSV Export:** One-click export for Payments and Expenses ledgers (`.csv`).
* **Executive SaaS Aesthetics:** Modern typography with Plus Jakarta Sans and Inter, Emerald green accents, slate card layouts, and subtle borders.
* **Official Invoice & Receipt Generator:** Formally formatted digital receipts with corporate invoice IDs (`RE-YYYY-XXXXXX`), itemized breakdown, green "PAID" verification watermark stamp, and print/PDF-ready styling (`@media print`).

---

## Getting Started

### Requirements
* Node.js 20 or newer.

### Installation & Run

1. **Install dependencies:**
   ```sh
   npm install
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env` or edit `.env`:
   ```env
   PORT=3000
   SESSION_SECRET=your-secure-random-session-secret-here
   ADMIN_NAME=Platform Administrator
   ADMIN_EMAIL=admin@rentease.local
   ADMIN_PASSWORD=AdminSecure2026!
   ```

3. **Start the application:**
   ```sh
   npm start
   ```

4. **Open in browser:**
   Navigate to [http://localhost:3000](http://localhost:3000).

5. **Run test suite:**
   ```sh
   npm test
   ```

---

## Role-Based Workflows

* **Landlord:** Manage owned properties, review occupancy, view property map, assign registered tenants, digitally sign leases, record rent receipts, monitor NOI cash flow, log operating expenses, post community notices, chat with residents, and resolve maintenance tickets.
* **Tenant:** Access the "My Home" hub, view assigned rental specs, sign digital leases, pay simulated rent online, download/print official receipts, chat directly with the landlord, and submit maintenance tickets with photos.
* **Admin:** Review global rental transactions, monitor SQLite database metrics, download raw database backups, populate demo data, and manage user accounts.
* **Real-Time Synchronization:** Any update made in one browser tab automatically synchronizes across all active sessions via Socket.IO without page reloads.

---

## Documentation

* `docs/SRS.md` — Software Requirements Specification & Scrum process.
* `docs/design-diagrams.md` — UML Use Case, Class, Sequence, DFD, and updated ER diagrams.
* `docs/test-cases.md` — Test plan and validation test cases.
