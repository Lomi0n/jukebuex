#!/bin/bash
# =====================================================================
#  JUKEBÜX – Installation und Aktualisierung
#
#  Neu installieren (als normaler Benutzer, NICHT mit sudo):
#    wget https://raw.githubusercontent.com/Lomi0n/jukebuex/main/install.sh
#    bash install.sh
#
#  Optionen:
#    --yes            keine Rückfragen (Kiosk + automatische Anmeldung = ja)
#    --no-kiosk       nur Server, Bedienung über den Browser
#    --from DATEI     aus einer heruntergeladenen jukebux.tar.gz installieren
#    --update         nur Programmdateien erneuern (ohne sudo; nutzt jukebox-update)
#
#  Schlüssel (Spotify, YouTube) werden NICHT hier abgefragt, sondern beim
#  ersten Start im Einrichtungsassistenten auf dem Bildschirm.
# =====================================================================

set -euo pipefail

# GitHub-Repository der JUKEBÜX (Konto/Name). Nach dem Forken hier anpassen.
REPO="${JUKEBUX_REPO:-Lomi0n/jukebuex}"

JB="$HOME/jukebox"
BIN="$HOME/.local/bin"
UNITS="$HOME/.config/systemd/user"
CONFIG="$JB/backend/config.env"

YES=0; KIOSK=""; AUTOLOGIN=""; FROM=""; UPDATE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --no-kiosk) KIOSK=0; AUTOLOGIN=0 ;;
    --from) FROM="$2"; shift ;;
    --update) UPDATE=1; YES=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Unbekannte Option: $1"; exit 1 ;;
  esac
  shift
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
say()  { echo; bold "== $*"; }
ok()   { echo "   ✔ $*"; }
warn() { echo "   ⚠ $*"; }
die()  { echo; echo "   ✖ $*"; exit 1; }

# Frage mit Vorgabe J/N – liest von der Tastatur, auch wenn das Skript per Pipe läuft
ask() {
  local question="$1" default="$2" answer=""
  if [ "$YES" = 1 ] || [ ! -r /dev/tty ]; then echo "$default"; return; fi
  local hint="[J/n]"; [ "$default" = 0 ] && hint="[j/N]"
  read -r -p "   $question $hint " answer < /dev/tty || true
  case "$answer" in
    j|J|ja|Ja|y|Y) echo 1 ;;
    n|N|nein|Nein) echo 0 ;;
    *) echo "$default" ;;
  esac
}

# ---------------------------------------------------------------------
# Prüfungen
# ---------------------------------------------------------------------
[ "$(id -u)" -eq 0 ] && die "Bitte OHNE sudo als normaler Benutzer ausführen (z. B. bash install.sh)."

if [ "$UPDATE" = 0 ]; then
  echo
  bold "JUKEBÜX – Installation"
  # Unterstützt: Ubuntu 24.04 und 26.04 sowie Ableger davon (z. B. AnduinOS, Zorin, Mint)
  . /etc/os-release 2>/dev/null || true
  case "${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}" in
    noble)    OS_BASE="Ubuntu 24.04" ;;
    resolute) OS_BASE="Ubuntu 26.04" ;;
    *)        OS_BASE="" ;;
  esac
  if [ -n "$OS_BASE" ]; then
    if [ "${ID:-}" = ubuntu ]; then ok "$OS_BASE erkannt"; else ok "${PRETTY_NAME:-$ID} (Basis $OS_BASE) erkannt"; fi
  elif [ "${ID:-}" = ubuntu ] || echo " ${ID_LIKE:-} " | grep -q " ubuntu "; then
    warn "Unterstützt sind Ubuntu 24.04 und 26.04 – hier läuft ${PRETTY_NAME:-ein Ubuntu-System}."
    [ "$(ask 'Trotzdem fortfahren?' 1)" = 1 ] || exit 1
  else
    warn "Die JUKEBÜX braucht Ubuntu 24.04/26.04 oder einen Ableger – hier läuft ${PRETTY_NAME:-ein unbekanntes System}."
    [ "$(ask 'Trotzdem fortfahren?' 0)" = 1 ] || exit 1
  fi
  if [ -f "$JB/backend/main.py" ]; then
    echo "   Bestehende JUKEBÜX gefunden – sie wird aktualisiert. Einstellungen, Favoriten,"
    echo "   Sounds und Spotify-Anmeldung bleiben erhalten (vorher wird eine Sicherung erstellt)."
  fi
  echo
  [ -z "$KIOSK" ] && KIOSK="$(ask 'Jukebox nach dem Hochfahren automatisch im Vollbild starten (Kiosk)?' 1)"
  if [ "$KIOSK" = 1 ] && [ -z "$AUTOLOGIN" ]; then
    AUTOLOGIN="$(ask "Benutzer $(whoami) automatisch anmelden (ohne Passwort beim Start)?" 1)"
  fi
  AUTOLOGIN="${AUTOLOGIN:-0}"
  echo
  echo "   Für einige Schritte wird das sudo-Passwort benötigt."
  sudo -v || die "Ohne sudo-Rechte geht es nicht."
