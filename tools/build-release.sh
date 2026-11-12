#!/bin/bash
# Baut das Installationspaket release/jukebux.tar.gz (Oberfläche fertig gebaut).
# Wird von GitHub Actions beim Veröffentlichen genutzt, geht aber auch lokal:
#   bash tools/build-release.sh [VERSION]
set -euo pipefail
cd "$(dirname "$0")/.."
# Tag in Versionsnummer umwandeln: v1.0.4, V1.0.4, v.1.0.4 -> 1.0.4
[ $# -ge 1 ] && echo "$1" | sed -E 's/^[vV]\.?//' > VERSION
VERSION="$(cat VERSION)"
if ! echo "$VERSION" | grep -qE '^[0-9]+(\.[0-9]+){1,3}$'; then
  echo "Ungültige Version «$VERSION» – Tags bitte wie v1.0.5 benennen." >&2
  exit 1
fi

echo "== Oberfläche bauen"
( cd frontend && { [ -d node_modules ] || npm ci; } && npm run build )

echo "== Paket schnüren (Version $VERSION)"
rm -rf release && mkdir -p release/jukebux/frontend
cp -r VERSION install.sh backend scripts release/jukebux/
cp -r frontend/dist release/jukebux/frontend/
# Niemals Schlüssel oder Daten mitliefern
rm -rf release/jukebux/backend/{config.env,data.json,spotify_token.json,plays.json,mixes.json,mixcache.json,*.tmp,__pycache__,.venv}
tar -czf release/jukebux.tar.gz -C release jukebux
cp VERSION release/VERSION
cp install.sh release/install.sh
rm -rf release/jukebux
ls -l release
