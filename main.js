const {
  app, BrowserWindow, ipcMain, desktopCapturer,
  Tray, Menu, nativeImage, Notification
} = require('electron');
const path  = require('path');
const zlib  = require('zlib');
const { uIOhook } = require('uiohook-napi');
const activeWin    = require('active-win');
const axios        = require('axios');

// ─── STATE ────────────────────────────────────────────────────────────────────
let win               = null;
let tray              = null;
let tracking          = false;
let paused            = false;
let context           = { projectId: null, taskId: null };
let currentBlock      = { minutes: [], screenshot: null };
let minuteIndex       = 0;
let blockInterval     = null;
let idleCheckInterval = null;
let idleAutoPaused    = false;
let lastActivityTime  = Date.now();
let mouseCount        = 0;
let keyboardCount     = 0;
let currentMinuteCount = { mouse: 0, keyboard: 0 };

const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ─── TRAY ICON GENERATOR (16×16 solid #3b82f6 PNG) ───────────────────────────
function buildTrayIconBase64() {
  function crc32(buf) {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    let crc = 0xFFFFFFFF;
    for (const b of buf) crc = t[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const tb  = Buffer.from(type);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const cd  = Buffer.concat([tb, data]);
    const cb  = Buffer.alloc(4); cb.writeUInt32BE(crc32(cd));
    return Buffer.concat([len, tb, data, cb]);
  }

  const W = 16, H = 16, R = 59, G = 130, B = 246;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;

  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const o = y * (1 + W * 3);
    raw[o] = 0;
    for (let x = 0; x < W; x++) {
      raw[o + 1 + x*3] = R; raw[o + 2 + x*3] = G; raw[o + 3 + x*3] = B;
    }
  }

  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

// ─── WINDOW ───────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 450,         // slightly taller for idle banner
    resizable: false,
    minimizable: true,
    maximizable: false,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL('http://localhost:5173');

  // Hide to tray on close instead of quitting
  win.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
      if (Notification.isSupported()) {
        new Notification({
          title: 'Monitor App',
          body: 'Minimized to tray — tracking continues in the background.',
        }).show();
      }
    }
  });
}

// ─── TRAY ─────────────────────────────────────────────────────────────────────
function setupTray() {
  const icon = nativeImage.createFromDataURL(
    `data:image/png;base64,${buildTrayIconBase64()}`
  );
  tray = new Tray(icon);
  tray.setToolTip('Monitor App');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show Monitor App',
      click: () => { win.show(); win.focus(); },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.isQuitting = true; app.quit(); },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (win.isVisible()) { win.hide(); } else { win.show(); win.focus(); }
  });
}

// ─── APP READY ────────────────────────────────────────────────────────────────
app.isQuitting = false;

app.whenReady().then(() => {
  createWindow();
  setupTray();

  uIOhook.start();

  // Keyboard — counts for activity + resets idle timer
  uIOhook.on('keydown', () => {
    lastActivityTime = Date.now();
    if (tracking && !paused) {
      keyboardCount++;
      currentMinuteCount.keyboard++;
      sendLiveStats();
    }
  });

  // Click — counts for activity + resets idle timer
  uIOhook.on('click', () => {
    lastActivityTime = Date.now();
    if (tracking && !paused) {
      mouseCount++;
      currentMinuteCount.mouse++;
      sendLiveStats();
    }
  });

  // Move — ONLY resets idle timer, never inflates activity score
  uIOhook.on('mousemove', () => {
    lastActivityTime = Date.now();
  });

  // Idle detection — check every 30 seconds
  idleCheckInterval = setInterval(() => {
    if (!tracking || paused) return;
    const idle = Date.now() - lastActivityTime;
    if (idle >= IDLE_THRESHOLD_MS) {
      paused        = true;
      idleAutoPaused = true;
      if (blockInterval) { clearInterval(blockInterval); blockInterval = null; }
      if (win) {
        win.webContents.send('idleAutoPaused', {
          idleMinutes: Math.floor(idle / 60000),
        });
      }
      if (Notification.isSupported()) {
        new Notification({
          title: 'Tracking Paused',
          body: `No activity for ${Math.floor(idle / 60000)} min. Open the app to resume.`,
        }).show();
      }
    }
  }, 30000);
});

// ─── APP EVENTS ───────────────────────────────────────────────────────────────
app.on('window-all-closed', () => {
  // Do not quit — we live in the tray
});

