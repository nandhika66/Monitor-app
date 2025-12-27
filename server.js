require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',           // Change if needed
  password: 'Dougetdejavu?huh6',           // Your MySQL password
  database: 'monitor_app'
});

// Get projects
app.get('/projects', async (req, res) => {
  const [rows] = await pool.query('SELECT id, name FROM projects');
  res.json(rows);
});

// Get tasks for project
app.get('/tasks', async (req, res) => {
  const { projectId } = req.query;
  const [rows] = await pool.query(
    'SELECT id, name, parent_id, task_level, est_hours, act_hours FROM tasks WHERE project_id = ?',
    [projectId]
  );
  res.json(rows);
});

// Update actual hours
app.patch('/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const { actHours } = req.body;
  await pool.query('UPDATE tasks SET act_hours = ? WHERE id = ?', [actHours, id]);
  res.send('OK');
});

// Receive activity log
app.post('/activity', async (req, res) => {
  const { projectId, taskId, timestamp, screenshot, activity_json, active_minutes } = req.body;
  await pool.query(
    `INSERT INTO activity_logs 
     (project_id, task_id, timestamp, screenshot, activity_json, active_minutes) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [projectId, taskId, timestamp, screenshot, activity_json, active_minutes]
  );
  res.send('Logged');
});

app.listen(3000, () => {
  console.log('Backend running on http://localhost:3000');
});