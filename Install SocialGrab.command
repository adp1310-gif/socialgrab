#!/bin/bash
# Double-click to install SocialGrab for Premiere Pro and After Effects (macOS).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/SocialGrab"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/SocialGrab"

if [ ! -d "$SRC" ]; then
  echo "Can't find the SocialGrab folder next to this installer. Unzip the whole package first."
  read -n 1 -s -r -p "Press any key to close."; exit 1
fi

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# Allow unsigned extensions to load in Premiere Pro / After Effects.
for v in 9 10 11 12 13; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done

echo ""
echo "✅ SocialGrab installed."
echo ""
if ! command -v ffmpeg >/dev/null 2>&1 && [ ! -x /opt/homebrew/bin/ffmpeg ] && [ ! -x /usr/local/bin/ffmpeg ] && [ ! -x "$HOME/bin/ffmpeg" ]; then
  echo "⚠️  ffmpeg is not installed. SocialGrab needs it to merge video + audio."
  echo "   Install Homebrew from https://brew.sh, then run:  brew install ffmpeg"
  echo ""
fi
echo "Next:"
echo "  1. Quit and reopen Premiere Pro (or After Effects)."
echo "  2. Window > Extensions > SocialGrab – Video Downloader"
echo "  3. Click 'Install yt-dlp' at the bottom of the panel (one time)."
echo ""
read -n 1 -s -r -p "Press any key to close."
