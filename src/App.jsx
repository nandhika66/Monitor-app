import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Play, Pause, StopCircle, LogOut, RefreshCw, Pin } from 'lucide-react';

const API_BASE = 'http://localhost:3000';

const getActivityColor = (p) =>
  p >= 80 ? '#22c55e' : p >= 50 ? '#eab308' : '#ef4444';

const truncate = (s, n) =>
  s && s.length > n ? s.substring(0, n - 3) + '...' : s;

export default function App() {
  // Auth
  const [isLoggedIn, setIsLoggedIn]     = useState(false);
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [authUser, setAuthUser]         = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError]               = useState('');

  // Projects / Tasks
  const [projects, setProjects]               = useState([]);
  const [allTasks, setAllTasks]               = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedTask, setSelectedTask]       = useState('');
  const [refreshing, setRefreshing]           = useState(false);

  // Tracking
  const [elapsedTime, setElapsedTime]       = useState(0);
  const [isTracking, setIsTracking]         = useState(false);
  const [isPaused, setIsPaused]             = useState(false);
  const [activityStats, setActivityStats]   = useState({ mouse: 0, keyboard: 0 });
  const [activityPercentage, setActivityPercentage] = useState(0);
  const [estHours, setEstHours]             = useState(0);
  const [baseActualTime, setBaseActualTime] = useState(0);

  // UI
  const [alwaysOnTop, setAlwaysOnTop]   = useState(false);
  const [idleBanner, setIdleBanner]     = useState(null); // { idleMinutes }
  const exceededNotifiedRef             = useRef(false);
  const timerRef                        = useRef(null);

  // Derived
  const totalTime = baseActualTime + elapsedTime;
  const exceeded  = totalTime > estHours && estHours > 0;

  // ── BOOT ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    const user  = JSON.parse(localStorage.getItem('authUser') || 'null');
    if (token && user) {
      setIsLoggedIn(true);
      setAuthUser(user);
      fetchProjects();
    }

    const handleActivity = (event, stats) => {
      setActivityStats({ mouse: stats.mouse || 0, keyboard: stats.keyboard || 0 });
      if (stats.activityPercentage !== undefined)
        setActivityPercentage(stats.activityPercentage);
    };

    const handleIdlePause = (event, data) => {
      setIdleBanner({ idleMinutes: data.idleMinutes });
      setIsPaused(true);
    };

    if (window.electronAPI) {
      window.electronAPI.onActivityUpdate(handleActivity);
      window.electronAPI.onIdleAutoPaused(handleIdlePause);
    }

    return () => {
      clearInterval(timerRef.current);
      if (window.electronAPI) {
        window.electronAPI.removeActivityUpdate(handleActivity);
        window.electronAPI.removeIdleAutoPaused(handleIdlePause);
      }
    };
  }, []);

  // ── EXCEEDED NOTIFICATION (fire once per exceeded event) ──────────────────
  useEffect(() => {
    if (exceeded && !exceededNotifiedRef.current && isTracking) {
      exceededNotifiedRef.current = true;
      if (window.electronAPI) {
        const task = allTasks.find(t => t.id === Number(selectedTask));
        window.electronAPI.notifyExceeded({ taskName: task?.name || 'current task' });
      }
    }
    if (!exceeded) exceededNotifiedRef.current = false;
  }, [exceeded]);

  // ── AUTH ──────────────────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError('Please enter email and password'); return; }
    setLoginLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_BASE}/auth/login`, { email, password });
      localStorage.setItem('authToken', res.data.token);
      localStorage.setItem('authUser', JSON.stringify(res.data.user));
      setAuthUser(res.data.user);
      setIsLoggedIn(true);
      fetchProjects();
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Check your credentials.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
    setIsLoggedIn(false);
    setAuthUser(null);
    setProjects([]);
    setAllTasks([]);
    setSelectedProject('');
    setSelectedTask('');
    if (isTracking) stopTracking();
  };

  // ── DATA ──────────────────────────────────────────────────────────────────
  const fetchProjects = async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await axios.get(`${API_BASE}/projects`);
      setProjects(res.data);
    } catch (err) {
      console.error('Failed to fetch projects', err);
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  };

  const fetchTasks = async (projectId, showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await axios.get(`${API_BASE}/tasks?projectId=${projectId}`);
      setAllTasks(res.data);
    } catch (err) {
      console.error('Failed to fetch tasks', err);
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  };

  const handleProjectChange = (e) => {
    const pid = e.target.value;
    setSelectedProject(pid);
    setSelectedTask('');
    setAllTasks([]);
    if (pid) fetchTasks(pid);
  };

  const handleRefresh = async () => {
    await fetchProjects(true);
    if (selectedProject) await fetchTasks(selectedProject, true);
  };

  // ── TRACKING ──────────────────────────────────────────────────────────────
  const startTracking = () => {
    if (!selectedProject || !selectedTask)
      return alert('Please select a project and task');
    const task = allTasks.find(t => t.id === Number(selectedTask));
    if (!task) return;
    setEstHours(task.est_hours * 3600000);
    setBaseActualTime(task.act_hours * 3600000);
    setIsTracking(true);
    setIsPaused(false);
    setIdleBanner(null);
    exceededNotifiedRef.current = false;
    timerRef.current = setInterval(
      () => setElapsedTime(prev => prev + 1000), 1000
    );
    window.electronAPI?.startTracking({
      projectId: Number(selectedProject),
      taskId:    Number(selectedTask),
    });
  };

  const pauseTracking = () => {
    clearInterval(timerRef.current);
    setIsPaused(true);
    setIdleBanner(null);
    window.electronAPI?.pauseTracking();
    saveActualHours(elapsedTime);
  };

  const resumeTracking = () => {
    setIsPaused(false);
    setIdleBanner(null);
    timerRef.current = setInterval(
      () => setElapsedTime(prev => prev + 1000), 1000
    );
    window.electronAPI?.resumeTracking();
  };

  const stopTracking = () => {
    const currentElapsed = elapsedTime;
    clearInterval(timerRef.current);
    setIsTracking(false);
    setIsPaused(false);
    setIdleBanner(null);
    setElapsedTime(0);
    exceededNotifiedRef.current = false;
    window.electronAPI?.stopTracking();
    saveActualHours(currentElapsed);
  };

  const saveActualHours = async (elapsed) => {
    const totalHours = (baseActualTime + elapsed) / 3600000;
    try {
      await axios.patch(`${API_BASE}/tasks/${selectedTask}`, { actHours: totalHours });
    } catch (err) {
      console.error('Failed to save actual hours', err);
    }
  };

  // ── ALWAYS ON TOP ─────────────────────────────────────────────────────────
  const toggleAlwaysOnTop = async () => {
    if (window.electronAPI) {
      const next = await window.electronAPI.toggleAlwaysOnTop();
      setAlwaysOnTop(next);
    }
  };

  // ── FORMAT ────────────────────────────────────────────────────────────────
  const formatTime = (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };

  // ── TASK TREE ─────────────────────────────────────────────────────────────
  const level1Tasks = allTasks.filter(t => t.task_level === 1 && !t.parent_id);

  // ── STYLES ────────────────────────────────────────────────────────────────
  const S = {
    root: {
      width: '480px', height: '450px',
      padding: '12px 16px',
      boxSizing: 'border-box',
      overflowX: 'hidden', overflowY: 'auto',
      fontFamily: 'system-ui, sans-serif',
      backgroundColor: '#ffffff',
    },
    row: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' },
    select: {
      flex: 1, padding: '8px', fontSize: '13px',
      boxSizing: 'border-box', border: '1px solid #ddd', borderRadius: '6px',
    },
    iconBtn: (active) => ({
      padding: '6px 8px', fontSize: '13px', cursor: 'pointer',
      border: `1px solid ${active ? '#3b82f6' : '#ddd'}`,
      borderRadius: '6px',
      background: active ? '#3b82f6' : 'transparent',
      color: active ? 'white' : '#555',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }),
    pinBtn: (active) => ({
      padding: '5px 8px', fontSize: '12px', cursor: 'pointer',
      border: `1px solid ${active ? '#3b82f6' : '#ddd'}`,
      borderRadius: '6px',
      background: active ? '#3b82f6' : 'transparent',
      color: active ? 'white' : '#888',
      display: 'flex', alignItems: 'center', gap: '3px',
    }),
  };

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>

      {/* HEADER */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
        <h2 style={{ fontSize:'16px', fontWeight:700, margin:0 }}>Monitor App</h2>
        <button
          onClick={toggleAlwaysOnTop}
          title={alwaysOnTop ? 'Disable always on top' : 'Keep window on top'}
          style={S.pinBtn(alwaysOnTop)}
        >
          <Pin size={12} />
          {alwaysOnTop ? 'Pinned' : 'Pin'}
        </button>
      </div>

      {!isLoggedIn ? (
        /* ── LOGIN ── */
        <form onSubmit={handleLogin} style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
          <input
            type="email" placeholder="Email"
            value={email} onChange={e => setEmail(e.target.value)}
            style={{ width:'100%', padding:'9px', fontSize:'13px', boxSizing:'border-box', border:'1px solid #ddd', borderRadius:'6px' }}
          />
          <input
            type="password" placeholder="Password"
            value={password} onChange={e => setPassword(e.target.value)}
            style={{ width:'100%', padding:'9px', fontSize:'13px', boxSizing:'border-box', border:'1px solid #ddd', borderRadius:'6px' }}
          />
          {error && <p style={{ color:'#ef4444', fontSize:'12px', margin:0 }}>{error}</p>}
          <button
            type="submit" disabled={loginLoading}
            style={{
              width:'100%', padding:'9px', fontSize:'13px',
              background: loginLoading ? '#93c5fd' : '#3b82f6',
              color:'white', border:'none', borderRadius:'6px', cursor:'pointer',
            }}
          >
            {loginLoading ? 'Signing in…' : 'Sign In'}
          </button>
          <p style={{ fontSize:'11px', color:'#888', textAlign:'center', margin:0 }}>
            Register an account at{' '}
            <span style={{ color:'#3b82f6' }}>localhost:3000/dashboard/login.html</span>
          </p>
        </form>
      ) : (
        <>
          {/* ── USER BAR ── */}
          <div style={{ ...S.row, justifyContent:'space-between', marginBottom:'12px' }}>
            <span style={{ fontSize:'12px', color:'#555' }}>
              👤 {authUser?.name || 'User'}
            </span>
            <button
              onClick={handleLogout}
              style={{
                display:'flex', alignItems:'center', gap:'4px',
                fontSize:'11px', padding:'5px 10px',
                background:'#ef4444', color:'white',
                border:'none', borderRadius:'4px', cursor:'pointer',
              }}
            >
              <LogOut size={11} /> Logout
            </button>
          </div>

          {/* ── IDLE BANNER ── */}
          {idleBanner && (
            <div style={{
              background:'#fef3c7', border:'1px solid #fcd34d',
              borderRadius:'8px', padding:'10px 12px',
              marginBottom:'10px', fontSize:'12px',
            }}>
              <div style={{ fontWeight:600, color:'#92400e', marginBottom:'6px' }}>
                ⏸ Paused — idle for {idleBanner.idleMinutes} min
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button
                  onClick={resumeTracking}
                  style={{
                    flex:1, padding:'5px', fontSize:'12px',
                    background:'#3b82f6', color:'white',
                    border:'none', borderRadius:'5px', cursor:'pointer',
                  }}
                >
                  ▶ Resume
                </button>
                <button
                  onClick={stopTracking}
                  style={{
                    flex:1, padding:'5px', fontSize:'12px',
                    background:'white', color:'#ef4444',
                    border:'1px solid #ef4444', borderRadius:'5px', cursor:'pointer',
                  }}
                >
                  ■ Stop
                </button>
              </div>
            </div>
          )}

          {/* ── PROJECT SELECT ── */}
          <div style={S.row}>
            <select
              value={selectedProject}
              onChange={handleProjectChange}
              disabled={isTracking}
              style={S.select}
            >
              <option value="">Select Project</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={handleRefresh}
              disabled={refreshing || isTracking}
              title="Refresh projects & tasks"
              style={S.iconBtn(false)}
            >
              <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            </button>
          </div>

          {/* ── TASK SELECT ── */}
          <div style={{ marginBottom:'12px' }}>
            <select
              value={selectedTask}
              onChange={e => setSelectedTask(e.target.value)}
              disabled={!selectedProject || isTracking}
              style={{ ...S.select, width:'100%', flex:'unset' }}
            >
              <option value="">Select Task / Subtask</option>
              {level1Tasks.map(l1 => {
                const l2 = allTasks.filter(t => t.parent_id === l1.id);
                return (
                  <optgroup key={l1.id} label={truncate(l1.name, 40)}>
                    <option value={l1.id} title={l1.name}>
                      {truncate(l1.name, 35)} ({l1.est_hours}h est)
                    </option>
                    {l2.map(t2 => {
                      const l3 = allTasks.filter(t => t.parent_id === t2.id);
                      return (
                        <React.Fragment key={t2.id}>
                          <option value={t2.id} title={t2.name}>
                            → {truncate(t2.name, 33)} ({t2.est_hours}h est)
                          </option>
                          {l3.map(t3 => (
                            <option key={t3.id} value={t3.id} title={t3.name}>
                              →→ {truncate(t3.name, 31)} ({t3.est_hours}h est)
                            </option>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </optgroup>
                );
              })}
            </select>
          </div>

          {/* ── TIMER ── */}
          {isTracking && (
            <div style={{ textAlign:'center', marginBottom:'10px' }}>
              {/* Total cumulative time */}
              <div style={{ fontSize:'26px', fontWeight:'bold', letterSpacing:'1px' }}>
                {formatTime(totalTime)}
              </div>
              <div style={{ fontSize:'11px', color:'#888', marginTop:'2px' }}>
                total &nbsp;·&nbsp; session: {formatTime(elapsedTime)}
              </div>
              {exceeded && (
                <div style={{ color:'#ef4444', fontSize:'12px', fontWeight:600, marginTop:'3px' }}>
                  ⚠ Exceeded estimate!
                </div>
              )}
            </div>
          )}

          {/* ── CONTROLS ── */}
          {!idleBanner && (
            <div style={{ display:'flex', justifyContent:'center', gap:'8px', marginBottom:'12px' }}>
              {!isTracking ? (
                <button
                  onClick={startTracking}
                  style={{
                    padding:'9px 24px', fontSize:'13px', minWidth:'100px',
                    background:'#3b82f6', color:'white', border:'none',
                    borderRadius:'6px', cursor:'pointer',
                    display:'flex', alignItems:'center', gap:'5px',
                  }}
                >
                  <Play size={13} /> Start
                </button>
              ) : (
                <>
                  {isPaused ? (
                    <button
                      onClick={resumeTracking}
                      style={{
                        padding:'9px 20px', fontSize:'13px', minWidth:'90px',
                        background:'#22c55e', color:'white', border:'none',
                        borderRadius:'6px', cursor:'pointer',
                        display:'flex', alignItems:'center', gap:'5px',
                      }}
                    >
                      <Play size={13} /> Resume
                    </button>
                  ) : (
                    <button
                      onClick={pauseTracking}
                      style={{
                        padding:'9px 20px', fontSize:'13px', minWidth:'90px',
                        background:'#f59e0b', color:'white', border:'none',
                        borderRadius:'6px', cursor:'pointer',
                        display:'flex', alignItems:'center', gap:'5px',
                      }}
                    >
                      <Pause size={13} /> Pause
                    </button>
                  )}
                  <button
                    onClick={stopTracking}
                    style={{
                      padding:'9px 20px', fontSize:'13px', minWidth:'90px',
                      background:'#ef4444', color:'white', border:'none',
                      borderRadius:'6px', cursor:'pointer',
                      display:'flex', alignItems:'center', gap:'5px',
                    }}
                  >
                    <StopCircle size={13} /> Stop
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── ACTIVITY STATS ── */}
          <div style={{
            fontSize:'12px', textAlign:'center', color:'#555',
            padding:'8px', backgroundColor:'#f8f9fa',
            borderRadius:'8px', border:'1px solid #e0e0e0',
          }}>
            <div style={{ marginBottom:'3px' }}>
              <strong>Mouse:</strong> {activityStats.mouse} &nbsp;|&nbsp;
              <strong>Keyboard:</strong> {activityStats.keyboard}
            </div>
            <div>
              Activity this block:{' '}
              <span style={{ color: getActivityColor(activityPercentage), fontWeight:600 }}>
                {activityPercentage}%
              </span>
            </div>
          </div>

          {/* spin keyframe */}
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </>
      )}
    </div>
  );
}