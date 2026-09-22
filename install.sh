#!/bin/bash
# Installs the SocialGrab panel for Premiere Pro and After Effects (macOS).
set -e
SRC="$(cd "$(dirname "$0")" && pwd)/SocialGrab"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/SocialGrab"

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
ln -s "$SRC" "$DEST"
echo "Linked $DEST -> $SRC"

# Allow unsigned (developer) extensions to load.
for v in 9 10 11 12 13; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done
echo "Enabled PlayerDebugMode for CSXS 9–13."
echo "Restart Premiere Pro / After Effects, then open Window > Extensions > SocialGrab – Video Downloader."
