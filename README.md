# JUKEBÜX

Eine Jukebox für zu Hause: ein Linux-Gerät mit Touchscreen (z. B. ein Surface oder ein alter
Laptop) spielt Musik von **Spotify**, **YouTube**, **Webradio** und aus **lokalen Dateien** über eine
Bluetooth-Stereoanlage. Gäste wünschen sich Songs bequem vom PC oder Laptop aus über die
Fernbedienung im Browser.

- Vollbild-Oberfläche für den Touchscreen mit Warteschlange, Verlauf, Favoritenlisten und Soundboard
- Webradio als Lückenfüller: läuft, sobald die Warteschlange leer ist (Sender aus [radio-browser.info](https://www.radio-browser.info))
- Automatische Mixe nach Genre: jede Nacht neu aus dem, was hier läuft – mit Lieblingssongs und neuen Entdeckungen
  (Vorschläge über Deezer, optional Last.fm; abspielbar über YouTube oder Spotify)
- Fernbedienung im Browser: `http://<IP-der-Jukebox>:8000/remote`
- Bluetooth-Wächter, der die Stereoanlage verbunden hält
- Bildschirmschoner, verstecktes Wartungsmenü, wöchentliche automatische Wartung mit Updates
- Einrichtungsassistent beim ersten Start – am Gerät oder am PC

## Voraussetzungen

| | |
|---|---|
| System | Ubuntu 24.04 oder 26.04 Desktop (x86_64), auch Ableger wie AnduinOS, Zorin OS oder Linux Mint |
| Spotify | Spotify-**Premium**-Konto und eine eigene, kostenlose Spotify-Entwickler-App (der Assistent erklärt die Schritte) |
| YouTube | kostenloser API-Schlüssel von Google (optional) |
| Last.fm | kostenloser API-Schlüssel für treffsicherere Mixe (optional) |
| Lautsprecher | Bluetooth-Stereoanlage oder -Box (optional) |

Spotify spielt nur in Google Chrome. Das Installationsskript richtet Chrome selbst ein.

## Installation

Im Terminal der Jukebox als **normaler Benutzer** (nicht mit `sudo`):

```bash
wget https://raw.githubusercontent.com/Lomi0n/jukebuex/main/install.sh
bash install.sh
```

Das Skript fragt zwei Dinge (Vollbild-Start, automatische Anmeldung) und erledigt dann den Rest:
Pakete, Google Chrome, Python-Umgebung, Server-Dienst, Bluetooth-Wächter und Wartung.
Für einige Schritte braucht es das sudo-Passwort.

Ist bereits eine JUKEBÜX installiert, wird sie aktualisiert. Einstellungen, Favoriten, Sounds
und die Spotify-Anmeldung bleiben dabei erhalten, vorher wird eine Sicherung erstellt.

## Einrichtung beim ersten Start

Nach der Installation erscheint auf dem Bildschirm der **Einrichtungsassistent**:

1. Name der Jukebox
2. Spotify-App anlegen (Client ID und Secret)
3. Bei Spotify anmelden (nur direkt am Jukebox-Bildschirm möglich)
4. YouTube-API-Schlüssel (und optional Last.fm-Schlüssel für die Mixe)
5. Bluetooth-Lautsprecher suchen und koppeln
6. Ordner für lokale Musik

Schlüssel auf dem Touchscreen abzutippen ist mühsam. Bequemer geht es am PC: Dort im Browser
`http://<IP-der-Jukebox>:8000/setup` öffnen und den 6-stelligen Code eingeben, der auf dem
Jukebox-Bildschirm steht. Beide Bildschirme zeigen dieselben Schritte.

Später ändern: auf der Jukebox das Logo oben links **2 Sekunden gedrückt halten** und im
Wartungsmenü **Einrichtung erneut starten** wählen.

## Bedienung

| Was | Wo |
|---|---|
| Jukebox | Vollbild auf dem Gerät |
| Fernbedienung | `http://<IP>:8000/remote` von jedem PC im selben Netz |
| Sounds hochladen | nur über die Fernbedienung (nicht am Gerät selbst) |
| Radiosender suchen/hinzufügen | nur über die Fernbedienung, abspielen auch am Gerät |
| Wartungsmenü | Logo oben links 2 Sekunden gedrückt halten |
| Lokale Musik | MP3/FLAC in `~/Musik/Jukebox` (bzw. `~/Music/Jukebox`) |

Befehle im Terminal (auch per SSH):

```bash
jukebox-restart          # Vollbild neu starten
jukebox-stop             # Vollbild beenden, Server läuft weiter
jukebox-update           # Sicherung + Updates (System, JUKEBÜX, Python) + Neustart
jukebox-update --backup  # nur Sicherung
journalctl -u jukebox -n 50                    # Protokoll des Servers
systemctl --user status jukebox-bluetooth      # Bluetooth-Wächter
```

## Updates

Jeden Sonntag um 4 Uhr erstellt die Jukebox eine Sicherung, spielt System-Updates ein, holt
eine neue JUKEBÜX-Version von GitHub (falls vorhanden) und startet neu. Das Ergebnis steht im
Wartungsmenü.

## Neue Version veröffentlichen (für Entwickler)

Auf GitHub unter **Releases → Draft a new release** einen neuen Tag wie `v1.0.1` anlegen und
**Publish release** wählen – oder im Terminal:

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions baut dann die Oberfläche und veröffentlicht ein Release mit `jukebux.tar.gz`.
Alle Jukeboxen holen es sich bei der nächsten Wartung automatisch. Lokal bauen und testen:

```bash
bash tools/build-release.sh          # -> release/jukebux.tar.gz
bash install.sh --from release/jukebux.tar.gz
```

Entwickeln mit Live-Vorschau: Server mit `uvicorn main:app --reload --port 8000` in `backend/`
starten, dann in `frontend/` `npm install` und `npm run dev`.

## Aufbau

```
backend/        FastAPI-Server (main.py), automatische Mixe (mixer.py), Einstellungen in config.env
frontend/       React-Oberfläche (Vite)
scripts/        Kiosk-Start, Bluetooth-Wächter, Wartung
install.sh      Installation und Aktualisierung
tools/          Release-Paket bauen
```

Auf dem Gerät:

```
~/jukebox/backend/config.env           Schlüssel und Einstellungen (nur für den Benutzer lesbar)
~/jukebox/backend/data.json            Warteschlange, Verlauf, Favoriten, Sounds
~/jukebox/backend/spotify_token.json   Spotify-Anmeldung
~/jukebox/backend/plays.json           Hörprofil für die Mixe (was wie oft lief)
~/jukebox/backend/mixes.json           automatische Mixe
~/jukebox/backend/mixcache.json        Zwischenspeicher (Künstlerinfos, gefundene Spotify-/YouTube-Titel)
~/jukebox/sounds/                      Soundboard-Dateien
~/jukebox-backups/                     Sicherungen (die letzten 10)
```

## Sicherheit

- Schlüssel und persönliche Daten liegen nur auf dem Gerät und sind per `.gitignore` vom
  Repository ausgeschlossen. Sie gehören nie auf GitHub.
- Die JUKEBÜX ist für das **Heimnetz** gedacht. Port 8000 nicht im Router freigeben.
- Das Spotify-Zugriffstoken bekommt nur das Gerät selbst, nie die Fernbedienung.
- Die Einrichtung am PC ist nur mit dem Code möglich, den der Jukebox-Bildschirm anzeigt.
  Nach Abschluss ist sie gesperrt, bis sie am Gerät wieder geöffnet wird.
- Der Server darf per sudo nur genau festgelegte Befehle ausführen (`/etc/sudoers.d/jukebox`).

## Deinstallieren

```bash
sudo systemctl disable --now jukebox
systemctl --user disable --now jukebox-bluetooth jukebox-update.timer
sudo rm /etc/systemd/system/jukebox.service /etc/sudoers.d/jukebox
rm -f ~/.config/systemd/user/jukebox-* ~/.config/autostart/jukebox-kiosk.desktop \
      ~/.local/share/applications/jukebox.desktop ~/.local/bin/jukebox-*
rm -rf ~/jukebox ~/.config/jukebox-chrome     # löscht auch Einstellungen und Favoriten!
```

Die automatische Anmeldung wird unter Einstellungen → Benutzer wieder ausgeschaltet.

## Lizenz

Copyright (c) 2026 Dominick. Ab Version 1.2.1 gilt die
[PolyForm Strict License 1.0.0](LICENSE) – kurz zusammengefasst (massgebend ist der Lizenztext):

- **Erlaubt:** die JUKEBÜX für private, nicht-kommerzielle Zwecke installieren und nutzen.
- **Nicht erlaubt:** den Code verändern, darauf aufbauen, ihn kopieren und weitergeben
  (auch nicht als Fork oder eigene Version) oder ihn kommerziell nutzen.
- Andere Nutzungen nur mit schriftlicher Erlaubnis des Urhebers – bitte über GitHub anfragen.

Versionen bis und mit 1.2.0 wurden unter der MIT-Lizenz veröffentlicht; für diese Versionen gilt sie weiter.
Eingebundene Bibliotheken (z. B. React, FastAPI) stehen unter ihren eigenen Lizenzen.
Spotify, YouTube, Deezer und Last.fm sind Marken ihrer jeweiligen Inhaber.
Die JUKEBÜX nutzt deren offizielle Schnittstellen und steht in keiner Verbindung zu ihnen.
