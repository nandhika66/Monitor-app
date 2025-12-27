# Monitor App

A powerful desktop time-tracking application similar to Worksnaps, built with **Electron**, **React**, **Vite**, and **MySQL**.

## Features
- Compact 480×420 pixel window (no horizontal scrollbar)
- Demo login (any email/password works)
- Project & hierarchical task selection from database
- Real-time mouse & keyboard activity tracking (live counters)
- 10-minute activity blocks with:
  - Per-minute mouse/keyboard counts
  - Active window detection
  - Random screenshot capture (saved as base64)
- Data stored in MySQL (`activity_logs` table)
- Start / Pause / Resume / Stop controls
- Actual hours auto-updated in tasks table

## Tech Stack
- Frontend: React + Vite
- Desktop: Electron
- Backend: Node.js + Express
- Database: MySQL
- Global input tracking: uIOhook-napi
- Screenshots: Electron desktopCapturer

## Setup & Run
1. Clone the repo:
   ```bash
   git clone https://github.com/YOUR_USERNAME/monitor-app.git
   cd monitor-app
2. Install dependencies:
   ```bash
   npm install
3. Start MySQL server and create database monitor_app (use provided SQL in docs/)
4. Run the app:
   ```bash
   npm run dev

## Database Setup
Run the SQL script in database.sql (or copy from project docs) to create tables and insert sample data.

## Next Steps / Planned Features

-Real website login integration
-Admin dashboard for viewing screenshots & reports
-Productivity scoring & daily summaries
-Offline queue & auto-sync

## License
MIT License
Built by Nandhika – December 2025
GitHub: https://github.com/nandhika66