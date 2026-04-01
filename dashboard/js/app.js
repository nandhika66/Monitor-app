// ── INIT ─────────────────────────────────────────────────────────────────────
const token = localStorage.getItem('token');
const user  = JSON.parse(localStorage.getItem('user') || '{}');

if (!token) window.location.href = '/dashboard/login.html';

document.getElementById('sidebarUser').textContent = user.name || 'User';

// ── API HELPER ────────────────────────────────────────────────────────────────
async function api(method, path, body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(path, opts);
    if (res.status === 401) { logout(); return null; }
    return await res.json();
  } catch (err) {
    console.error(`API ${method} ${path} failed:`, err);
    return null;
  }
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/dashboard/login.html';
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(link.dataset.section);
  });
});

function navigateTo(section) {
  document.querySelectorAll('.nav-link').forEach(l =>
    l.classList.toggle('active', l.dataset.section === section)
  );
  document.querySelectorAll('.section').forEach(s =>
    s.classList.toggle('active', s.id === `section-${section}`)
  );
  if (section === 'overview') loadOverview();
  if (section === 'projects') loadProjects();
  if (section === 'reports')  loadReports();
}

// ── OVERVIEW ──────────────────────────────────────────────────────────────────
async function loadOverview() {
  const [stats, reports] = await Promise.all([
    api('GET', '/reports/stats'),
    api('GET', '/reports?limit=8'),
  ]);
  if (stats)   renderStats(stats);
  if (reports) renderRecentActivity(reports.data);
}

