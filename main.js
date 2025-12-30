const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const { uIOhook } = require('uiohook-napi');
const activeWin = require('active-win');
const axios = require('axios');

let win;
let tracking = false;
let paused = false;
let context = { projectId: null, taskId: null };
let currentBlock = { minutes: [], screenshot: null };
let mouseCount = 0;
let keyboardCount = 0;
let currentMinuteCount = { mouse: 0, keyboard: 0 };

function createWindow() {
win = new BrowserWindow({
  width: 480,
  height: 420,
  resizable: false,
  minimizable: true,
  maximizable: false,
  useContentSize: true, // ← Add this: uses exact content size without extra chrome
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false
  }
});

  win.loadURL('http://localhost:5173');

  // Optional: open dev tools for debugging
  // win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  createWindow();

  uIOhook.start();

  uIOhook.on('keydown', () => {
    if (tracking && !paused) {
      keyboardCount++;
      currentMinuteCount.keyboard++;
      sendLiveStats();
    }
  });

  uIOhook.on('click', () => {
    if (tracking && !paused) {
      mouseCount++;
      currentMinuteCount.mouse++;
      sendLiveStats();
    }
  });

  uIOhook.on('mousemove', () => {
    if (tracking && !paused) {
      mouseCount++;
      currentMinuteCount.mouse++;
      sendLiveStats();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  uIOhook.stop();
});

function sendLiveStats() {
  if (win && win.webContents) {
    win.webContents.send('activityUpdate', { mouse: mouseCount, keyboard: keyboardCount });
  }
}

function startNewBlock() {
  currentBlock = { minutes: [], screenshot: null };
  currentMinuteCount = { mouse: 0, keyboard: 0 };
  let minuteIndex = 0;

  const interval = setInterval(async () => {
    if (paused || !tracking) {
      clearInterval(interval);
      return;
    }

    try {
      const active = await activeWin();
      const isActive = !!active;

      currentBlock.minutes[minuteIndex] = {
        keyboard: currentMinuteCount.keyboard,
        mouse: currentMinuteCount.mouse,
        active: isActive,
        app: active?.title || null
      };

      currentMinuteCount = { mouse: 0, keyboard: 0 };

      // Random screenshot in the 10-minute block
      if (minuteIndex === Math.floor(Math.random() * 10)) {
        try {
          const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1920, height: 1080 }
          });

          console.log('Available screen sources:', sources.length);

          if (sources.length > 0) {
            const source = sources.find(s => s.thumbnail && !s.thumbnail.isEmpty()) || sources[0];

            if (source && source.thumbnail && !source.thumbnail.isEmpty()) {
              currentBlock.screenshot = `data:image/png;base64,${source.thumbnail.toPNG().toString('base64')}`;
              console.log('Screenshot captured successfully! Length:', currentBlock.screenshot.length);
            } else {
              console.log('No valid thumbnail found in sources');
            }
          } else {
            console.log('No screen sources available');
          }
        } catch (err) {
          console.error('Screenshot capture failed:', err.message);
        }
      }

      minuteIndex++;

      if (minuteIndex >= 10) {
        clearInterval(interval);
        finalizeAndSendBlock();
        if (tracking && !paused) startNewBlock();
      }
    } catch (err) {
      console.error('Interval error:', err);
    }
  }, 60000);
}

function finalizeAndSendBlock() {
  if (currentBlock.minutes.length === 0) return;

  const activeMinutes = currentBlock.minutes.filter(m => m.active).length;

  // Calculate total input (mouse + keyboard) across all 10 minutes
  let totalInput = 0;
  currentBlock.minutes.forEach(minute => {
    totalInput += (minute.mouse || 0) + (minute.keyboard || 0);
  });

  // Simple activity percentage: 
  // - Max expected input per 10 min = 1000 (arbitrary threshold, adjust as needed)
  // - % = (totalInput / max) * 100, capped at 100
  const maxExpectedInput = 1000; // Tune this based on real usage (e.g., very active user might do 800–1200)
  const activityPercentage = Math.min(100, Math.round((totalInput / maxExpectedInput) * 100));

  const logEntry = {
    projectId: context.projectId,
    taskId: context.taskId,
    timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
    screenshot: currentBlock.screenshot,
    activity_json: JSON.stringify({ minutes: currentBlock.minutes }),
    active_minutes: activeMinutes,
    activity_percentage: activityPercentage  // New field
  };

  // Send to backend
  axios.post('http://localhost:3000/activity', logEntry)
    .then(() => {
      console.log('Block sent to backend');
      console.log(`Activity Percentage for this block: ${activityPercentage}%`);
    })
    .catch(err => {
      console.log('Offline - data will sync later:', err.message);
    });

  // Send live update to UI (including new %)
  if (win) {
    win.webContents.send('activityUpdate', {
      mouse: mouseCount,
      keyboard: keyboardCount,
      activityPercentage: activityPercentage
    });
  }
}

// IPC Handlers
ipcMain.handle('startTracking', (event, ctx) => {
  context = ctx;
  tracking = true;
  paused = false;
  mouseCount = 0;
  keyboardCount = 0;
  sendLiveStats();
  startNewBlock();
});

ipcMain.handle('pauseTracking', () => {
  paused = true;
});

ipcMain.handle('resumeTracking', () => {
  paused = false;
  startNewBlock();
});

ipcMain.handle('stopTracking', () => {
  tracking = false;
  paused = false;
  
  // Always try to send the current (partial) block if something was captured
  if (currentBlock.minutes.length > 0 || currentBlock.screenshot) {
    finalizeAndSendBlock();
  }
  
  mouseCount = 0;
  keyboardCount = 0;
  sendLiveStats();
});