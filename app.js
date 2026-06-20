const zipInput = document.getElementById('zipInput');
const playlistEl = document.getElementById('playlist');
const videoPlayer = document.getElementById('videoPlayer');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const markDone = document.getElementById('markDone');
const topicInput = document.getElementById('topicInput');
const voiceInput = document.getElementById('voiceInput');
const progressSummary = document.getElementById('progressSummary');
const clearStorage = document.getElementById('clearStorage');
const openVlcBtn = document.getElementById('openVlcBtn');
const loadFolderBtn = document.getElementById('loadFolderBtn');
const statusText = document.getElementById('statusText');

let playlist = [];
let currentIndex = -1;

const STORAGE_KEY = 'vsp_state_v1';

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return {};
    return JSON.parse(raw);
  }catch(e){return {}};
}

function saveState(state){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const state = loadState();

function isVideoName(name){
  return /\.(mp4|webm|ogg)$/i.test(name);
}

function makeFileUrl(filePath){
  if(!filePath) return '';
  let pathName = filePath.replace(/\\/g, '/');
  if(!pathName.startsWith('/')) pathName = '/' + pathName;
  return encodeURI('file://' + pathName);
}

function naturalCompare(a, b){
  const ax = [], bx = [];
  a.replace(/(\d+)|(\D+)/g, (_, $1, $2) => { ax.push([$1 ? parseInt($1,10) : Infinity, $2 || '']); });
  b.replace(/(\d+)|(\D+)/g, (_, $1, $2) => { bx.push([$1 ? parseInt($1,10) : Infinity, $2 || '']); });
  while(ax.length && bx.length){
    const [an, as] = ax.shift();
    const [bn, bs] = bx.shift();
    if(an !== bn) return an - bn;
    const cmp = as.localeCompare(bs, undefined, { sensitivity: 'base' });
    if(cmp !== 0) return cmp;
  }
  return ax.length - bx.length;
}

function sortPlaylist(){
  playlist.sort((a,b)=> naturalCompare(`${a.zipName}/${a.title}`, `${b.zipName}/${b.title}`));
}

async function handleZipFile(file){
  const jszip = new JSZip();
  const zip = await jszip.loadAsync(file);
  const entries = Object.values(zip.files);
  for(const entry of entries){
    if(entry.dir) continue;
    if(!isVideoName(entry.name)) continue;
    const blob = await entry.async('blob');
    const url = URL.createObjectURL(blob);
    const id = `${file.name}::${entry.name}`;
    const saved = state[id] || {};
    const item = {
      id,
      title: entry.name,
      url,
      zipName: file.name,
      blob,
      topic: saved.topic || '',
      voice: saved.voice || '',
      position: saved.position || 0,
      completed: !!saved.completed
    };
    playlist.push(item);
  }
  sortPlaylist();
  groupAndRenderPlaylist();
  updateProgressSummary();
}

// Load zips via Electron folder picker
loadFolderBtn && loadFolderBtn.addEventListener('click', async ()=>{
  if(!window.electronAPI || !window.electronAPI.loadZipsFromFolder){
    alert('Folder loading requires running in the Electron app.');
    return;
  }
  if(statusText) statusText.textContent = 'Scanning folder and caching library; this may take a few minutes...';
  const res = await window.electronAPI.loadZipsFromFolder();
  if(!res || !res.success){ alert('No folder selected or error reading folder.');
    if(statusText) statusText.textContent = 'Library load cancelled or failed.';
    return;
  }
  playlist = [];
  for(const it of res.items){
    const url = makeFileUrl(it.cachedPath);
    const id = `${it.zipName}::${it.entryName}`;
    const saved = state[id] || {};
    const item = { id, title: it.entryName, url, zipName: it.zipName, cachedPath: it.cachedPath, blob: null, topic: saved.topic||'', voice: saved.voice||'', position: saved.position||0, completed: !!saved.completed };
    playlist.push(item);
  }
  playlist.sort((a,b)=> naturalCompare(`${a.zipName}/${a.title}`, `${b.zipName}/${b.title}`));
  groupAndRenderPlaylist();
  updateProgressSummary();
  if(statusText) statusText.textContent = `Saved library loaded (${playlist.length} videos). Restart app to auto-load next time.`;
});

function inferTopicSubtopic(item){
  const zipBase = item.zipName.replace(/\.zip$/i, '');
  const match = zipBase.match(/^(\d+(?:\.\d+)*)(?:\s*[-_.]?\s*(.*))?$/);
  const sortKey = match ? match[1] : zipBase;
  const topic = match ? (match[2] || zipBase) : zipBase;
  const parts = item.title.split('/');
  const sub = parts.length > 1 ? parts.slice(0, -1).join(' / ') : '';
  const subSortKey = sub || item.title;
  return { topic: topic.trim(), topicSortKey: sortKey, subtopic: sub, subSortKey };
}

function groupAndRenderPlaylist(){
  playlistEl.innerHTML = '';
  const groups = {}; // topic -> { label, sortKey, subs }
  playlist.forEach((item, idx)=>{
    const info = inferTopicSubtopic(item);
    const topic = item.topic || info.topic || 'Misc';
    const sub = info.subtopic || 'General';
    if(!groups[topic]) groups[topic] = { label: topic, sortKey: info.topicSortKey, subs: {} };
    if(!groups[topic].subs[sub]) groups[topic].subs[sub] = { label: sub, sortKey: info.subSortKey, items: [] };
    groups[topic].subs[sub].items.push({item, idx});
  });
  Object.values(groups).sort((a,b)=> naturalCompare(a.sortKey,b.sortKey)).forEach(group=>{
    const th = document.createElement('div');
    th.className='group-topic';
    th.innerHTML=`<h3>${group.label}</h3>`;
    playlistEl.appendChild(th);
    Object.values(group.subs).sort((a,b)=> naturalCompare(a.sortKey,b.sortKey)).forEach(subGroup=>{
      const sh = document.createElement('div');
      sh.className='group-sub';
      sh.innerHTML=`<h4>${subGroup.label}</h4>`;
      playlistEl.appendChild(sh);
      subGroup.items.sort((a,b)=> naturalCompare(a.item.title, b.item.title));
      subGroup.items.forEach(({item, idx})=>{
        const div = document.createElement('div');
        div.className = 'item' + (item.completed ? ' completed' : '');
        div.dataset.index = idx;
        const completedMark = item.completed ? '<span class="completed-mark">✔ Completed</span>' : '';
        div.innerHTML = `<div class="item-title-row"><strong>${item.title}</strong>${completedMark}</div><div style="font-size:12px;color:#555">${item.zipName}</div>`;
        div.addEventListener('click', ()=>playAtIndex(idx));
        playlistEl.appendChild(div);
      });
    });
  });
}

function renderPlaylistItem(item, idx){
  const div = document.createElement('div');
  div.className = 'item' + (item.completed ? ' completed' : '');
  div.dataset.index = idx;
  const completedMark = item.completed ? '<span class="completed-mark">✔ Completed</span>' : '';
  div.innerHTML = `<div class="item-title-row"><strong>${item.title}</strong>${completedMark}</div><div style="font-size:12px;color:#555">${item.zipName}</div>`;
  div.addEventListener('click', ()=>playAtIndex(idx));
  playlistEl.appendChild(div);
}

function playAtIndex(idx){
  if(idx < 0 || idx >= playlist.length) return;
  currentIndex = idx;
  const item = playlist[idx];
  Array.from(playlistEl.children).forEach(c=>c.classList.remove('active'));
  const child = playlistEl.querySelector(`[data-index='${idx}']`);
  if(child) child.classList.add('active');
  videoPlayer.src = item.url;
  try{ videoPlayer.currentTime = item.position || 0; }catch(e){}
  topicInput.value = item.topic || '';
  voiceInput.value = item.voice || '';
}

function refreshPlaylistUI(){
  const current = currentIndex;
  groupAndRenderPlaylist();
  if(current >= 0){
    const child = playlistEl.querySelector(`[data-index='${current}']`);
    if(child) child.classList.add('active');
  }
}

zipInput.addEventListener('change', async (e)=>{
  const files = Array.from(e.target.files || []);
  for(const f of files){
    try{ await handleZipFile(f); }catch(err){console.error('zip load error', err)}
  }
});

videoPlayer.addEventListener('timeupdate', ()=>{
  if(currentIndex < 0) return;
  const item = playlist[currentIndex];
  item.position = videoPlayer.currentTime;
  persistItem(item);
  updateProgressSummary();
});

videoPlayer.addEventListener('ended', ()=>{
  if(currentIndex < 0) return;
  const item = playlist[currentIndex];
  item.completed = true;
  item.position = videoPlayer.duration || item.position;
  persistItem(item);
  refreshPlaylistUI();
  updateProgressSummary();
});

prevBtn.addEventListener('click', ()=>{ if(currentIndex > 0) playAtIndex(currentIndex-1); });
nextBtn.addEventListener('click', ()=>{ if(currentIndex < playlist.length-1) playAtIndex(currentIndex+1); });

markDone.addEventListener('click', ()=>{
  if(currentIndex < 0) return;
  const item = playlist[currentIndex];
  item.completed = true;
  item.position = videoPlayer.duration || item.position;
  persistItem(item);
  refreshPlaylistUI();
  updateProgressSummary();
});

topicInput.addEventListener('change', ()=>{
  if(currentIndex < 0) return;
  playlist[currentIndex].topic = topicInput.value;
  persistItem(playlist[currentIndex]);
  refreshPlaylistUI();
});
voiceInput.addEventListener('change', ()=>{
  if(currentIndex < 0) return;
  playlist[currentIndex].voice = voiceInput.value;
  persistItem(playlist[currentIndex]);
});

openVlcBtn.addEventListener('click', ()=>{
  if(currentIndex < 0) return;
  const item = playlist[currentIndex];
  if(window.electronAPI){
    if(item.cachedPath && window.electronAPI.openFileInVLC){
      window.electronAPI.openFileInVLC(item.cachedPath).then(res=>{ if(!res || !res.success) alert('Failed to open in VLC: '+(res && res.error)); });
      return;
    }
    if(window.electronAPI.openInVLC && item.blob){
      item.blob.arrayBuffer().then(buf => {
        window.electronAPI.openInVLC(item.title, buf).then(res=>{
          if(!res || !res.success) alert('Failed to open in VLC: '+(res && res.error));
        });
      });
      return;
    }
  }
  // browser fallback: download the blob
  const a = document.createElement('a');
  a.href = item.url;
  a.download = item.title;
  a.click();
});

function persistItem(item){
  const copy = { position: item.position, completed: !!item.completed, topic: item.topic, voice: item.voice };
  state[item.id] = copy;
  saveState(state);
  // also persist to disk if running in Electron
  if(window.electronAPI && window.electronAPI.persistProgress){
    const updates = [{ cachedPath: item.cachedPath, id: item.id, meta: copy }];
    window.electronAPI.persistProgress({ updates }).then(()=>{}).catch(()=>{});
  }
}

// On startup: try to load persisted index from Electron
if(window.electronAPI){
  if(zipInput){ zipInput.style.display = 'none'; }
  if(statusText) statusText.textContent = 'Checking saved library...';
  window.electronAPI.loadIndex().then(res=>{
    if(res && res.success && res.items && res.items.length){
      for(const it of res.items){
        const url = makeFileUrl(it.cachedPath);
        const id = `${it.zipName}::${it.entryName}`;
        const saved = state[id] || {};
        const item = { id, title: it.entryName, url, zipName: it.zipName, cachedPath: it.cachedPath, blob: null, topic: saved.topic||'', voice: saved.voice||'', position: saved.position||0, completed: !!saved.completed };
        playlist.push(item);
      }
      playlist.sort((a,b)=> naturalCompare(`${a.zipName}/${a.title}`, `${b.zipName}/${b.title}`));
      groupAndRenderPlaylist();
      updateProgressSummary();
      if(statusText) statusText.textContent = `Loaded saved library (${playlist.length} videos). Use Load/Refresh Library to refresh.`;
    }else{
      if(statusText) statusText.textContent = 'No saved library found yet. Click Load/Refresh Library and select your ZIP root folder once.';
    }
  }).catch(err=>{ 
    console.error('loadIndex error', err);
    if(statusText) statusText.textContent = 'Error loading saved library; use Load/Refresh Library to import again.';
  });
} else {
  if(statusText) statusText.textContent = 'Browser mode: file input loads files temporarily only. Use Electron to persist library.';
}

function updateProgressSummary(){
  if(!playlist.length){ progressSummary.textContent = 'No videos loaded.'; return; }
  const done = playlist.filter(p=>p.completed).length;
  const percent = Math.round((done/playlist.length)*100);
  progressSummary.textContent = `Completed: ${done}/${playlist.length} (${percent}%)`;
}

clearStorage.addEventListener('click', ()=>{
  if(!confirm('Clear saved progress?')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

// Initial UI state
updateProgressSummary();