fi

# ---------------------------------------------------------------------
# 1. Systempakete
# ---------------------------------------------------------------------
if [ "$UPDATE" = 0 ]; then
  say "1/8 Systempakete installieren"
  sudo apt-get update -q
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q \
    python3 python3-venv python3-pip curl ca-certificates bluez
  # Nützlich, aber nicht zwingend (Paketnamen können je nach Version abweichen)
  for pkg in pulseaudio-utils xdg-user-dirs; do
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$pkg" > /dev/null 2>&1 || warn "Paket $pkg nicht verfügbar – übersprungen"
  done
  command -v pactl > /dev/null || warn "pactl fehlt – der Lautsprecher wird nicht automatisch als Ausgang gewählt"
  ok "Grundpakete vorhanden"

  if [ "$KIOSK" = 1 ]; then
    if command -v google-chrome > /dev/null; then
      ok "Google Chrome ist installiert"
    elif [ "$(dpkg --print-architecture)" = amd64 ]; then
      echo "   Google Chrome wird installiert (für die Spotify-Wiedergabe nötig) …"
      TMP_DEB="$(mktemp --suffix=.deb)"
      curl -fsSL -o "$TMP_DEB" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$TMP_DEB"
      rm -f "$TMP_DEB"
      ok "Google Chrome installiert (wird mit den Systemupdates aktualisiert)"
    else
      warn "Google Chrome gibt es nicht für $(dpkg --print-architecture). Es wird Chromium verwendet –"
      warn "Spotify kann darin nicht abspielen (fehlender Kopierschutz-Baustein). YouTube und lokale Musik gehen."
      command -v chromium > /dev/null || command -v chromium-browser > /dev/null || \
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q chromium-browser || true
    fi
  fi
fi

# ---------------------------------------------------------------------
# 2. Programm herunterladen
# ---------------------------------------------------------------------
say "2/8 JUKEBÜX herunterladen"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if [ -n "$FROM" ]; then
  [ -f "$FROM" ] || die "Datei nicht gefunden: $FROM"
  cp "$FROM" "$WORK/jukebux.tar.gz"
  ok "Verwende $FROM"
