-- Monitor App Database Setup Script
-- Run this in MySQL Workbench, phpMyAdmin, or command line

-- 1. Create the database (safe to run multiple times)
CREATE DATABASE IF NOT EXISTS monitor_app;
USE monitor_app;

-- 2. Drop tables if they exist (for clean reset during testing - optional)
DROP TABLE IF EXISTS activity_logs;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS projects;

-- 3. Create projects table
CREATE TABLE projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);

-- 4. Create tasks table (hierarchical structure)
CREATE TABLE tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    parent_id INT DEFAULT NULL,
    task_level INT NOT NULL,
    est_hours DECIMAL(8,2) DEFAULT 0.00,
    act_hours DECIMAL(8,2) DEFAULT 0.00,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- 5. Create activity_logs table (stores tracking data + screenshots)
CREATE TABLE activity_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    task_id INT NOT NULL,
    timestamp DATETIME NOT NULL,
    screenshot LONGTEXT,                    -- Full base64 PNG screenshots
    activity_json JSON,                     -- Per-minute mouse/keyboard/active data
    active_minutes INT DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- 6. Sample Data - Projects
INSERT INTO projects (name) VALUES
('Client Website Redesign'),
('Internal CRM Development'),
('Mobile Banking App'),
('Marketing Campaign Q4 2025');

-- 7. Sample Data - Tasks (with hierarchy)
INSERT INTO tasks (project_id, name, parent_id, task_level, est_hours, act_hours) VALUES
(1, 'Frontend Development', NULL, 1, 50.00, 18.75),
(1, 'Design Homepage', 1, 2, 12.00, 4.50),
(1, 'Implement Responsive Grid', 1, 2, 20.00, 8.20),
(1, 'Add Navigation Menu', 2, 3, 5.00, 2.10),
(1, 'Create Hero Banner Animation', 2, 3, 7.00, 2.40),

(2, 'Database Design', NULL, 1, 15.00, 6.20),
(2, 'Build Admin Panel', NULL, 1, 30.00, 14.80),
(2, 'Charts & Graphs Integration', 7, 2, 18.00, 9.00),

(3, 'UI/UX Wireframes', NULL, 1, 20.00, 12.50),
(3, 'Login & Security Flow', NULL, 1, 25.00, 8.00),
(3, 'Transaction History', 10, 2, 15.00, 3.80);

-- 8. Verification Queries (run these to check setup)
-- List all projects
SELECT * FROM projects;

-- List tasks with hierarchy
SELECT 
    t.id, t.name, t.task_level, p.name AS project, parent.name AS parent_task
FROM tasks t
LEFT JOIN projects p ON t.project_id = p.id
LEFT JOIN tasks parent ON t.parent_id = parent.id
ORDER BY t.project_id, t.task_level;

-- Check recent activity logs
SELECT id, timestamp, screenshot IS NOT NULL AS has_screenshot, active_minutes 
FROM activity_logs 
ORDER BY timestamp DESC 
LIMIT 5;

-- Total logs count
SELECT COUNT(*) AS total_activity_logs FROM activity_logs;