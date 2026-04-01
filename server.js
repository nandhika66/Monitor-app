require('dotenv').config();
const express    = require('express');
const mysql      = require('mysql2/promise');
const cors       = require('cors');
const bodyParser = require('body-parser');
const fs         = require('fs');
const path       = require('path');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use('/uploads',   express.static(path.join(__dirname, 'uploads')));
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

// Redirect root → login
app.get('/', (req, res) => res.redirect('/dashboard/login.html'));

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'monitor_app',
});

const uploadDir = path.join(__dirname, 'uploads/screenshots');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'All fields required' });
  try {
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ?', [email]
    );
    if (existing.length > 0)
      return res.status(400).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, hash]
    );
    const token = jwt.sign(
      { id: result.insertId, email, name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: result.insertId, name, email } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0)
      return res.status(401).json({ error: 'Invalid email or password' });
    const user  = rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ─── PROJECTS ────────────────────────────────────────────────────────────────
app.get('/projects', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM projects ORDER BY id');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/projects', authMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });
  try {
    const [result] = await pool.query(
      'INSERT INTO projects (name) VALUES (?)', [name]
    );
    res.json({ success: true, id: result.insertId, name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/projects/:id', authMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });
  try {
    await pool.query('UPDATE projects SET name = ? WHERE id = ?', [name, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/projects/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── TASKS ───────────────────────────────────────────────────────────────────
app.get('/tasks', async (req, res) => {
  const { projectId } = req.query;
  try {
    const [rows] = await pool.query(
      `SELECT id, name, parent_id, task_level, est_hours, act_hours
       FROM tasks WHERE project_id = ? ORDER BY task_level, id`,
      [projectId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/tasks', authMiddleware, async (req, res) => {
  const { project_id, name, parent_id, est_hours } = req.body;
  if (!project_id || !name)
    return res.status(400).json({ error: 'project_id and name required' });
  let task_level = 1;
  if (parent_id) {
    const [parent] = await pool.query(
      'SELECT task_level FROM tasks WHERE id = ?', [parent_id]
    );
    if (parent.length > 0) task_level = parent[0].task_level + 1;
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO tasks (project_id, name, parent_id, task_level, est_hours, act_hours)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [project_id, name, parent_id || null, task_level, est_hours || 0]
    );
    res.json({ success: true, id: result.insertId, name, task_level });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Dashboard: update name / est_hours
app.put('/tasks/:id', authMiddleware, async (req, res) => {
  const { name, est_hours } = req.body;
  if (!name) return res.status(400).json({ error: 'Task name required' });
  try {
    await pool.query(
      'UPDATE tasks SET name = ?, est_hours = ? WHERE id = ?',
      [name, est_hours || 0, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Electron app: update act_hours (no auth, backward compat)
app.patch('/tasks/:id', async (req, res) => {
  const { actHours } = req.body;
  try {
    await pool.query(
      'UPDATE tasks SET act_hours = ? WHERE id = ?',
      [actHours, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/tasks/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── REPORTS ─────────────────────────────────────────────────────────────────
app.get('/reports/stats', authMiddleware, async (req, res) => {
  try {
    const [[{ total_projects }]] = await pool.query(
      'SELECT COUNT(*) AS total_projects FROM projects'
    );
    const [[{ total_tasks }]] = await pool.query(
      'SELECT COUNT(*) AS total_tasks FROM tasks'
    );
    const [[{ total_logs }]] = await pool.query(
      'SELECT COUNT(*) AS total_logs FROM activity_logs'
    );
    const [[{ avg_activity }]] = await pool.query(
      'SELECT COALESCE(AVG(activity_percentage), 0) AS avg_activity FROM activity_logs'
    );
    const [[{ total_active_minutes }]] = await pool.query(
      'SELECT COALESCE(SUM(active_minutes), 0) AS total_active_minutes FROM activity_logs'
    );
    res.json({
      total_projects,
      total_tasks,
      total_logs,
      avg_activity: Math.round(avg_activity),
      total_active_hours: Math.round((total_active_minutes / 60) * 10) / 10,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/reports', authMiddleware, async (req, res) => {
  const { projectId, taskId, startDate, endDate, page = 1, limit = 20 } = req.query;
  let query = `
    SELECT al.id, al.timestamp, al.screenshot,
           al.active_minutes, al.activity_percentage, al.activity_json,
           p.name AS project_name, t.name AS task_name
    FROM activity_logs al
    JOIN projects p ON al.project_id = p.id
    JOIN tasks    t ON al.task_id    = t.id
    WHERE 1=1
  `;
  const params = [];
  let countQuery = 'SELECT COUNT(*) AS total FROM activity_logs al WHERE 1=1';
  const countParams = [];

  if (projectId) {
    query      += ' AND al.project_id = ?'; params.push(projectId);
    countQuery += ' AND al.project_id = ?'; countParams.push(projectId);
  }
  if (taskId) {
    query      += ' AND al.task_id = ?'; params.push(taskId);
    countQuery += ' AND al.task_id = ?'; countParams.push(taskId);
  }
  if (startDate) {
    query      += ' AND al.timestamp >= ?'; params.push(startDate);
    countQuery += ' AND al.timestamp >= ?'; countParams.push(startDate);
  }
  if (endDate) {
    query      += ' AND al.timestamp <= ?'; params.push(endDate + ' 23:59:59');
    countQuery += ' AND al.timestamp <= ?'; countParams.push(endDate + ' 23:59:59');
  }

  const offset = (page - 1) * limit;
  query += ' ORDER BY al.timestamp DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  try {
    const [rows]             = await pool.query(query, params);
    const [[{ total }]]      = await pool.query(countQuery, countParams);
    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── ACTIVITY (Electron app) ──────────────────────────────────────────────────
app.post('/activity', async (req, res) => {
  const {
    projectId, taskId, timestamp,
    screenshot, activity_json,
    active_minutes, activity_percentage,
  } = req.body;

  let screenshotPath = null;
  if (screenshot && typeof screenshot === 'string' && screenshot.startsWith('data:image/png;base64,')) {
    try {
      const base64Data = screenshot.replace(/^data:image\/png;base64,/, '');
      const filename   = `screenshot_${Date.now()}.png`;
      const filePath   = path.join(uploadDir, filename);
      fs.writeFileSync(filePath, base64Data, 'base64');
      screenshotPath = `/uploads/screenshots/${filename}`;
    } catch (err) {
      console.error('Screenshot save failed:', err);
    }
  }

  try {
    await pool.query(
      `INSERT INTO activity_logs
       (project_id, task_id, timestamp, screenshot, activity_json, active_minutes, activity_percentage)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [projectId, taskId, timestamp, screenshotPath, activity_json,
       active_minutes, activity_percentage || 0]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to save activity log' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend → http://localhost:${PORT}`));