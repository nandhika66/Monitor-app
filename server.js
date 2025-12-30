require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Serve static files from 'uploads' folder (this enables image URLs)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MySQL connection pool
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'Dougetdejavu?huh6',
  database: 'monitor_app'
});

// Create uploads folder if missing
const uploadDir = path.join(__dirname, 'uploads/screenshots');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('Created uploads/screenshots folder');
}

// Get projects
app.get('/projects', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM projects');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get tasks for project
app.get('/tasks', async (req, res) => {
  const { projectId } = req.query;
  try {
    const [rows] = await pool.query(
      'SELECT id, name, parent_id, task_level, est_hours, act_hours FROM tasks WHERE project_id = ?',
      [projectId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching tasks:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Update actual hours in tasks
app.patch('/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const { actHours } = req.body;
  try {
    await pool.query('UPDATE tasks SET act_hours = ? WHERE id = ?', [actHours, id]);
    res.send({ success: true, message: 'Actual hours updated' });
  } catch (err) {
    console.error('Error updating task hours:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Receive activity log + screenshot
app.post('/activity', async (req, res) => {
  const { projectId, taskId, timestamp, screenshot, activity_json, active_minutes } = req.body;

  let screenshotPath = null;

  if (screenshot && typeof screenshot === 'string' && screenshot.startsWith('data:image/png;base64,')) {
    try {
      const base64Data = screenshot.replace(/^data:image\/png;base64,/, '');
      const filename = `screenshot_${Date.now()}.png`;
      const filePath = path.join(uploadDir, filename);

      fs.writeFileSync(filePath, base64Data, 'base64');
      screenshotPath = `/uploads/screenshots/${filename}`;

      console.log(`Screenshot saved: ${screenshotPath}`);
    } catch (err) {
      console.error('Failed to save screenshot file:', err);
    }
  }

  try {
    await pool.query(
      `INSERT INTO activity_logs 
       (project_id, task_id, timestamp, screenshot, activity_json, active_minutes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, taskId, timestamp, screenshotPath, activity_json, active_minutes]
    );

    res.json({ success: true, message: 'Activity block logged successfully' });
  } catch (err) {
    console.error('Database insert error:', err);
    res.status(500).json({ success: false, error: 'Failed to save activity log' });
  }
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});