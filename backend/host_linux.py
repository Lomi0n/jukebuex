# JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE).
"""Alles, was nur unter Linux (Ubuntu und Ableger) gilt: Speicherorte, Systembefehle, Oberfläche.

main.py spricht nur über host.py mit diesem Modul. Eine Windows-Fassung (host_windows.py)
stellt dieselben Namen bereit.
"""
import subprocess
from pathlib import Path

NAME = "linux"

# ---------- Speicherorte ----------
# Unter Linux liegt alles unter ~/jukebox: Programm und Daten nebeneinander.

APP_DIR = Path(__file__).resolve().parent.parent          # ~/jukebox
BACKEND_DIR = APP_DIR / "backend"
DATA_DIR = BACKEND_DIR                                    # config.env, data.json, Mixe, Spotify-Anmeldung
SOUND_DIR = APP_DIR / "sounds"
BACKGROUND_DIR = APP_DIR / "background"
MAINTENANCE_FILE = APP_DIR / "system" / "letzte-wartung.json"
VERSION_FILE = APP_DIR / "VERSION"
FRONTEND_DIST = APP_DIR / "frontend" / "dist"


def default_music_dir():
    return Path.home() / "Musik" / "Jukebox"


# ---------- Systembefehle (Wartungsmenü) ----------

SYSTEMCTL = "/usr/bin/systemctl"
# Root-Hilfsskript vom Installer (funktioniert mit sudo und sudo-rs gleichermassen)
SYSTEM_HELPER = Path("/usr/local/sbin/jukebox-system")
KIOSK_PATTERN = "'[j]ukebox-chrome'"     # Browser-Profil der Jukebox, dient zum Wiedererkennen


def privileged(action):
    """Systembefehl ohne Passwort (siehe /etc/sudoers.d/jukebox)."""
    if SYSTEM_HELPER.exists():
        return f"sudo -n {SYSTEM_HELPER} {action}"
    return f"sudo -n {SYSTEMCTL} {action}" + (" jukebox" if action in ("start", "stop", "restart") else "")


SYSTEM_ACTIONS = {
    # Oberfläche schliessen, Server läuft weiter
    "exit-kiosk": lambda: f"pkill -f {KIOSK_PATTERN}",
    # Oberfläche und Server beenden
    "stop": lambda: f"pkill -f {KIOSK_PATTERN}; {privileged('stop')}",
    "reboot": lambda: privileged("reboot"),
    "poweroff": lambda: privileged("poweroff"),
}


def system_command(action):
    """Befehl für eine Aktion aus dem Wartungsmenü, None = unbekannt."""
    command = SYSTEM_ACTIONS.get(action)
    return command() if command else None


# Oberfläche neu starten (Vollbild/Fenster wechseln). Der Server läuft als Dienst, der Browser in
# der Sitzung des Benutzers: die Sitzungs-Umgebung (Bildschirm, D-Bus) vom laufenden Browser übernehmen.
KIOSK_RESTART = r"""
PID=$(pgrep -f '[j]ukebox-chrome' | head -n 1)
if [ -n "$PID" ] && [ -r "/proc/$PID/environ" ]; then
  while IFS= read -r -d '' VAR; do
    case "$VAR" in DISPLAY=*|WAYLAND_DISPLAY=*|XDG_RUNTIME_DIR=*|DBUS_SESSION_BUS_ADDRESS=*|XDG_SESSION_TYPE=*|XAUTHORITY=*) export "$VAR";; esac
  done < "/proc/$PID/environ"
fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
"$HOME/.local/bin/jukebox-restart"
"""


def restart_ui_command():
    return KIOSK_RESTART


def run_later(command, delay=1):
    """Befehl kurz verzögert ausführen, damit die Antwort noch beim Browser ankommt."""
    subprocess.Popen(["bash", "-c", f"sleep {delay}; {command}"], start_new_session=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# ---------- Hinweise für Fehlermeldungen ----------

BLUETOOTH_WATCHER_HINT = "Der Bluetooth-Wächter läuft nicht (systemctl --user status jukebox-bluetooth)."
