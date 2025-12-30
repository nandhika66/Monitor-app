const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startTracking: (context) => ipcRenderer.invoke('startTracking', context),
  pauseTracking: () => ipcRenderer.invoke('pauseTracking'),
  resumeTracking: () => ipcRenderer.invoke('resumeTracking'),
  stopTracking: () => ipcRenderer.invoke('stopTracking'),
  onActivityUpdate: (callback) => ipcRenderer.on('activityUpdate', (event, data) => callback(event, data))
});