function renderStats(s) {
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon blue">📁</div>
      <div><div class="stat-value">${s.total_projects}</div><div class="stat-label">Projects</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green">✅</div>
      <div><div class="stat-value">${s.total_tasks}</div><div class="stat-label">Tasks</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon yellow">⏱️</div>
      <div><div class="stat-value">${s.total_active_hours}h</div><div class="stat-label">Active Hours Tracked</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon purple">📊</div>
      <div><div class="stat-value">${s.avg_activity}%</div><div class="stat-label">Avg Activity Score</div></div>
    </div>
  `;
}

function renderRecentActivity(logs) {
  const el = document.getElementById('recentActivity');
  if (!logs || logs.length === 0) {
    el.innerHTML = '<div class="loading">No activity logs yet — start tracking in the desktop app!</div>';
    return;
  }
  el.innerHTML = `
    <table class="recent-table">
      <thead>
        <tr>
          <th>Timestamp</th><th>Project</th><th>Task</th>
          <th>Active</th><th>Activity %</th><th>Screenshot</th>
        </tr>
      </thead>
      <tbody>
        ${logs.map(log => `
          <tr>
            <td>${formatDate(log.timestamp)}</td>
            <td>${esc(log.project_name)}</td>
            <td>${esc(log.task_name)}</td>
            <td>${log.active_minutes} min</td>
            <td>${activityBadge(log.activity_percentage)}</td>
            <td>${screenshotThumb(log.screenshot, log.timestamp, log.project_name, log.task_name)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ── PROJECTS ──────────────────────────────────────────────────────────────────
let allProjects      = [];
let editingProjectId = null;
let editingTaskId    = null;
let taskProjectId    = null;
let taskParentId     = null;

async function loadProjects() {
  allProjects = await api('GET', '/projects') || [];
  renderProjects();
}

function renderProjects() {
  const el = document.getElementById('projectsList');
  if (allProjects.length === 0) {
    el.innerHTML = `
      <div class="card">
        <div class="loading">No projects yet. Click <strong>+ New Project</strong> to create one — it will appear in the desktop app immediately.</div>
      </div>`;
    return;
  }
  el.innerHTML = `
    <div class="projects-grid">
      ${allProjects.map(p => `
        <div class="project-card">
          <div class="project-card-header">
            <div class="project-name">📁 ${esc(p.name)}</div>
            <div class="project-actions">
              <button class="btn btn-ghost btn-sm" onclick="openAddTaskModal(${p.id})">+ Task</button>
              <button class="btn btn-ghost btn-sm" onclick="openEditProjectModal(${p.id}, ${JSON.stringify(p.name)})">Edit</button>
              <button class="btn btn-ghost btn-sm" style="color:var(--danger)"
                      onclick="deleteProject(${p.id})">Delete</button>
            </div>
          </div>
          <div class="project-tasks" id="tasks-${p.id}">
            <div class="loading" style="padding:16px">Loading tasks...</div>
          </div>
        </div>
      `).join('')}
    </div>`;
  allProjects.forEach(p => loadTasksForProject(p.id));
}

async function loadTasksForProject(projectId) {
  const tasks = await api('GET', `/tasks?projectId=${projectId}`) || [];
  const el    = document.getElementById(`tasks-${projectId}`);
  if (!el) return;

  if (tasks.length === 0) {
    el.innerHTML = '<div class="no-tasks">No tasks yet — click "+ Task" to add one.</div>';
    return;
  }

  function renderTask(task, level) {
    const children = tasks.filter(t => t.parent_id === task.id);
    return `
      <div class="task-item task-indent-${level}">
        <div class="task-info">
          <div class="task-dot task-dot-${level}"></div>
          <span class="task-name">${esc(task.name)}</span>
          <span class="task-meta">${task.est_hours}h est · ${task.act_hours}h actual</span>
        </div>
        <div class="task-actions">
          ${level < 3
            ? `<button class="btn btn-ghost btn-sm"
                       onclick="openAddSubtaskModal(${projectId}, ${task.id})">+ Sub</button>`
            : ''}
          <button class="btn btn-ghost btn-sm"
                  onclick="openEditTaskModal(${task.id}, ${JSON.stringify(task.name)}, ${task.est_hours}, ${projectId})">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)"
                  onclick="deleteTask(${task.id}, ${projectId})">Del</button>
        </div>
      </div>
      ${children.map(c => renderTask(c, level + 1)).join('')}
    `;
  }

  const level1 = tasks.filter(t => !t.parent_id);
  el.innerHTML  = `<div class="task-tree">${level1.map(t => renderTask(t, 1)).join('')}</div>`;
}

// Project modal
function openProjectModal() {
  editingProjectId = null;
  document.getElementById('projectModalTitle').textContent = 'New Project';
  document.getElementById('projectNameInput').value        = '';
  document.getElementById('projectModalError').classList.add('hidden');
  document.getElementById('projectModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('projectNameInput').focus(), 50);
}

function openEditProjectModal(id, name) {
  editingProjectId = id;
  document.getElementById('projectModalTitle').textContent = 'Edit Project';
  document.getElementById('projectNameInput').value        = name;
  document.getElementById('projectModalError').classList.add('hidden');
  document.getElementById('projectModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('projectNameInput').focus(), 50);
}

async function saveProject() {
  const name    = document.getElementById('projectNameInput').value.trim();
  const errorEl = document.getElementById('projectModalError');
  if (!name) {
    errorEl.textContent = 'Project name is required';
    errorEl.classList.remove('hidden');
    return;
  }
  const result = editingProjectId
    ? await api('PUT',  `/projects/${editingProjectId}`, { name })
    : await api('POST', '/projects', { name });

  if (result && result.success !== false) {
    closeModal('projectModal');
    loadProjects();
  } else {
    errorEl.textContent = result?.error || 'Failed to save project';
    errorEl.classList.remove('hidden');
  }
}

async function deleteProject(id) {
  if (!confirm('Delete this project along with all its tasks and activity logs? This cannot be undone.')) return;
  const result = await api('DELETE', `/projects/${id}`);
  if (result?.success) loadProjects();
}

// Task modal
async function openAddTaskModal(projectId) {
  editingTaskId  = null;
  taskProjectId  = projectId;
  taskParentId   = null;
  document.getElementById('taskModalTitle').textContent = 'New Task';
  document.getElementById('taskNameInput').value        = '';
  document.getElementById('taskEstHours').value         = '';
  document.getElementById('taskModalError').classList.add('hidden');
  document.getElementById('parentTaskRow').style.display = 'flex';
  await populateParentOptions(projectId, null);
  document.getElementById('taskModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('taskNameInput').focus(), 50);
}

async function openAddSubtaskModal(projectId, parentId) {
  editingTaskId = null;
  taskProjectId = projectId;
  taskParentId  = parentId;
  document.getElementById('taskModalTitle').textContent = 'New Subtask';
  document.getElementById('taskNameInput').value        = '';
  document.getElementById('taskEstHours').value         = '';
  document.getElementById('taskModalError').classList.add('hidden');
  document.getElementById('parentTaskRow').style.display = 'flex';
  await populateParentOptions(projectId, parentId);
  document.getElementById('taskModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('taskNameInput').focus(), 50);
}

function openEditTaskModal(taskId, name, estHours, projectId) {
  editingTaskId = taskId;
  taskProjectId = projectId;
  document.getElementById('taskModalTitle').textContent = 'Edit Task';
  document.getElementById('taskNameInput').value        = name;
  document.getElementById('taskEstHours').value         = estHours;
  document.getElementById('taskModalError').classList.add('hidden');
  document.getElementById('parentTaskRow').style.display = 'none'; // no re-parenting on edit
  document.getElementById('taskModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('taskNameInput').focus(), 50);
}

async function populateParentOptions(projectId, selectedId) {
  const tasks  = await api('GET', `/tasks?projectId=${projectId}`) || [];
  const select = document.getElementById('taskParentInput');
  select.innerHTML = '<option value="">None — Top Level</option>';
  tasks.filter(t => t.task_level < 3).forEach(t => {
    const opt     = document.createElement('option');
    opt.value     = t.id;
    opt.textContent = `${'→ '.repeat(t.task_level - 1)}${t.name}`;
    opt.selected  = t.id === selectedId;
    select.appendChild(opt);
  });
}

async function saveTask() {
  const name     = document.getElementById('taskNameInput').value.trim();
  const estHours = parseFloat(document.getElementById('taskEstHours').value) || 0;
  const errorEl  = document.getElementById('taskModalError');

  if (!name) {
    errorEl.textContent = 'Task name is required';
    errorEl.classList.remove('hidden');
    return;
  }

  let result;
  if (editingTaskId) {
    result = await api('PUT', `/tasks/${editingTaskId}`, { name, est_hours: estHours });
  } else {
    const parentVal = document.getElementById('taskParentInput').value;
    result = await api('POST', '/tasks', {
      project_id: taskProjectId,
      name,
      parent_id: taskParentId || (parentVal ? parseInt(parentVal) : null),
      est_hours:  estHours,
    });
  }

  if (result && result.success !== false) {
    closeModal('taskModal');
    loadTasksForProject(taskProjectId);
  } else {
    errorEl.textContent = result?.error || 'Failed to save task';
    errorEl.classList.remove('hidden');
  }
}

async function deleteTask(taskId, projectId) {
  if (!confirm('Delete this task? Subtasks will also be deleted.')) return;
  const result = await api('DELETE', `/tasks/${taskId}`);
  if (result?.success) loadTasksForProject(projectId);
}

// ── REPORTS ───────────────────────────────────────────────────────────────────
let reportPage    = 1;
let reportFilters = {};

async function loadReports() {
  const projs     = await api('GET', '/projects') || [];
  const filterSel = document.getElementById('filterProject');
  filterSel.innerHTML = '<option value="">All Projects</option>';
  projs.forEach(p => {
    const opt       = document.createElement('option');
    opt.value       = p.id;
    opt.textContent = p.name;
    filterSel.appendChild(opt);
  });
  await fetchReports();
}

async function fetchReports() {
  const params = new URLSearchParams({ page: reportPage, limit: 20 });
  if (reportFilters.projectId) params.set('projectId', reportFilters.projectId);
  if (reportFilters.startDate) params.set('startDate', reportFilters.startDate);
  if (reportFilters.endDate)   params.set('endDate',   reportFilters.endDate);

  const data = await api('GET', `/reports?${params}`);
  if (!data) return;
  renderReportsTable(data.data);
  renderPagination(data.total, data.page, data.limit);
}

function renderReportsTable(logs) {
  const tbody = document.getElementById('reportsBody');
  if (!logs || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No activity logs found for this filter.</td></tr>';
    return;
  }
  tbody.innerHTML = logs.map(log => `
    <tr>
      <td>${formatDate(log.timestamp)}</td>
      <td>${esc(log.project_name)}</td>
      <td>${esc(log.task_name)}</td>
      <td>${log.active_minutes} min</td>
      <td>${activityBadge(log.activity_percentage)}</td>
      <td>${screenshotThumb(log.screenshot, log.timestamp, log.project_name, log.task_name)}</td>
    </tr>
  `).join('');
}

function renderPagination(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  const el         = document.getElementById('pagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  let html = `<span style="font-size:12px;color:var(--text-muted);margin-right:8px">${total} records</span>`;
  html += `<button class="page-btn" onclick="changePage(${page-1})" ${page<=1 ? 'disabled':''}>← Prev</button>`;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) {
      html += `<button class="page-btn ${i===page?'active':''}" onclick="changePage(${i})">${i}</button>`;
    } else if (Math.abs(i - page) === 2) {
      html += `<span style="padding:0 4px;color:var(--text-muted)">…</span>`;
    }
  }

  html += `<button class="page-btn" onclick="changePage(${page+1})" ${page>=totalPages?'disabled':''}>Next →</button>`;
  el.innerHTML = html;
}

function changePage(page) { reportPage = page; fetchReports(); }

function applyFilters() {
  reportPage    = 1;
  reportFilters = {
    projectId: document.getElementById('filterProject').value,
    startDate: document.getElementById('filterStart').value,
    endDate:   document.getElementById('filterEnd').value,
  };
  fetchReports();
}

function clearFilters() {
  document.getElementById('filterProject').value = '';
  document.getElementById('filterStart').value   = '';
  document.getElementById('filterEnd').value     = '';
  reportFilters = {};
  reportPage    = 1;
  fetchReports();
}

// ── SCREENSHOT MODAL ──────────────────────────────────────────────────────────
function openScreenshot(src, meta) {
  document.getElementById('screenshotImg').src        = src;
  document.getElementById('screenshotMeta').textContent = meta;
  document.getElementById('screenshotModal').classList.remove('hidden');
}

// ── MODALS ────────────────────────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

['projectModal', 'taskModal'].forEach(id => {
  document.getElementById(id).addEventListener('click', function(e) {
    if (e.target === this) closeModal(id);
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape')
    ['projectModal', 'taskModal', 'screenshotModal'].forEach(closeModal);
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
function formatDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function activityBadge(pct) {
  if (pct >= 80) return `<span class="badge badge-green">${pct}%</span>`;
  if (pct >= 50) return `<span class="badge badge-yellow">${pct}%</span>`;
  return `<span class="badge badge-red">${pct || 0}%</span>`;
}

function screenshotThumb(path, timestamp, project, task) {
  if (!path) return '<span class="no-screenshot">—</span>';
  const meta = `${formatDate(timestamp)} · ${project} · ${task}`;
  // Use data attributes to avoid quote escaping issues in onclick
  return `<img class="screenshot-thumb" src="${path}" alt="screenshot"
               data-src="${path}" data-meta="${meta.replace(/"/g, '&quot;')}"
               onclick="openScreenshot(this.dataset.src, this.dataset.meta)">`;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
loadOverview();