else
  case "$REPO" in DEIN-KONTO/*) die "Im Skript ist noch kein GitHub-Repository eingetragen (REPO=…)." ;; esac
  URL="https://github.com/$REPO/releases/latest/download/jukebux.tar.gz"
  curl -fSL --progress-bar -o "$WORK/jukebux.tar.gz" "$URL" || die "Download fehlgeschlagen: $URL"
fi
tar -xzf "$WORK/jukebux.tar.gz" -C "$WORK"
SRC="$WORK/jukebux"
[ -f "$SRC/backend/main.py" ] && [ -f "$SRC/frontend/dist/index.html" ] || die "Das Paket ist unvollständig."
NEW_VERSION="$(cat "$SRC/VERSION" 2>/dev/null || echo '?')"
OLD_VERSION="$(cat "$JB/VERSION" 2>/dev/null || echo '')"
ok "Version $NEW_VERSION${OLD_VERSION:+ (bisher $OLD_VERSION)}"

# ---------------------------------------------------------------------
# 3. Sicherung einer bestehenden Installation
# ---------------------------------------------------------------------
if [ -f "$JB/backend/main.py" ] && [ "$UPDATE" = 0 ]; then
  say "3/8 Sicherung der bestehenden Installation"
  mkdir -p "$HOME/jukebox-backups" && chmod 700 "$HOME/jukebox-backups"
  ARCHIVE="$HOME/jukebox-backups/jukebox-vor-installation-$(date +%Y%m%d-%H%M%S).tar.gz"
  tar -czf "$ARCHIVE" -C "$HOME" --exclude='jukebox/backend/.venv' --exclude='jukebox/frontend/node_modules' \
    --exclude='jukebox/backend/__pycache__' jukebox 2>/dev/null || true
  chmod 600 "$ARCHIVE"
  ok "$ARCHIVE"
else
  [ "$UPDATE" = 0 ] && { say "3/8 Sicherung"; ok "Neuinstallation – nichts zu sichern"; }
fi

# ---------------------------------------------------------------------
# 4. Dateien kopieren (Einstellungen und Daten bleiben unberührt)
# ---------------------------------------------------------------------
say "4/8 Programmdateien einspielen"
mkdir -p "$JB/backend" "$JB/frontend" "$JB/sounds" "$JB/system" "$BIN" "$UNITS"
install -m 644 "$SRC/backend/main.py" "$SRC/backend/requirements.txt" "$JB/backend/"
rm -rf "$JB/frontend/dist.new"
cp -r "$SRC/frontend/dist" "$JB/frontend/dist.new"
rm -rf "$JB/frontend/dist"
mv "$JB/frontend/dist.new" "$JB/frontend/dist"
install -m 644 "$SRC/VERSION" "$JB/VERSION"
install -m 755 "$SRC/install.sh" "$JB/system/install.sh"
for script in jukebox-bluetooth jukebox-update jukebox-kiosk jukebox-restart jukebox-stop; do
  install -m 755 "$SRC/scripts/$script" "$BIN/$script"
done
ok "Programm in $JB"

# Einstellungen anlegen (Schlüssel folgen im Einrichtungsassistenten)
if [ ! -f "$CONFIG" ]; then
  MUSIC_BASE="$(xdg-user-dir MUSIC 2>/dev/null || true)"
  [ -z "$MUSIC_BASE" ] || [ "$MUSIC_BASE" = "$HOME" ] && MUSIC_BASE="$HOME/Musik"
  cat > "$CONFIG" <<EOF
# JUKEBÜX-Einstellungen – wird vom Einrichtungsassistenten gepflegt.
# Enthält Schlüssel: nicht weitergeben und nicht auf GitHub hochladen!
MUSIC_DIR="$MUSIC_BASE/Jukebox"
EOF
  ok "Einstellungen angelegt (Musikordner: $MUSIC_BASE/Jukebox)"
fi
chmod 600 "$CONFIG"
# Woher die automatische Wartung neue Versionen holt
case "$REPO" in
  DEIN-KONTO/*) ;;
  *) sed -i '/^JUKEBUX_REPO=/d' "$CONFIG"; echo "JUKEBUX_REPO=\"$REPO\"" >> "$CONFIG" ;;
esac
MUSIC_DIR="$(sed -n 's/^MUSIC_DIR=//p' "$CONFIG" | tr -d '"' | tail -1)"
mkdir -p "${MUSIC_DIR:-$HOME/Musik/Jukebox}"

# ---------------------------------------------------------------------
# 5. Python-Umgebung
# ---------------------------------------------------------------------
say "5/8 Python-Pakete"
[ -x "$JB/backend/.venv/bin/python" ] || python3 -m venv "$JB/backend/.venv"
"$JB/backend/.venv/bin/pip" install -q --upgrade pip
"$JB/backend/.venv/bin/pip" install -q -r "$JB/backend/requirements.txt"
ok "Python-Pakete installiert"

if [ "$UPDATE" = 1 ]; then
  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user restart jukebox-bluetooth.service 2>/dev/null || true
  echo
  ok "Programmdateien auf Version $NEW_VERSION aktualisiert"
  exit 0
fi

# ---------------------------------------------------------------------
# 6. Dienste
# ---------------------------------------------------------------------
say "6/8 Dienste einrichten"
sudo tee /etc/systemd/system/jukebox.service > /dev/null <<EOF
[Unit]
Description=JUKEBÜX Server
After=network-online.target
Wants=network-online.target

[Service]
User=$(whoami)
WorkingDirectory=$JB/backend
ExecStart=$JB/backend/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --timeout-graceful-shutdown 5
Restart=always
RestartSec=3
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
EOF
ok "Server-Dienst (jukebox.service)"

# Wartungsmenü und automatische Wartung dürfen nur das Hilfsskript ohne Passwort ausführen.
# Es kennt genau: start/stop/restart jukebox, reboot, poweroff, system-update.
# Eine einfache Regel ohne Sonderoptionen – funktioniert mit sudo und sudo-rs (Ubuntu 26.04).
sudo install -m 755 -o root -g root "$SRC/scripts/jukebox-system" /usr/local/sbin/jukebox-system
TMP_SUDOERS="$(mktemp)"
cat > "$TMP_SUDOERS" <<EOF
# JUKEBÜX: Wartungsmenü und automatische Wartung (siehe /usr/local/sbin/jukebox-system)
$(whoami) ALL=(root) NOPASSWD: /usr/local/sbin/jukebox-system
EOF
# sudo-rs prüft mit visudo nur /etc/sudoers – dann das klassische visudo.ws verwenden, falls vorhanden
VISUDO="$(command -v visudo.ws || command -v visudo || true)"
if [ -n "$VISUDO" ] && sudo "$VISUDO" -cf "$TMP_SUDOERS" > /dev/null 2>&1; then
  sudo install -m 440 -o root -g root "$TMP_SUDOERS" /etc/sudoers.d/jukebox
  ok "Rechte für Wartungsmenü (/etc/sudoers.d/jukebox)"
else
  warn "Fehler in der sudo-Regel – Wartungsmenü kann nicht neu starten"
fi
rm -f "$TMP_SUDOERS"

cat > "$UNITS/jukebox-bluetooth.service" <<'EOF'
[Unit]
Description=JUKEBÜX Bluetooth-Wächter (Lautsprecher verbunden halten)
After=pipewire.service wireplumber.service

[Service]
ExecStart=%h/.local/bin/jukebox-bluetooth
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
cat > "$UNITS/jukebox-update.service" <<'EOF'
[Unit]
Description=JUKEBÜX automatische Wartung

[Service]
Type=oneshot
ExecStart=%h/.local/bin/jukebox-update --auto
TimeoutStartSec=1h
EOF
cat > "$UNITS/jukebox-update.timer" <<'EOF'
[Unit]
Description=JUKEBÜX automatische Wartung (wöchentlich)

[Timer]
OnCalendar=Sun *-*-* 04:00:00
RandomizedDelaySec=15min

[Install]
WantedBy=timers.target
EOF
ok "Bluetooth-Wächter und wöchentliche Wartung (Sonntag 4 Uhr)"

# ---------------------------------------------------------------------
# 7. Vollbild-Start (Kiosk)
# ---------------------------------------------------------------------
say "7/8 Vollbild-Start"
mkdir -p "$HOME/.config/autostart" "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/jukebox.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=JUKEBÜX
Comment=Jukebox im Vollbild starten
Exec=$BIN/jukebox-kiosk
Icon=multimedia-audio-player
Terminal=false
Categories=AudioVideo;
EOF
if [ "$KIOSK" = 1 ]; then
  cat > "$HOME/.config/autostart/jukebox-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=JUKEBÜX
Exec=$BIN/jukebox-kiosk
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=3
EOF
  if command -v gsettings > /dev/null; then
    # Bildschirm wach halten, keine Sperre, keine Einblendungen
    gsettings set org.gnome.desktop.session idle-delay 0 2>/dev/null || true
    gsettings set org.gnome.desktop.screensaver lock-enabled false 2>/dev/null || true
    gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing' 2>/dev/null || true
    gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type 'nothing' 2>/dev/null || true
    gsettings set org.gnome.settings-daemon.plugins.power idle-dim false 2>/dev/null || true
    gsettings set org.gnome.desktop.notifications show-banners false 2>/dev/null || true
  fi
  ok "Startet nach der Anmeldung automatisch im Vollbild"
else
  rm -f "$HOME/.config/autostart/jukebox-kiosk.desktop"
  ok "Kein Vollbild-Start (im App-Menü als «JUKEBÜX» verfügbar)"
fi

if [ "$AUTOLOGIN" = 1 ]; then
  GDM=/etc/gdm3/custom.conf
  if [ -f "$GDM" ]; then
    sudo cp -n "$GDM" "$GDM.bak-jukebox"
    sudo sed -i '/^[[:space:]]*#*[[:space:]]*AutomaticLoginEnable[[:space:]]*=/d; /^[[:space:]]*#*[[:space:]]*AutomaticLogin[[:space:]]*=/d' "$GDM"
    sudo sed -i "/^\[daemon\]/a AutomaticLoginEnable=true\nAutomaticLogin=$(whoami)" "$GDM"
    ok "Automatische Anmeldung für $(whoami)"
  else
    warn "$GDM nicht gefunden – automatische Anmeldung bitte in den Einstellungen unter «Benutzer» aktivieren."
  fi
fi

# ---------------------------------------------------------------------
# 8. Starten
# ---------------------------------------------------------------------
say "8/8 JUKEBÜX starten"
sudo systemctl daemon-reload
sudo systemctl enable jukebox.service > /dev/null 2>&1
sudo systemctl kill --signal=KILL jukebox 2>/dev/null || true
sudo systemctl restart jukebox.service
for i in $(seq 1 30); do curl -fs http://localhost:8000/api/health > /dev/null && break; sleep 1; done
curl -fs http://localhost:8000/api/health > /dev/null || die "Der Server startet nicht. Protokoll: journalctl -u jukebox -n 50"
ok "Server läuft"

if systemctl --user daemon-reload 2>/dev/null; then
  systemctl --user enable --now jukebox-bluetooth.service > /dev/null 2>&1 || true
  systemctl --user restart jukebox-bluetooth.service 2>/dev/null || true
  systemctl --user enable --now jukebox-update.timer > /dev/null 2>&1 || true
  ok "Bluetooth-Wächter und Wartung aktiv"
else
  warn "Benutzerdienste konnten nicht gestartet werden – sie starten nach dem nächsten Anmelden."
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
SETUP_OPEN="$(curl -fs http://localhost:8000/api/info | grep -o '"setup_open":true' || true)"
STARTED=0
if [ "$KIOSK" = 1 ] && [ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ]; then
  "$BIN/jukebox-restart" > /dev/null 2>&1 && STARTED=1
fi

echo
bold "Fertig! JUKEBÜX $NEW_VERSION ist installiert."
echo
if [ -n "$SETUP_OPEN" ]; then
  if [ "$STARTED" = 1 ]; then
    echo "   Der Einrichtungsassistent erscheint jetzt auf dem Bildschirm."
  else
    echo "   Beim nächsten Start (sudo reboot) erscheint der Einrichtungsassistent auf dem Bildschirm."
  fi
  echo "   Bequemer am PC:  http://$IP:8000/setup   (Code steht auf dem Jukebox-Bildschirm)"
else
  echo "   Die bestehende Einrichtung wurde übernommen."
  echo "   Ändern: Wartungsmenü (Logo 2 Sekunden gedrückt halten) → Einrichtung erneut starten"
fi
echo "   Fernbedienung:   http://$IP:8000/remote"
echo "   Musikordner:     ${MUSIC_DIR:-$HOME/Musik/Jukebox}"
if [ "$KIOSK" = 1 ] && [ "$STARTED" = 0 ]; then echo "   Neu starten mit: sudo reboot"; fi
echo
