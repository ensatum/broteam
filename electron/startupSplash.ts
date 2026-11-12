import { BrowserWindow } from 'electron';

const PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; height: 100%; background: #e5e7eb; color: #1e293b;
    font: 13px/1.35 "Segoe UI", system-ui, sans-serif; }
  body { box-sizing: border-box; padding: 22px 24px; }
  h1 { margin: 0 0 14px; font-size: 15px; font-weight: 650; }
  .now { font-weight: 650; }
  .time { color: #475569; font-variant-numeric: tabular-nums; }
  ul { margin: 12px 0 0; padding: 0; list-style: none; }
  li { margin: 0 0 4px; color: #475569; }
</style>
</head>
<body>
  <h1>BroTeam</h1>
  <div class="now" id="now"></div>
  <ul id="done"></ul>
  <script>
    const done = [];
    let current = 'Открываем окно состояния';
    let since = Date.now();
    function fmt(ms) {
      const s = ms / 1000;
      if (s < 60) return s.toFixed(1) + ' с';
      const m = Math.floor(s / 60);
      return m + ' мин ' + Math.round(s - m * 60) + ' с';
    }
    function render() {
      document.getElementById('now').textContent = current + ' — ' + fmt(Date.now() - since);
      document.getElementById('done').innerHTML = done
        .map((row) => '<li>' + row.label + ' — ' + fmt(row.ms) + '</li>')
        .join('');
    }
    window.bootStep = (label) => {
      done.push({ label: current, ms: Date.now() - since });
      current = label;
      since = Date.now();
      render();
    };
    render();
    setInterval(render, 100);
  </script>
</body>
</html>`;

export type StartupSplash = {
  step: (label: string) => void;
  close: () => void;
};

export function openStartupSplash(): StartupSplash {
  const win = new BrowserWindow({
    width: 440,
    height: 280,
    frame: false,
    resizable: false,
    center: true,
    show: true,
    backgroundColor: '#e5e7eb',
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const queued: string[] = [];
  let loaded = false;
  const push = (label: string) => {
    if (win.isDestroyed()) return;
    void win.webContents.executeJavaScript(`window.bootStep(${JSON.stringify(label)})`);
  };
  win.webContents.on('did-finish-load', () => {
    loaded = true;
    for (const label of queued) push(label);
    queued.length = 0;
  });
  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
  return {
    step(label: string) {
      if (!loaded) queued.push(label);
      else push(label);
    },
    close() {
      if (!win.isDestroyed()) win.close();
    },
  };
}
