#!/bin/bash
# Baut das Installationspaket release/jukebux.tar.gz (Oberfläche fertig gebaut).
# Wird von GitHub Actions beim Veröffentlichen genutzt, geht aber auch lokal:
#   bash tools/build-release.sh [VERSION]
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -ge 1 ] && echo "${1#v}" > VERSION
VERSION="$(cat VERSION)"

echo "== Oberfläche bauen"
( cd frontend && { [ -d node_modules ] || npm ci; } && npm run build )

echo "== Paket schnüren (Version $VERSION)"
rm -rf release && mkdir -p release/jukebux/frontend
cp -r VERSION install.sh backend scripts release/jukebux/
cp -r frontend/dist release/jukebux/frontend/
# Niemals Schlüssel oder Daten mitliefern
rm -rf release/jukebux/backend/{config.env,data.json,spotify_token.json,__pycache__,.venv}
tar -czf release/jukebux.tar.gz -C release jukebux
cp VERSION release/VERSION
cp install.sh release/install.sh
rm -rf release/jukebux
ls -l release
