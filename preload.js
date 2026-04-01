const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Tracking
  startTracking:        (ctx) => ipcRenderer.invoke('startTracking', ctx),
  pauseTracking:        ()    => ipcRenderer.invoke('pauseTracking'),
  resumeTracking:       ()    => ipcRenderer.invoke('resumeTracking'),
  stopTracking:         ()    => ipcRenderer.invoke('stopTracking'),

  // Activity updates
  onActivityUpdate:     (cb)  => ipcRenderer.on('activityUpdate', cb),
  removeActivityUpdate: (cb)  => ipcRenderer.removeListener('activityUpdate', cb),

  // Idle
  onIdleAutoPaused:     (cb)  => ipcRenderer.on('idleAutoPaused', cb),
  removeIdleAutoPaused: (cb)  => ipcRenderer.removeListener('idleAutoPaused', cb),

  // Window
  toggleAlwaysOnTop:    ()          => ipcRenderer.invoke('toggleAlwaysOnTop'),
  notifyExceeded:       (data)      => ipcRenderer.invoke('notifyExceeded', data),
});