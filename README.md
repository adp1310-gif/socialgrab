# SocialGrab: social video downloader for Premiere Pro and After Effects

SocialGrab is a panel that runs inside Premiere Pro and After Effects. Paste a link from YouTube, Instagram, LinkedIn, Pinterest or X (Twitter) and it will:

1. download the video in the highest quality available, with audio,
2. convert it to an editing-friendly format when needed (for example, YouTube's VP9 or AV1 4K becomes H.264),
3. import it into your project, in a bin (Premiere) or folder (AE) named **Social Downloads**.

Works on **Windows and macOS**, in **Premiere Pro 2021+** and **After Effects 2021+**.

## ⬇️ Download

**[Download SocialGrab.zip](https://github.com/adp1310-gif/socialgrab/releases/latest/download/SocialGrab.zip)**. One zip works on both Windows and Mac.

## Install on Windows

1. Right-click `SocialGrab.zip` and choose **Extract All…**. Don't run the installer from inside the zip.
2. Double-click **Install SocialGrab (Windows).bat**. If Windows shows "Windows protected your PC", click **More info → Run anyway**.
3. Close and reopen Premiere Pro or After Effects, then open **Window → Extensions → SocialGrab – Video Downloader**.
4. Click **Install tools** at the bottom of the panel, once. It downloads about 250 MB (yt-dlp, ffmpeg and Deno) into
   `%APPDATA%\SocialGrab\bin`. Nothing else on the PC is changed.

## Install on macOS

1. Unzip `SocialGrab.zip`, then right-click **Install SocialGrab.command** and choose **Open**.
2. If `ffmpeg` isn't installed, run `brew install ffmpeg`. Homebrew is available from https://brew.sh.
3. Restart Premiere Pro or After Effects, then open **Window → Extensions → SocialGrab – Video Downloader**.
4. Click **Install tools** at the bottom of the panel, once.

## Keeping it working

Social sites change often. When downloads start failing, click **Update yt-dlp** at the bottom of the panel. That fixes most problems.

## Quality options

| Option | What you get |
|---|---|
| **Highest quality · MP4 (H.264)** *(default)* | Best resolution available, up to 4K and 60 fps. If the source is VP9 or AV1, it's re-encoded to high-bitrate H.264 using the Mac's hardware encoder. |
| **Fast · native MP4** | H.264 exactly as the site serves it, with no conversion. YouTube usually stops at 1080p. |
| **ProRes 422 HQ (.mov)** | Best resolution, converted to ProRes. Files are large, but editing is the smoothest. |
| **Audio only · WAV** | Just the audio track. |

## Where files go

- **Saved project:** `<project folder>/Social Downloads/`
- **Unsaved project:** `~/Movies/Social Downloads/`
- To use a different folder, choose one under **Settings → Save files to**.

## Private or login-only posts (Instagram, LinkedIn)

Under **Settings → Use login cookies from browser**, choose the browser you're logged in with. SocialGrab then reads that browser's
cookies, the same way `yt-dlp --cookies-from-browser` does. Safari needs Full Disk Access for Premiere or After Effects.

## Tips

- To queue several videos, paste several links, one per line.
- For a playlist link, only the single video in the link is downloaded.
- To debug the panel, open `http://localhost:8098` (Premiere) or `http://localhost:8099` (AE) in Chrome while the panel is open.

## Files

```
SocialGrab/
  CSXS/manifest.xml   panel definition (hosts: PPRO, AEFT)
  index.html, css/    UI
  js/main.js          UI logic, queue, project import calls
  js/engine.js        yt-dlp / ffmpeg discovery, download, conversion (Node.js)
  jsx/host.jsx        ExtendScript: import into Premiere bin / AE folder
```

Only download content you own or have permission to use.
