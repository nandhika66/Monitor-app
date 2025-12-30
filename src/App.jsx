import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Clock, Play, Pause, StopCircle, LogOut } from 'lucide-react';

const API_BASE = 'http://localhost:3000'; // Your backend

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [projects, setProjects] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedTask, setSelectedTask] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isTracking, setIsTracking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activityStats, setActivityStats] = useState({ mouse: 0, keyboard: 0 });
  const [activityPercentage, setActivityPercentage] = useState(0);
  const [estHours, setEstHours] = useState(0);
  const [baseActualTime, setBaseActualTime] = useState(0);

  const timerRef = useRef(null);

  useEffect(() => {
    // 1. Check for existing demo token and auto-login
    const token = localStorage.getItem('demoToken');
    if (token) {
      setIsLoggedIn(true);
      fetchProjects().catch(err => {
        console.error('Auto-fetch projects failed on load:', err);
      });
    }

    // 2. Set up Electron activity listener
    if (window.electronAPI) {
      window.electronAPI.onActivityUpdate((event, stats) => {
        setActivityStats({
          mouse: stats.mouse || 0,
          keyboard: stats.keyboard || 0,
        });
        if (stats.activityPercentage !== undefined) {
          setActivityPercentage(stats.activityPercentage);
        }
      });
    }

    // Cleanup on unmount
    return () => {
      clearInterval(timerRef.current);
    };
  }, []);

  const handleDemoLogin = () => {
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }
    const fakeToken = 'demo-token-' + Date.now();
    localStorage.setItem('demoToken', fakeToken);
    setIsLoggedIn(true);
    setError('');
    fetchProjects();
  };

  const handleLogout = () => {
    localStorage.removeItem('demoToken');
    setIsLoggedIn(false);
    setProjects([]);
    setAllTasks([]);
    setSelectedProject('');
    setSelectedTask('');
    if (isTracking) stopTracking();
  };

  const fetchProjects = async () => {
    try {
      const res = await axios.get(`${API_BASE}/projects`);
      setProjects(res.data);
    } catch (err) {
      console.error('Failed to fetch projects', err);
      setProjects([]);
    }
  };

  const fetchTasks = async (projectId) => {
    try {
      const res = await axios.get(`${API_BASE}/tasks?projectId=${projectId}`);
      setAllTasks(res.data);
    } catch (err) {
      console.error('Failed to fetch tasks', err);
    }
  };

  const getTasksByLevel = (level, parentId = null) => {
    return allTasks.filter(t =>
      t.task_level === level && (parentId === null ? !t.parent_id : t.parent_id === parentId)
    );
  };

  const handleProjectChange = (e) => {
    const pid = e.target.value;
    setSelectedProject(pid);
    setSelectedTask('');
    if (pid) fetchTasks(pid);
  };

  const startTracking = () => {
    if (!selectedProject || !selectedTask) return alert('Please select project and task');
    const task = allTasks.find(t => t.id === Number(selectedTask));
    if (!task) return;
    setEstHours(task.est_hours * 3600000);
    setBaseActualTime(task.act_hours * 3600000);
    setIsTracking(true);
    setIsPaused(false);
    timerRef.current = setInterval(() => setElapsedTime(prev => prev + 1000), 1000);
    window.electronAPI.startTracking({
      projectId: Number(selectedProject),
      taskId: Number(selectedTask)
    });
  };

  const pauseTracking = () => {
    clearInterval(timerRef.current);
    setIsPaused(true);
    window.electronAPI.pauseTracking();
    saveActualHours();
  };

  const resumeTracking = () => {
    setIsPaused(false);
    timerRef.current = setInterval(() => setElapsedTime(prev => prev + 1000), 1000);
    window.electronAPI.resumeTracking();
  };

  const stopTracking = () => {
    clearInterval(timerRef.current);
    setIsTracking(false);
    setElapsedTime(0);
    window.electronAPI.stopTracking();
    saveActualHours();
  };

  const saveActualHours = async () => {
    const totalHours = (baseActualTime + elapsedTime) / 3600000;
    try {
      await axios.patch(`${API_BASE}/tasks/${selectedTask}`, { actHours: totalHours });
    } catch (err) {
      console.error('Failed to save actual hours', err);
    }
  };

  const formatTime = (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const currentTime = baseActualTime + elapsedTime;
  const exceeded = currentTime > estHours && estHours > 0;

  // Color for activity percentage
  const getActivityColor = (percent) => {
    if (percent >= 80) return '#22c55e'; // Green
    if (percent >= 50) return '#eab308'; // Yellow
    return '#ef4444'; // Red
  };

  return (
    <div
      style={{
        width: '480px',
        height: '420px',
        padding: '16px',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        overflowY: 'auto',
        fontFamily: 'system-ui, sans-serif',
        backgroundColor: '#ffffff',
        position: 'relative',
      }}
    >
      <div style={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
        <h2
          style={{
            textAlign: 'center',
            margin: '0 0 12px 0',
            fontSize: '18px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          Monitor App
        </h2>

        {!isLoggedIn ? (
          <div style={{ textAlign: 'center' }}>
            <input
              type="email"
              placeholder="Email (any)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%',
                maxWidth: '100%',
                padding: '9px',
                marginBottom: '10px',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
            <input
              type="password"
              placeholder="Password (any)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                maxWidth: '100%',
                padding: '9px',
                marginBottom: '10px',
                fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleDemoLogin}
              style={{
                width: '100%',
                maxWidth: '100%',
                padding: '9px',
                fontSize: '13px',
                marginBottom: '10px',
                boxSizing: 'border-box',
              }}
            >
              Login (Demo)
            </button>
            {error && <p style={{ color: 'red', fontSize: '12px' }}>{error}</p>}
            <p style={{ fontSize: '11px', color: '#777' }}>
              Any email/password works — demo mode
            </p>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
              }}
            >
              <span style={{ fontSize: '13px' }}>Logged in as demo user</span>
              <button
                onClick={handleLogout}
                style={{
                  fontSize: '11px',
                  padding: '5px 10px',
                  background: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                }}
              >
                <LogOut size={12} /> Logout
              </button>
            </div>

            {/* Project Select */}
            <div style={{ width: '100%', overflowX: 'hidden', marginBottom: '10px' }}>
              <select
                value={selectedProject}
                onChange={handleProjectChange}
                style={{
                  width: '100%',
                  padding: '8px',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">Select Project</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Task Select */}
            <div style={{ width: '100%', overflowX: 'hidden', marginBottom: '16px' }}>
              <select
                value={selectedTask}
                onChange={e => setSelectedTask(e.target.value)}
                disabled={!selectedProject}
                style={{
                  width: '100%',
                  padding: '8px',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">Select Task / Subtask</option>
                {getTasksByLevel(1).map(t => (
                  <optgroup
                    key={t.id}
                    label={t.name.length > 40 ? t.name.substring(0, 37) + '...' : t.name}
                  >
                    {[t, ...allTasks.filter(st => st.parent_id === t.id)].map(st => (
                      <option
                        key={st.id}
                        value={st.id}
                        title={st.name}
                      >
                        → {st.name.length > 35 ? st.name.substring(0, 32) + '...' : st.name}
                        ({st.est_hours}h est)
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Timer */}
            {isTracking && (
              <div style={{ textAlign: 'center', marginBottom: '16px', fontSize: '22px', fontWeight: 'bold' }}>
                {formatTime(elapsedTime)}
                {exceeded && (
                  <span style={{ color: 'red', fontSize: '13px', display: 'block' }}>
                    Exceeded Estimate!
                  </span>
                )}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '16px' }}>
              {!isTracking ? (
                <button
                  onClick={startTracking}
                  style={{ padding: '9px 20px', fontSize: '13px', minWidth: '90px' }}
                >
                  <Play size={14} /> Start
                </button>
              ) : (
                <>
                  {isPaused ? (
                    <button onClick={resumeTracking} style={{ padding: '9px 20px', fontSize: '13px', minWidth: '90px' }}>
                      <Play size={14} /> Resume
                    </button>
                  ) : (
                    <button onClick={pauseTracking} style={{ padding: '9px 20px', fontSize: '13px', minWidth: '90px' }}>
                      <Pause size={14} /> Pause
                    </button>
                  )}
                  <button onClick={stopTracking} style={{ padding: '9px 20px', fontSize: '13px', minWidth: '90px' }}>
                    <StopCircle size={14} /> Stop
                  </button>
                </>
              )}
            </div>

            {/* Updated Activity Display with Percentage */}
            <div
              style={{
                fontSize: '12px',
                textAlign: 'center',
                color: '#555',
                marginTop: '16px',
                padding: '8px',
                backgroundColor: '#f8f9fa',
                borderRadius: '6px',
                border: '1px solid #e0e0e0',
              }}
            >
              <div style={{ marginBottom: '4px' }}>
                <strong>Mouse:</strong> {activityStats.mouse} | 
                <strong> Keyboard:</strong> {activityStats.keyboard}
              </div>
              <div style={{ fontWeight: 'bold' }}>
                Activity: 
                <span style={{ 
                  color: getActivityColor(activityPercentage),
                  marginLeft: '4px'
                }}>
                  {activityPercentage}%
                </span>
                <span style={{ fontSize: '11px', color: '#888', marginLeft: '4px' }}>
                  (this block)
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Helper function for color-coding percentage
const getActivityColor = (percent) => {
  if (percent >= 80) return '#22c55e'; // Green - Excellent
  if (percent >= 50) return '#eab308'; // Yellow - Average
  return '#ef4444'; // Red - Low
};

export default App;