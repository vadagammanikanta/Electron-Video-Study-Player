# Video Study Player

A lightweight Electron app that loads video ZIP archives, builds a playlist from the contained files, and keeps study progress between app restarts.

This repository contains only the application source and installer metadata. No video files or ZIP archives are included.

How it works:
- Open `index.html` in a browser (double-click or via a local server).
- Click the file input and select one or more `.zip` files that contain video files (mp4, webm, ogg).
- The app extracts videos in-memory and builds the playlist. Click an item to play.
- Progress (current time, completed flag, topic, voice) is saved to browser `localStorage` and will reattach when you reload the same ZIP files again.

Notes & limitations:
- Videos are extracted in-browser; you must keep the page open or reload and re-import the ZIPs to re-create Blob URLs.
- Large video files may consume memory; for large libraries, consider extracting ZIPs to disk and using an Electron app.
- Playback depends on your browser's supported codecs (MP4/H.264 works in most modern browsers).

Next steps I implemented:
- Electron launcher: the app can run as an Electron desktop app and directly open extracted videos in VLC.

Running as Electron (desktop) — Windows/macOS/Linux

1. Install dependencies and start the app:

```bash
cd video-study-player
npm install
npm start
```

2. VLC path: The Electron app attempts to find VLC automatically. To override, set the environment variable `VLC_PATH` to the full path of your VLC executable before starting the app.

Example (Windows PowerShell):

```powershell
$env:VLC_PATH = 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe'
npm start
```

Notes:
- When running in Electron, use the `Open in VLC` button to write a temporary file and launch VLC directly.
- If VLC isn't found, the app falls back to attempting the `vlc` command or the browser download behavior.

Bulk-loading ZIPs from a folder:

- Click `Load ZIP Folder` in the header. Select the root folder that contains your ZIP files — the app will recursively scan subfolders for ZIP files.
- The app extracts video files from each ZIP and builds a playlist grouped by `topic` (derived from the ZIP filename) and `subtopic` (derived from paths inside the ZIP). You can adjust topics in the `Topic` field after selecting a video.

Automatic load on startup:
- After you run `Load ZIP Folder` once, the app will extract videos into an application cache and persist an index in the app data folder. On subsequent launches the app will automatically load the cached library — you won't have to reselect folders.
- Progress and simple metadata (topic, voice, position, completed) are saved to the index so your study progress persists across restarts.

Add it to your desktop:
- Copy `launch-video-study-player.cmd` to your desktop.
- Double-click that desktop file to start the app quickly.
- If you want a proper shortcut, right-click the desktop file and choose `Create shortcut`.

Package it as a real Windows installer:
- Install the builder dependency:
  ```powershell
  npm install
  ```
- Build the Windows installer:
  ```powershell
  npm run dist
  ```
- The installer and unpacked app appear in `dist\`.
- Run the generated `.exe` to install the app and create a desktop shortcut automatically.

If you prefer, the existing `launch-video-study-player.cmd` remains a simpler fallback launcher.

Filename heuristics:
- ZIP files named like `01. Topic Name.zip` will result in `Topic Name` as the topic.
- Subfolder paths inside ZIPs (e.g., `Sorting/QuickSort.mp4`) become subtopics (`Sorting`).

Other next-step ideas:
- Add note-taking and exporting of progress/report.
- Add categories/ordering and automated study plan suggestions.
