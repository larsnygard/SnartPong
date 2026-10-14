#!/usr/bin/env bash
# Deploy SnartPong to https://snart.com/pong
#
# Mirrors the SnartBlocks / SnartChess convention: rsync the whole project
# into the shared webroot's pong/ subdirectory, excluding VCS and dev cruft
# (see .rsync-exclude). Static only — no build step.
set -euo pipefail

HOST="proisp"
DEST="$(ssh -o BatchMode=yes "$HOST" 'readlink -f "$HOME/www/pong"')"

# Create the target dir on the host first (idempotent).
ssh "$HOST" "mkdir -p '$DEST'"

rsync -avz --delete \
  --exclude-from="$(git rev-parse --show-toplevel)/.rsync-exclude" \
  "$(git rev-parse --show-toplevel)/" "$HOST":"$DEST"/

echo
echo "Deployed to: https://snart.com/pong"
echo "  remote:    $DEST"
echo "  files:     $(ssh "$HOST" "find '$DEST' -type f | wc -l")"
