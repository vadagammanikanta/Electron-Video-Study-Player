const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openInVLC: (filename, arrayBuffer) => ipcRenderer.invoke('open-in-vlc', { filename, buffer: arrayBuffer }),
  loadZipsFromFolder: () => ipcRenderer.invoke('load-zips-from-folder'),
  scanAndExtract: () => ipcRenderer.invoke('load-zips-from-folder'),
  loadIndex: () => ipcRenderer.invoke('load-index'),
  persistProgress: (data) => ipcRenderer.invoke('persist-progress', data)
  ,openFileInVLC: (filePath) => ipcRenderer.invoke('open-file-in-vlc', { filePath })
});
