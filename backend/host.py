# JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE).
"""Plattform-Schicht: wählt die passende Fassung für das Betriebssystem.

Jede Fassung (host_linux.py, später host_windows.py) stellt dieselben Namen bereit:
  NAME, APP_DIR, BACKEND_DIR, DATA_DIR, SOUND_DIR, BACKGROUND_DIR, MAINTENANCE_FILE,
  VERSION_FILE, FRONTEND_DIST, default_music_dir(), system_command(action),
  restart_ui_command(), run_later(command, delay), BLUETOOTH_WATCHER_HINT
"""
import sys

if sys.platform.startswith("linux"):
    from host_linux import *   # noqa: F401,F403
else:
    raise RuntimeError(f"JUKEBÜX läuft auf diesem System ({sys.platform}) noch nicht.")
