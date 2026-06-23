const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const { dialog } = require('electron');
const JSZip = require('jszip');
const crypto = require('crypto');
const fsp = fs.promises;

const USER_DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
let CACHE_DIR = path.join(USER_DATA, 'video_cache');

// Load settings synchronously at startup so CACHE_DIR can be overridden
try{
  if(fs.existsSync(SETTINGS_FILE)){
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if(s && s.cacheDir) CACHE_DIR = s.cacheDir;
  }
}catch(e){ console.error('failed to read settings', e); }
const INDEX_FILE = path.join(USER_DATA, 'index.json');

async function ensureCache(){
  try{ await fsp.mkdir(CACHE_DIR, { recursive: true }); }catch(e){}
}

async function readIndex(){
  try{ const raw = await fsp.readFile(INDEX_FILE, 'utf8'); return JSON.parse(raw); }catch(e){ return { items: [], libraryPath: null }; }
}

async function readSettings(){
  try{ const raw = await fsp.readFile(SETTINGS_FILE, 'utf8'); return JSON.parse(raw); }catch(e){ return {}; }
}

async function writeSettings(s){
  try{ await fsp.writeFile(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf8'); }catch(e){ console.error('failed to write settings', e); }
}

async function writeIndex(idx){
  await ensureCache();
  await fsp.writeFile(INDEX_FILE, JSON.stringify(idx, null, 2), 'utf8');
}

async function recursiveScan(dir){
  const results = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for(const ent of entries){
    const full = path.join(dir, ent.name);
    if(ent.isDirectory()){
      const sub = await recursiveScan(full);
      results.push(...sub);
    }else if(ent.isFile() && full.toLowerCase().endsWith('.zip')){
      results.push(full);
    }
  }
  return results;
}

function uniqueName(zipName, entryName){
  const h = crypto.createHash('sha1').update(zipName + '::' + entryName).digest('hex');
  const ext = path.extname(entryName) || '.mp4';
  return `${h}${ext}`;
}

function createWindow(){
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    icon: path.join(__dirname, 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(()=>{
  createWindow();
  app.on('activate', ()=>{ if(BrowserWindow.getAllWindows().length===0) createWindow(); });
});

app.on('window-all-closed', ()=>{ if(process.platform !== 'darwin') app.quit(); });

ipcMain.handle('open-in-vlc', async (event, { filename, buffer }) => {
  try{
    const tmpDir = os.tmpdir();
    const safeName = (filename || 'video').replace(/[^a-zA-Z0-9._-]/g, '_');
    const tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);
    fs.writeFileSync(tmpPath, Buffer.from(buffer));

    const vlcPath = findVlc();
    const args = ['--play-and-exit', tmpPath];
    const child = spawn(vlcPath, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { success: true, path: tmpPath, vlc: vlcPath };
  }catch(err){
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('open-file-in-vlc', async (event, { filePath }) => {
  try{
    const vlcPath = findVlc();
    const args = ['--play-and-exit', filePath];
    const child = spawn(vlcPath, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { success: true, vlc: vlcPath };
  }catch(err){
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('load-zips-from-folder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if(res.canceled || !res.filePaths || !res.filePaths[0]) return { success: false, error: 'no-folder' };
  const folder = res.filePaths[0];
  const zipPaths = await recursiveScan(folder);
  await ensureCache();
  // Build an index of zip entries but do NOT extract all videos into the cache.
  // Extraction will happen on-demand when the user plays a specific entry.
  const oldIdx = await readIndex();
  const oldMap = new Map((oldIdx.items||[]).map(it => [(it.zipName+'::'+it.entryName), it]));
  const items = [];
  for(const zipPath of zipPaths){
    const f = path.basename(zipPath);
    try{
      const buf = await fsp.readFile(zipPath);
      const zip = await JSZip.loadAsync(buf);
      for(const name of Object.keys(zip.files)){
        const entry = zip.files[name];
        if(entry.dir) continue;
        if(/\.(mp4|webm|ogg)$/i.test(name)){
          const key = f + '::' + name;
          const old = oldMap.get(key) || {};
          items.push({
            zipName: f,
            entryName: name,
            zipPath: zipPath,
            cachedPath: old.cachedPath || null,
            topic: old.topic || '',
            voice: old.voice || '',
            position: old.position || 0,
            completed: !!old.completed
          });
        }
      }
    }catch(err){ console.error('zip load error', f, err); }
  }
  const idx = { items, libraryPath: folder };
  await writeIndex(idx);
  return { success: true, items, libraryPath: folder };
});

ipcMain.handle('load-index', async ()=>{
  const idx = await readIndex();
  const items = [];
  for(const it of (idx.items||[])){
    try{
      // keep items that already have a cachedPath, or keep entries that reference a zipPath
      if(it.cachedPath && fs.existsSync(it.cachedPath)) items.push(it);
      else if(it.zipPath) items.push(it);
    }catch(e){}
  }
  idx.items = items;
  return { success: true, items, libraryPath: idx.libraryPath || null };
});

// Extract a single zip entry on-demand and return its cached path.
ipcMain.handle('extract-entry', async (event, { zipPath, entryName }) => {
  try{
    if(!zipPath || !entryName) return { success: false, error: 'missing-args' };
    await ensureCache();
    const f = path.basename(zipPath);
    const buf = await fsp.readFile(zipPath);
    const zip = await JSZip.loadAsync(buf);
    const entry = zip.files[entryName];
    if(!entry) return { success: false, error: 'entry-not-found' };
    const fileBuf = await entry.async('nodebuffer');
    const cached = uniqueName(f, entryName);
    const cachedPath = path.join(CACHE_DIR, cached);
    if(!fs.existsSync(cachedPath)){
      await fsp.writeFile(cachedPath, fileBuf);
    }
    // update index to record cachedPath for this item
    try{
      const idx = await readIndex();
      for(const it of (idx.items||[])){
        if(it.zipName === f && it.entryName === entryName){ it.cachedPath = cachedPath; break; }
      }
      await writeIndex(idx);
    }catch(e){ console.error('failed to update index with cachedPath', e); }
    return { success: true, cachedPath };
  }catch(err){ return { success: false, error: String(err) }; }
});

// Return current cache info
ipcMain.handle('get-cache-info', async ()=>{
  try{
    const settings = await readSettings();
    return { success: true, cacheDir: CACHE_DIR, settings };
  }catch(e){ return { success: false, error: String(e) }; }
});

ipcMain.handle('choose-cache-dir', async ()=>{
  try{
    const res = await dialog.showOpenDialog({ properties: ['openDirectory','createDirectory'] });
    if(res.canceled || !res.filePaths || !res.filePaths[0]) return { success: false, error: 'no-folder' };
    return { success: true, path: res.filePaths[0] };
  }catch(err){ return { success: false, error: String(err) }; }
});

// Set a new cache directory and optionally migrate existing cached files.
// params: { newDir: string, migrate: boolean }
ipcMain.handle('set-cache-dir', async (event, { newDir, migrate }) => {
  try{
    if(!newDir) return { success: false, error: 'missing-newDir' };
    // ensure path exists
    await fsp.mkdir(newDir, { recursive: true });
    const oldDir = CACHE_DIR;
    if(migrate && fs.existsSync(oldDir)){
      const files = await fsp.readdir(oldDir);
      for(const f of files){
        const oldPath = path.join(oldDir, f);
        const stat = await fsp.stat(oldPath).catch(()=>null);
        if(!stat || !stat.isFile()) continue;
        const newPath = path.join(newDir, path.basename(f));
        try{ await fsp.rename(oldPath, newPath); }catch(e){
          // fallback to copy
          await fsp.copyFile(oldPath, newPath);
        }
      }
    }
    // update index entries to point to new cached paths
    try{
      const idx = await readIndex();
      for(const it of (idx.items||[])){
        if(it.cachedPath && it.cachedPath.startsWith(oldDir)){
          it.cachedPath = path.join(newDir, path.basename(it.cachedPath));
        }
      }
      await writeIndex(idx);
    }catch(e){ console.error('failed to update index paths', e); }

    // update CACHE_DIR and settings
    CACHE_DIR = newDir;
    const settings = await readSettings();
    settings.cacheDir = newDir;
    await writeSettings(settings);
    return { success: true, cacheDir: CACHE_DIR };
  }catch(err){ return { success: false, error: String(err) }; }
});

ipcMain.handle('persist-progress', async (event, { updates })=>{
  try{
    const idx = await readIndex();
    const map = new Map();
    (idx.items||[]).forEach(it=>{ map.set(it.cachedPath || (it.zipName+'::'+it.entryName), it); });
    for(const up of updates){
      const key = up.cachedPath || up.id || (up.zipName+'::'+up.entryName);
      const existing = map.get(key);
      if(existing){
        const meta = up.meta || {};
        existing.position = meta.position !== undefined ? meta.position : existing.position;
        existing.completed = meta.completed !== undefined ? meta.completed : existing.completed;
        existing.topic = meta.topic !== undefined ? meta.topic : existing.topic;
        existing.voice = meta.voice !== undefined ? meta.voice : existing.voice;
      }
    }
    idx.items = Array.from(map.values());
    await writeIndex(idx);
    return { success: true };
  }catch(err){ return { success: false, error: String(err) }; }
});

function findVlc(){
  if(process.env.VLC_PATH) return process.env.VLC_PATH;
  const platform = process.platform;
  if(platform === 'win32'){
    const candidates = [
      'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
      'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'
    ];
    for(const p of candidates) if(fs.existsSync(p)) return p;
    return 'vlc';
  }
  if(platform === 'darwin'){
    const macPath = '/Applications/VLC.app/Contents/MacOS/VLC';
    if(fs.existsSync(macPath)) return macPath;
    return 'vlc';
  }
  // linux / others
  return 'vlc';
}