app.on('before-quit', () => {
  app.isQuitting = true;
  uIOhook.stop();
  if (blockInterval)     clearInterval(blockInterval);
  if (idleCheckInterval) clearInterval(idleCheckInterval);
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function sendLiveStats() {
  if (win && win.webContents) {
    win.webContents.send('activityUpdate', {
      mouse:    mouseCount,
      keyboard: keyboardCount,
    });
  }
}

// ─── BLOCK MANAGEMENT ─────────────────────────────────────────────────────────
function startNewBlock() {
  currentBlock       = { minutes: [], screenshot: null };
  currentMinuteCount = { mouse: 0, keyboard: 0 };
  minuteIndex        = 0;
  runBlockInterval();
}

function resumeBlock() {
  currentMinuteCount = { mouse: 0, keyboard: 0 };
  runBlockInterval();
}

function runBlockInterval() {
  if (blockInterval) { clearInterval(blockInterval); blockInterval = null; }

  blockInterval = setInterval(async () => {
    if (paused || !tracking) {
      clearInterval(blockInterval); blockInterval = null;
      return;
    }
    try {
      const active   = await activeWin();
      const isActive = !!active;

      currentBlock.minutes[minuteIndex] = {
        keyboard: currentMinuteCount.keyboard,
        mouse:    currentMinuteCount.mouse,
        active:   isActive,
        app:      active?.title || null,
      };
      currentMinuteCount = { mouse: 0, keyboard: 0 };

      if (minuteIndex === Math.floor(Math.random() * 10)) {
        try {
          const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1920, height: 1080 },
          });
          if (sources.length > 0) {
            const src = sources.find(s => s.thumbnail && !s.thumbnail.isEmpty()) || sources[0];
            if (src?.thumbnail && !src.thumbnail.isEmpty()) {
              currentBlock.screenshot =
                `data:image/png;base64,${src.thumbnail.toPNG().toString('base64')}`;
            }
          }
        } catch (e) { console.error('Screenshot failed:', e.message); }
      }

      minuteIndex++;
      if (minuteIndex >= 10) {
        clearInterval(blockInterval); blockInterval = null;
        finalizeAndSendBlock();
        if (tracking && !paused) startNewBlock();
      }
    } catch (e) { console.error('Interval error:', e); }
  }, 60000);
}

function finalizeAndSendBlock() {
  if (currentBlock.minutes.length === 0) return;

  const activeMinutes = currentBlock.minutes.filter(m => m.active).length;
  let totalInput = 0;
  currentBlock.minutes.forEach(m => { totalInput += (m.mouse||0) + (m.keyboard||0); });
  const activityPercentage = Math.min(100, Math.round((totalInput / 1000) * 100));

  const logEntry = {
    projectId:           context.projectId,
    taskId:              context.taskId,
    timestamp:           new Date().toISOString().slice(0,19).replace('T',' '),
    screenshot:          currentBlock.screenshot,
    activity_json:       JSON.stringify({ minutes: currentBlock.minutes }),
    active_minutes:      activeMinutes,
    activity_percentage: activityPercentage,
  };

  axios.post('http://localhost:3000/activity', logEntry)
    .then(() => console.log(`Block saved. Activity: ${activityPercentage}%`))
    .catch(e  => console.log('Offline:', e.message));

  if (win) {
    win.webContents.send('activityUpdate', {
      mouse:               mouseCount,
      keyboard:            keyboardCount,
      activityPercentage,
    });
  }
}

// ─── IPC HANDLERS ─────────────────────────────────────────────────────────────
ipcMain.handle('startTracking', (event, ctx) => {
  context        = ctx;
  tracking       = true;
  paused         = false;
  idleAutoPaused = false;
  mouseCount     = 0;
  keyboardCount  = 0;
  lastActivityTime = Date.now();
  sendLiveStats();
  startNewBlock();
});

ipcMain.handle('pauseTracking', () => {
  paused         = true;
  idleAutoPaused = false;
});

ipcMain.handle('resumeTracking', () => {
  paused           = false;
  idleAutoPaused   = false;
  lastActivityTime = Date.now();
  resumeBlock();
});

ipcMain.handle('stopTracking', () => {
  tracking       = false;
  paused         = false;
  idleAutoPaused = false;
  if (blockInterval) { clearInterval(blockInterval); blockInterval = null; }
  if (currentBlock.minutes.length > 0 || currentBlock.screenshot) {
    finalizeAndSendBlock();
  }
  mouseCount    = 0;
  keyboardCount = 0;
  sendLiveStats();
});

ipcMain.handle('toggleAlwaysOnTop', () => {
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next);
  return next;
});

ipcMain.handle('notifyExceeded', (event, { taskName }) => {
  if (Notification.isSupported()) {
    new Notification({
      title: '⏰ Estimate Exceeded',
      body:  `You've passed the time estimate for "${taskName}".`,
    }).show();
  }
});