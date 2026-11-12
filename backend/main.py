# JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE).
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import RedirectResponse, FileResponse
from starlette.background import BackgroundTask
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import List, Optional
from pathlib import Path
from urllib.parse import quote
from mutagen import File
from uuid import uuid4
import asyncio
import base64
import colorsys
import io
import html
import json
import os
import re
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.error
import zipfile
import urllib.parse
import urllib.request
import mixer

BACKEND_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BACKEND_DIR / "config.env"
VERSION_FILE = BACKEND_DIR.parent / "VERSION"
HISTORY_LIMIT = 10
PORT = 8000
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"
DEFAULT_NAME = "JUKEBÜX"
COPYRIGHT = "JUKEBÜX © 2026 Lomi0n – PolyForm Strict License 1.0.0"
SKINS = ("standard", "retro", "synthwave", "swiss", "kritzel", "kritzel-dark")   # Aussehen (frontend/src/skins.css)


def current_skin():
    skin = CONFIG.get("JUKEBOX_SKIN")
    return skin if skin in SKINS else "standard"


def load_config():
    """Liest die Einstellungen aus config.env (Format: NAME=wert)."""
    config = {}
    if CONFIG_FILE.exists():
        for line in CONFIG_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                config[key.strip()] = value.strip().strip('"').strip("'")
    return config


def apply_config():
    """Einstellungen (neu) übernehmen – nach der Einrichtung ohne Neustart."""
    global CONFIG, YOUTUBE_API_KEY, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, LASTFM_API_KEY
    CONFIG = load_config()
    LASTFM_API_KEY = os.environ.get("LASTFM_API_KEY") or CONFIG.get("LASTFM_API_KEY")
    YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY") or CONFIG.get("YOUTUBE_API_KEY")
    SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID") or CONFIG.get("SPOTIFY_CLIENT_ID")
    SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET") or CONFIG.get("SPOTIFY_CLIENT_SECRET")


def save_config(updates):
    """Werte in config.env setzen (None = Eintrag entfernen). Kommentare bleiben erhalten."""
    lines = CONFIG_FILE.read_text().splitlines() if CONFIG_FILE.exists() else [
        "# JUKEBÜX-Einstellungen – wird vom Einrichtungsassistenten gepflegt.",
        "# Enthält Schlüssel: nicht weitergeben und nicht auf GitHub hochladen!"]
    remaining = dict(updates)
    output = []
    for line in lines:
        stripped = line.strip()
        key = stripped.split("=", 1)[0].strip() if "=" in stripped and not stripped.startswith("#") else None
        if key in remaining:
            value = remaining.pop(key)
            if value is not None:
                output.append(f'{key}="{value}"')
        else:
            output.append(line)
    output += [f'{key}="{value}"' for key, value in remaining.items() if value is not None]
    tmp = CONFIG_FILE.with_suffix(".tmp")
    tmp.write_text("\n".join(output) + "\n")
    tmp.chmod(0o600)
    tmp.replace(CONFIG_FILE)
    apply_config()


apply_config()
MUSIC_DIR = Path(CONFIG.get("MUSIC_DIR") or Path.home() / "Musik" / "Jukebox").expanduser()
MUSIC_DIR.mkdir(parents=True, exist_ok=True)


def app_version():
    try:
        return VERSION_FILE.read_text().strip()
    except OSError:
        return "dev"


app = FastAPI(title="JUKEBÜX")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/music", StaticFiles(directory=str(MUSIC_DIR)), name="music")

SOUND_DIR = Path(__file__).resolve().parent.parent / "sounds"   # ~/jukebox/sounds
SOUND_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/soundfiles", StaticFiles(directory=str(SOUND_DIR)), name="soundfiles")

# ---------- Gespeicherter Zustand (übersteht Neustarts) ----------

DATA_FILE = Path(__file__).parent / "data.json"


def load_data():
    try:
        return json.loads(DATA_FILE.read_text())
    except (OSError, ValueError):
        return {}


_saved = load_data()
queue = _saved.get("queue", [])          # kommende Titel
history = _saved.get("history", [])      # zuletzt gespielt, neuester zuerst
current = _saved.get("current")          # aktuell laufender Titel
favorites = _saved.get("favorites", [])  # Favoritenlisten
sounds = _saved.get("sounds", [])        # Nippelsounds
sound_settings = {"volume": _saved.get("sound_volume", 80)}
# Eigener Hintergrund (versteckt, nur über die Fernbedienung): Bilddatei, Abdunkeln, Weichzeichnen
background = {"file": None, "version": 0, "dim": 55, "blur": 0, **_saved.get("background", {})}
# Webradio: gespeicherte Sender, gewählter Sender, Lückenfüller an/aus
radio = {"stations": [], "station_id": None, "on": False, **_saved.get("radio", {})}
# Nach einem Neustart pausiert starten, damit nicht plötzlich Musik losgeht
playback = {"paused": bool(current), "volume": _saved.get("volume", 80), "position": 0.0, "duration": 0.0}
connections: List[WebSocket] = []


def save_data():
    data = {"version": 1, "queue": queue, "history": history, "current": current,
            "volume": playback["volume"], "favorites": favorites,
            "sounds": sounds, "sound_volume": sound_settings["volume"], "radio": radio,
            "background": background}
    tmp = DATA_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    tmp.replace(DATA_FILE)  # atomar: nie eine halb geschriebene Datei


def load_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def save_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    tmp.replace(path)


# Automatische Mixe: eigene Dateien, damit data.json (wird oft gespeichert) klein bleibt
PLAYS_FILE = Path(__file__).parent / "plays.json"        # Hörprofil
MIXES_FILE = Path(__file__).parent / "mixes.json"        # fertige Mixe + Lückenfüller-Wahl
MIX_CACHE_FILE = Path(__file__).parent / "mixcache.json" # Künstlerinfos + Spotify-Treffer
plays = load_json(PLAYS_FILE, {})
mixes = {"lists": [], "day": None, "updated": None, "filler_id": None, "filler_played": [], "blocked": [],
         **load_json(MIXES_FILE, {})}
mix_status = {"running": False, "progress": None, "error": None}
PLAYS_LIMIT = 3000


class Track(BaseModel):
    title: str
    artist: str = "Unbekannter Interpret"
    source: str = "local"          # local | spotify | youtube | radio
    url: Optional[str] = None      # Audiodatei (lokal) oder Radiostream
    ref: Optional[str] = None      # Spotify-URI, YouTube-Video-ID oder Sender-ID
    image: Optional[str] = None    # Cover-Bild
    album: Optional[str] = None
    duration: Optional[float] = None


class BulkTracks(BaseModel):
    tracks: List[Track]
    next: bool = False   # True = vorne einreihen ("Als Nächstes")


class Move(BaseModel):
    index: int = Field(ge=0)


class ListName(BaseModel):
    name: str = Field(min_length=1, max_length=60, pattern=r"\S")


class Volume(BaseModel):
    volume: int = Field(ge=0, le=100)


class Seek(BaseModel):
    position: float = Field(ge=0)


def state():
    return {"type": "state", "queue": queue, "current": current,
            "history": history, **playback}


SEND_TIMEOUT = 2.0   # Sekunden; wer länger nicht abholt, gilt als "hängend"


async def send_safe(connection, message):
    """An einen Teilnehmer senden, aber nie länger als SEND_TIMEOUT warten."""
    try:
        await asyncio.wait_for(connection.send_json(message), SEND_TIMEOUT)
        return True
    except Exception:
        return False


async def close_quietly(connection):
    try:
        await asyncio.wait_for(connection.close(code=1011), 1)
    except Exception:
        pass


def drop_connection(connection):
    """Hängenden Teilnehmer entfernen (z. B. PC im Standby). Er verbindet sich selbst neu."""
    if connection in connections:
        connections.remove(connection)
        asyncio.create_task(close_quietly(connection))


async def broadcast(message=None, exclude=None):
    if message is None:
        save_data()  # jede Änderung am Wiedergabe-Stand sofort speichern
        schedule_pending()
        message = state()
    targets = [c for c in list(connections) if c is not exclude]
    if not targets:
        return
    # An alle gleichzeitig senden: ein langsamer Teilnehmer bremst die anderen nicht aus
    results = await asyncio.gather(*(send_safe(c, message) for c in targets))
    for connection, ok in zip(targets, results):
        if not ok:
            drop_connection(connection)


def is_radio(track):
    return bool(track) and track.get("source") == "radio"


def record_play(track, skipped):
    """Hörprofil: ab 30 Sekunden (bzw. halber Länge) zählt ein Song als gehört,
    wer früher «Weiter» drückt, überspringt ihn."""
    if not track or is_radio(track) or not track.get("title"):
        return
    position = playback["position"]
    duration = track.get("duration") or playback["duration"] or 0
    heard = position >= 30 or (duration and position >= duration * 0.5)
    if not heard and not skipped:
        return
    key = mixer.song_key(track.get("artist"), track.get("title"))
    entry = plays.setdefault(key, {"count": 0, "skips": 0})
    entry["track"] = {k: track.get(k) for k in ("title", "artist", "album", "source", "url", "ref", "image", "duration")}
    entry["last"] = time.time()
    entry["count" if heard else "skips"] += 1
    if len(plays) > PLAYS_LIMIT:
        now = time.time()
        for old in sorted(plays, key=lambda k: mixer.score_entry(plays[k], now))[:len(plays) - PLAYS_LIMIT]:
            del plays[old]
    save_json(PLAYS_FILE, plays)


def finish_current(skipped=False):
    """Aktuellen Titel in den Verlauf verschieben (Radiosender nicht)."""
    global current
    record_play(current, skipped)
    if current and not is_radio(current):
        history.insert(0, current)
        del history[HISTORY_LIMIT:]
    current = None
    playback.update(paused=False, position=0.0, duration=0.0)


def start(track: dict):
    """Neuen Titel starten, den bisherigen in den Verlauf legen."""
    global current
    finish_current()
    current = {**track, "play_id": str(uuid4())}


def local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))  # es wird nichts gesendet
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def read_tags(path: Path):
    title = artist = album = None
    duration = None
    try:
        audio = File(path, easy=True)
        if audio is not None:
            if audio.tags:
                title = audio.tags.get("title", [None])[0]
                artist = audio.tags.get("artist", [None])[0]
                album = audio.tags.get("album", [None])[0]
            if audio.info:
                duration = round(audio.info.length, 1)
    except Exception:
        pass
    # Ohne Tags: Dateiname "Interpret - Titel.mp3" auswerten
    if (not title or not artist) and " - " in path.stem:
        name_artist, name_title = path.stem.split(" - ", 1)
        artist = artist or name_artist.strip()
        title = title or name_title.strip()
    return {
        "title": str(title or path.stem),
        "artist": str(artist or "Unbekannter Interpret"),
        "album": album,
        "duration": duration,
    }


def scan_library():
    tracks = []
    for path in sorted(MUSIC_DIR.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {".mp3", ".flac"}:
            continue
        relative_path = path.relative_to(MUSIC_DIR).as_posix()
        tracks.append({
            "id": relative_path,
            **read_tags(path),
            "source": "local",
            "url": "/music/" + quote(relative_path, safe="/"),
        })
    return tracks


# ---------- YouTube ----------

_youtube_cache = {}
YOUTUBE_CACHE_SECONDS = 3600


def youtube_get(endpoint, params):
    query = urllib.parse.urlencode({**params, "key": YOUTUBE_API_KEY})
    url = f"https://www.googleapis.com/youtube/v3/{endpoint}?{query}"
    with urllib.request.urlopen(url, timeout=8) as response:
        return json.load(response)


def parse_duration(value):
    """YouTube-Dauer wie PT4M13S in Sekunden umrechnen."""
    match = re.fullmatch(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", value or "")
    if not match:
        return None
    d, h, m, sec = (int(x or 0) for x in match.groups())
    return d * 86400 + h * 3600 + m * 60 + sec


NOISE = re.compile(
    r"\s*[\(\[][^)\]]*(official|video|audio|lyric|visuali[sz]er|hd|4k|mv|clip)[^)\]]*[\)\]]",
    re.IGNORECASE,
)


def split_title(raw_title, channel):
    """'Interpret - Titel (Official Video)' in Titel und Interpret zerlegen."""
    title = NOISE.sub("", html.unescape(raw_title)).strip()
    artist = re.sub(r"(\s*-\s*Topic|VEVO)$", "", html.unescape(channel)).strip()
    if " - " in title:
        name_artist, name_title = title.split(" - ", 1)
        return name_title.strip(), name_artist.strip()
    return title, artist


YT_VIDEO_ID = re.compile(r"(?:[?&]v=|youtu\.be/|/shorts/|/embed/|/live/)([A-Za-z0-9_-]{11})")
YT_PLAYLIST_ID = re.compile(r"[?&]list=([A-Za-z0-9_-]{10,})")


def youtube_error_message(error):
    if isinstance(error, urllib.error.HTTPError):
        body = error.read().decode(errors="ignore")
        if "quota" in body.lower():
            return "Das YouTube-Tageskontingent ist aufgebraucht. Ab ca. 9 Uhr morgens geht es wieder."
        if error.code == 404:
            return "Bei YouTube nicht gefunden – ist die Playlist privat?"
        if error.code in (400, 403):
            return "YouTube hat die Anfrage abgelehnt (API-Schlüssel in der Einrichtung prüfen)."
        return f"YouTube-Fehler {error.code}"
    return "YouTube ist gerade nicht erreichbar."


def youtube_track_from_video(video):
    """Ein Video aus videos.list in das Jukebox-Format umwandeln."""
    snippet = video.get("snippet", {})
    title, artist = split_title(snippet.get("title", ""), snippet.get("channelTitle", ""))
    thumbs = snippet.get("thumbnails", {})
    image = (thumbs.get("medium") or thumbs.get("high") or thumbs.get("default") or {}).get("url")
    return {
        "id": f"yt:{video['id']}",
        "title": title,
        "artist": artist,
        "source": "youtube",
        "ref": video["id"],
        "image": image,
        "duration": parse_duration(video.get("contentDetails", {}).get("duration")),
    }


def youtube_videos(ids):
    """Details zu Videos (je 50 pro Abfrage = 1 Einheit), nur einbettbare."""
    found = {}
    for i in range(0, len(ids), 50):
        data = youtube_get("videos", {"part": "snippet,contentDetails,status",
                                      "id": ",".join(ids[i:i + 50]), "maxResults": 50})
        for video in data.get("items", []):
            status = video.get("status", {})
            if status.get("embeddable", True) and status.get("privacyStatus") != "private":
                found[video["id"]] = youtube_track_from_video(video)
    return [found[v] for v in ids if v in found]


def youtube_search(q):
    if not YOUTUBE_API_KEY:
        return None  # nicht eingerichtet
    # Ein eingefügter Video-Link wird direkt nachgeschlagen (1 statt 100 Einheiten)
    video_link = YT_VIDEO_ID.search(q)
    if video_link:
        try:
            return youtube_videos([video_link.group(1)])
        except Exception as error:
            return {"error": youtube_error_message(error)}
    cache_key = q.lower().strip()
    cached = _youtube_cache.get(cache_key)
    if cached and time.time() - cached[0] < YOUTUBE_CACHE_SECONDS:
        return cached[1]
    try:
        data = youtube_get("search", {
            "part": "snippet", "type": "video", "videoEmbeddable": "true",
            "maxResults": 15, "q": q,
        })
        items = [i for i in data.get("items", []) if i.get("id", {}).get("videoId")]
        ids = [i["id"]["videoId"] for i in items]
        durations = {}
        if ids:
            details = youtube_get("videos", {"part": "contentDetails", "id": ",".join(ids)})
            durations = {v["id"]: parse_duration(v["contentDetails"]["duration"])
                         for v in details.get("items", [])}
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="ignore")
        if "quota" in body.lower():
            return {"error": "Das YouTube-Tageskontingent ist aufgebraucht. Ab ca. 9 Uhr morgens geht es wieder."}
        if error.code in (400, 403):
            return {"error": "YouTube hat den API-Schlüssel abgelehnt. Bitte in der Einrichtung prüfen."}
        return {"error": f"YouTube-Fehler {error.code}"}
    except Exception:
        return {"error": "YouTube ist gerade nicht erreichbar."}

    results = []
    for item in items:
        snippet = item["snippet"]
        video_id = item["id"]["videoId"]
        title, artist = split_title(snippet.get("title", ""), snippet.get("channelTitle", ""))
        thumbs = snippet.get("thumbnails", {})
        image = (thumbs.get("medium") or thumbs.get("high") or thumbs.get("default") or {}).get("url")
        results.append({
            "id": f"yt:{video_id}",
            "title": title,
            "artist": artist,
            "source": "youtube",
            "ref": video_id,
            "image": image,
            "duration": durations.get(video_id),
        })
    _youtube_cache[cache_key] = (time.time(), results)
    return results


@app.get("/api/health")
def health():
    return {"message": "JUKEBÜX läuft!", "status": "online", "version": app_version(), "copyright": COPYRIGHT}


@app.get("/api/info")
def info():
    ip = local_ip()
    return {
        "ip": ip,
        "remote_url": f"http://{ip}:{PORT}/remote",
        "youtube": bool(YOUTUBE_API_KEY),
        "spotify": spotify_configured(),
        "name": CONFIG.get("JUKEBOX_NAME") or DEFAULT_NAME,
        "subtitle": CONFIG.get("JUKEBOX_SUBTITLE") or "",
        "skin": current_skin(),
        "music_dir": str(MUSIC_DIR),
        "setup_open": setup["open"],
        "version": app_version(),
    }


@app.get("/api/state")
def get_state():
    return state()


# ---------- Warteschlange ----------

@app.get("/api/queue")
def get_queue():
    return queue


def next_or_none(iterator):
    for item in iterator:
        return item
    return None


def same_track(a, b):
    key = lambda t: (t.get("source"), t.get("ref") or t.get("url") or t.get("title"))
    return key(a) == key(b)


@app.post("/api/queue")
async def add_track(track: Track, next: bool = False):
    data = track.model_dump()
    # Doppelte Wünsche erkennen
    if current and same_track(current, data):
        return {"status": "playing"}
    existing = next_or_none(t for t in queue if same_track(t, data))
    if existing:
        position = queue.index(existing) + 1
        if not next or position == 1:
            return {"status": "duplicate", "position": position}
        # "Als Nächstes" bei einem Titel, der schon wartet: nach vorne holen
        queue.remove(existing)
        queue.insert(0, existing)
        await broadcast()
        return {"status": "moved", "from": position}
    item = {"id": str(uuid4()), **data}
    if next:
        queue.insert(0, item)
    else:
        queue.append(item)
    interrupt_radio()
    await broadcast()
    return {"status": "added", **item}


@app.post("/api/queue/bulk")
async def add_tracks(body: BulkTracks):
    items, skipped = [], 0
    for t in body.tracks:
        data = t.model_dump()
        if (current and same_track(current, data)) or any(same_track(q, data) for q in queue + items):
            skipped += 1
            continue
        items.append({"id": str(uuid4()), **data})
    if body.next:
        queue[0:0] = items
    else:
        queue.extend(items)
    interrupt_radio()
    await broadcast()
    return {"added": len(items), "skipped": skipped}


@app.post("/api/queue/{track_id}/move")
async def move_track(track_id: str, body: Move):
    track = next((t for t in queue if t["id"] == track_id), None)
    if not track:
        raise HTTPException(status_code=404, detail="Titel nicht in der Warteschlange")
    queue.remove(track)
    queue.insert(min(body.index, len(queue)), track)
    await broadcast()
    return {"status": "moved"}


@app.delete("/api/queue/{track_id}")
async def delete_track(track_id: str):
    global queue
    queue = [track for track in queue if track["id"] != track_id]
    await broadcast()
    return {"status": "deleted"}


@app.post("/api/queue/{track_id}/play")
async def play_from_queue(track_id: str):
    track = next((t for t in queue if t["id"] == track_id), None)
    if not track:
        raise HTTPException(status_code=404, detail="Titel nicht in der Warteschlange")
    queue.remove(track)
    start(track)
    await broadcast()
    return state()


# ---------- Wiedergabe-Steuerung ----------

@app.post("/api/play")
async def play_direct(track: Track):
    start({"id": str(uuid4()), **track.model_dump()})
    await broadcast()
    return state()


async def advance(skipped):
    if is_radio(current) and not queue:
        switch_station(+1)   # im Radio: «Weiter» = nächster Sender
    else:
        finish_current(skipped)
        if queue:
            start(queue.pop(0))
        else:
            radio_fill()     # Warteschlange leer: Radio oder Mix übernimmt (falls eingeschaltet)
    await broadcast()
    return state()


@app.post("/api/next")
async def next_track():
    return await advance(skipped=True)


@app.post("/api/ended/{play_id}")
async def track_ended(play_id: str):
    # Nur weiterschalten, wenn wirklich der aktuelle Titel zu Ende ist.
    # Ein Radiostream «endet» nicht – der Player verbindet sich selbst neu.
    if current and current.get("play_id") == play_id and not is_radio(current):
        return await advance(skipped=False)
    return state()


@app.post("/api/previous")
async def previous_track():
    global current
    if is_radio(current):
        switch_station(-1)   # im Radio: «Zurück» = vorheriger Sender
        await broadcast()
        return state()
    if playback["position"] > 3 or not history:
        return await seek(Seek(position=0))
    if current:
        queue.insert(0, current)
        current = None
    start(history.pop(0))
    await broadcast()
    return state()


@app.post("/api/toggle")
async def toggle():
    if current:
        playback["paused"] = not playback["paused"]
        await broadcast()
        return state()
    if queue or radio["on"] or mixes["filler_id"]:
        return await advance(skipped=False)
    return state()


@app.post("/api/volume")
async def set_volume(body: Volume):
    playback["volume"] = body.volume
    await broadcast()
    return state()


@app.post("/api/seek")
async def seek(body: Seek):
    playback["position"] = body.position
    await broadcast({"type": "seek", "position": body.position})
    return state()


# ---------- Spotify ----------

SPOTIFY_REDIRECT_URI = "http://127.0.0.1:8000/api/spotify/callback"
SPOTIFY_SCOPES = ("streaming user-read-email user-read-private "
                  "user-read-playback-state user-modify-playback-state "
                  "playlist-read-private playlist-read-collaborative user-library-read")
SPOTIFY_TOKEN_FILE = Path(__file__).parent / "spotify_token.json"
_spotify_states = set()


def spotify_configured():
    return bool(SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET)


def load_spotify_token():
    try:
        return json.loads(SPOTIFY_TOKEN_FILE.read_text())
    except (OSError, ValueError):
        return None


def save_spotify_token(token):
    SPOTIFY_TOKEN_FILE.write_text(json.dumps(token))
    SPOTIFY_TOKEN_FILE.chmod(0o600)


def spotify_token_request(data):
    credentials = base64.b64encode(f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()).decode()
    request = urllib.request.Request(
        "https://accounts.spotify.com/api/token",
        data=urllib.parse.urlencode(data).encode(),
        headers={"Authorization": f"Basic {credentials}",
                 "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.load(response)


def spotify_access_token(force_refresh=False):
    """Gültiges Zugriffstoken liefern, bei Bedarf automatisch erneuern."""
    token = load_spotify_token()
    if not token:
        return None
    if force_refresh or time.time() > token.get("expires_at", 0) - 60:
        try:
            new = spotify_token_request({"grant_type": "refresh_token",
                                         "refresh_token": token["refresh_token"]})
        except urllib.error.HTTPError as error:
            if error.code in (400, 401):  # Anmeldung widerrufen -> neu verbinden
                SPOTIFY_TOKEN_FILE.unlink(missing_ok=True)
                return None
            raise
        token["access_token"] = new["access_token"]
        token["expires_at"] = time.time() + new.get("expires_in", 3600)
        if new.get("refresh_token"):
            token["refresh_token"] = new["refresh_token"]
        save_spotify_token(token)
    return token


def spotify_api(path, params=None):
    for attempt in range(2):
        token = spotify_access_token(force_refresh=attempt > 0)
        if not token:
            raise PermissionError("nicht verbunden")
        url = "https://api.spotify.com/v1" + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token['access_token']}"})
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 401 and attempt == 0:
                continue  # Token abgelaufen -> erneuern und nochmals versuchen
            raise


def spotify_image(images):
    """Mittelgrosses Cover (ca. 300 px) aus einer Spotify-Bildliste wählen."""
    if not images:
        return None
    return (images[1] if len(images) > 1 else images[0])["url"]


def spotify_track(item, album=None):
    """Spotify-Titel in das Jukebox-Format umwandeln."""
    if not item or item.get("type", "track") != "track" or item.get("is_local") or not item.get("id"):
        return None
    album = item.get("album") or album or {}
    return {
        "id": f"sp:{item['id']}",
        "title": item["name"],
        "artist": ", ".join(a["name"] for a in item.get("artists", [])),
        "album": album.get("name"),
        "source": "spotify",
        "ref": item["uri"],
        "image": spotify_image(album.get("images")),
        "duration": round(item.get("duration_ms", 0) / 1000),
    }


def spotify_error_message(error):
    if isinstance(error, PermissionError):
        return "Spotify ist nicht verbunden. Bitte am Jukebox-Bildschirm unten links anmelden."
    if isinstance(error, urllib.error.HTTPError):
        if error.code == 403:
            return "Spotify verweigert den Zugriff auf diesen Inhalt."
        if error.code == 404:
            return "Bei Spotify nicht gefunden."
        if error.code == 429:
            return "Zu viele Anfragen an Spotify – bitte einen Moment warten."
        return f"Spotify-Fehler {error.code}"
    return "Spotify ist gerade nicht erreichbar."


def spotify_search(q):
    """Liefert (Titel, Alben)."""
    if not spotify_configured():
        return None, None  # nicht eingerichtet
    if not load_spotify_token():
        message = {"error": "Spotify ist noch nicht verbunden. Bitte am Jukebox-Bildschirm unten links anmelden."}
        return message, []
    try:
        data = spotify_api("/search", {"q": q, "type": "track,album", "limit": 10})
    except urllib.error.HTTPError as error:
        if error.code == 403:
            return {"error": "Spotify verweigert den Zugriff. Ist dein Konto im Developer Dashboard unter „User Management“ eingetragen?"}, []
        return {"error": spotify_error_message(error)}, []
    except Exception as error:
        return {"error": spotify_error_message(error)}, []

    tracks = [t for t in (spotify_track(i) for i in data.get("tracks", {}).get("items", [])) if t]
    albums = []
    for album in data.get("albums", {}).get("items", []):
        if not album:
            continue
        albums.append({
            "id": album["id"],
            "name": album["name"],
            "artist": ", ".join(a["name"] for a in album.get("artists", [])),
            "image": spotify_image(album.get("images")),
            "year": (album.get("release_date") or "")[:4],
            "type": album.get("album_type"),
        })
    return tracks, albums


def spotify_collect(path, params, extract, max_items=500, start=0):
    """Seitenweise abrufen (je 50), bis alles da ist oder max_items erreicht."""
    tracks, offset = [], start
    while offset < max_items:
        page = spotify_api(path, {**params, "limit": 50, "offset": offset})
        items = page.get("items", [])
        for entry in items:
            track = extract(entry)
            if track:
                tracks.append(track)
        if not page.get("next") or not items:
            break
        offset += len(items)
    return tracks


def spotify_endpoint(func):
    """Spotify-Fehler in verständliche Meldungen übersetzen."""
    try:
        return func()
    except Exception as error:
        status = 401 if isinstance(error, PermissionError) else 502
        if isinstance(error, urllib.error.HTTPError) and error.code in (403, 404, 429):
            status = error.code
        raise HTTPException(status, spotify_error_message(error))


@app.get("/api/spotify/playlists")
def spotify_playlists():
    def load():
        token = load_spotify_token() or {}
        my_id = token.get("user_id")
        playlists, offset = [], 0
        while offset < 300:
            page = spotify_api("/me/playlists", {"limit": 50, "offset": offset})
            items = [p for p in page.get("items", []) if p]
            for p in items:
                count = (p.get("items") or p.get("tracks") or {}).get("total")
                playlists.append({
                    "id": p["id"],
                    "name": p["name"],
                    "image": spotify_image(p.get("images")),
                    "total": count,
                    "owner": (p.get("owner") or {}).get("display_name"),
                    # Inhalte gibt Spotify nur für eigene/gemeinsame Playlists frei
                    "available": p.get("collaborative") or (p.get("owner") or {}).get("id") == my_id,
                })
            if not page.get("next") or not items:
                break
            offset += len(items)
        return playlists
    return spotify_endpoint(load)


@app.get("/api/spotify/playlists/{playlist_id}")
def spotify_playlist(playlist_id: str):
    def load():
        info = spotify_api(f"/playlists/{quote(playlist_id)}", {"fields": "name,images,owner(display_name)"})
        tracks = spotify_collect(
            f"/playlists/{quote(playlist_id)}/items", {"additional_types": "track"},
            lambda entry: spotify_track(entry.get("item") or entry.get("track")),
        )
        return {"name": info.get("name"), "image": spotify_image(info.get("images")),
                "subtitle": f"Playlist von {(info.get('owner') or {}).get('display_name', '?')}",
                "tracks": tracks}
    return spotify_endpoint(load)


@app.get("/api/spotify/saved")
def spotify_saved():
    def load():
        tracks = spotify_collect("/me/tracks", {}, lambda entry: spotify_track(entry.get("track") or entry.get("item")))
        return {"name": "Lieblingssongs", "image": None, "subtitle": "Deine gespeicherten Songs", "tracks": tracks}
    return spotify_endpoint(load)


@app.get("/api/spotify/albums/{album_id}")
def spotify_album(album_id: str):
    def load():
        album = spotify_api(f"/albums/{quote(album_id)}")
        tracks = [t for t in (spotify_track(i, album) for i in album.get("tracks", {}).get("items", [])) if t]
        if album.get("tracks", {}).get("next"):
            tracks += spotify_collect(f"/albums/{quote(album_id)}/tracks", {},
                                      lambda item: spotify_track(item, album), start=50)
        artist = ", ".join(a["name"] for a in album.get("artists", []))
        year = (album.get("release_date") or "")[:4]
        return {"name": album.get("name"), "image": spotify_image(album.get("images")),
                "subtitle": f"{artist} · {year}" if year else artist, "tracks": tracks}
    return spotify_endpoint(load)


def is_local(request: Request):
    return request.client and request.client.host in ("127.0.0.1", "::1", "localhost")


@app.get("/api/spotify/status")
def spotify_status():
    token = load_spotify_token()
    granted = set((token or {}).get("scope", "").split())
    return {
        "configured": spotify_configured(),
        "connected": bool(token),
        "user": token.get("user") if token else None,
        # Neue Funktionen brauchen zusätzliche Berechtigungen -> einmal neu verbinden
        "needs_reconnect": bool(token) and not set(SPOTIFY_SCOPES.split()) <= granted,
    }


@app.get("/api/spotify/login")
def spotify_login():
    if not spotify_configured():
        raise HTTPException(400, "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET fehlen – bitte zuerst die Einrichtung abschliessen")
    state = secrets.token_urlsafe(16)
    _spotify_states.add(state)
    query = urllib.parse.urlencode({
        "client_id": SPOTIFY_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": SPOTIFY_REDIRECT_URI,
        "scope": SPOTIFY_SCOPES,
        "state": state,
        "show_dialog": "true",
    })
    return RedirectResponse(f"https://accounts.spotify.com/authorize?{query}")


@app.get("/api/spotify/callback")
def spotify_callback(code: str = "", state: str = "", error: str = ""):
    frontend = f"http://localhost:{PORT}/"
    if error or not code or state not in _spotify_states:
        return RedirectResponse(frontend + "?spotify=error")
    _spotify_states.discard(state)
    try:
        data = spotify_token_request({"grant_type": "authorization_code", "code": code,
                                      "redirect_uri": SPOTIFY_REDIRECT_URI})
    except Exception:
        return RedirectResponse(frontend + "?spotify=error")
    save_spotify_token({
        "access_token": data["access_token"],
        "refresh_token": data["refresh_token"],
        "expires_at": time.time() + data.get("expires_in", 3600),
        "scope": data.get("scope", ""),
    })
    try:
        me = spotify_api("/me")
        token = load_spotify_token()
        token["user"] = me.get("display_name") or me.get("id")
        token["user_id"] = me.get("id")
        save_spotify_token(token)
    except Exception:
        pass
    return RedirectResponse(frontend + "?spotify=connected")


@app.get("/api/spotify/token")
def spotify_player_token(request: Request):
    # Nur das Surface selbst bekommt das Token für den Spotify-Player
    if not is_local(request):
        raise HTTPException(403, "Nur direkt am Jukebox-Gerät erlaubt")
    token = spotify_access_token()
    if not token:
        raise HTTPException(404, "Spotify ist nicht verbunden")
    return {"access_token": token["access_token"],
            "expires_in": int(token["expires_at"] - time.time())}


@app.post("/api/spotify/logout")
def spotify_logout(request: Request):
    if not is_local(request):
        raise HTTPException(403, "Nur direkt am Jukebox-Gerät erlaubt")
    SPOTIFY_TOKEN_FILE.unlink(missing_ok=True)
    return {"status": "logged out"}


# ---------- Bibliothek & Suche ----------

_playlist_cache = {}


@app.get("/api/youtube/playlist/{playlist_id}")
def youtube_playlist(playlist_id: str):
    if not YOUTUBE_API_KEY:
        raise HTTPException(400, "YouTube ist nicht eingerichtet.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,}", playlist_id):
        raise HTTPException(400, "Ungültige Playlist-ID.")
    cached = _playlist_cache.get(playlist_id)
    if cached and time.time() - cached[0] < YOUTUBE_CACHE_SECONDS:
        return cached[1]
    try:
        meta = youtube_get("playlists", {"part": "snippet", "id": playlist_id})
        if not meta.get("items"):
            raise HTTPException(404, "Playlist nicht gefunden. Private Playlists und YouTube-Mixe gibt YouTube nicht heraus.")
        snippet = meta["items"][0]["snippet"]
        ids, page_token = [], None
        while len(ids) < 200:
            params = {"part": "contentDetails", "playlistId": playlist_id, "maxResults": 50}
            if page_token:
                params["pageToken"] = page_token
            page = youtube_get("playlistItems", params)
            ids += [i["contentDetails"]["videoId"] for i in page.get("items", []) if i.get("contentDetails", {}).get("videoId")]
            page_token = page.get("nextPageToken")
            if not page_token:
                break
        tracks = youtube_videos(ids)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(502, youtube_error_message(error))
    thumbs = snippet.get("thumbnails", {})
    skipped = len(ids) - len(tracks)
    result = {
        "name": snippet.get("title"),
        "image": (thumbs.get("medium") or thumbs.get("high") or thumbs.get("default") or {}).get("url"),
        "subtitle": f"YouTube-Playlist von {snippet.get('channelTitle', '?')}"
                    + (f" · {skipped} nicht abspielbar" if skipped else ""),
        "tracks": tracks,
    }
    _playlist_cache[playlist_id] = (time.time(), result)
    return result


# ---------- Favoriten ----------

def find_list(list_id):
    found = next((f for f in favorites if f["id"] == list_id), None)
    if not found:
        raise HTTPException(404, "Favoritenliste nicht gefunden")
    return found


def track_key(track):
    return (track.get("source"), track.get("ref") or track.get("url") or track.get("title"))


async def broadcast_favorites():
    save_data()
    await broadcast({"type": "favorites", "lists": favorites})


@app.get("/api/favorites")
def get_favorites():
    return favorites


@app.post("/api/favorites")
async def create_list(body: ListName):
    new = {"id": str(uuid4()), "name": body.name.strip(), "tracks": []}
    favorites.append(new)
    await broadcast_favorites()
    return new


@app.patch("/api/favorites/{list_id}")
async def rename_list(list_id: str, body: ListName):
    find_list(list_id)["name"] = body.name.strip()
    await broadcast_favorites()
    return {"status": "renamed"}


@app.delete("/api/favorites/{list_id}")
async def delete_list(list_id: str):
    favorites.remove(find_list(list_id))
    await broadcast_favorites()
    return {"status": "deleted"}


@app.post("/api/favorites/{list_id}/tracks")
async def add_favorite(list_id: str, track: Track):
    fav = find_list(list_id)
    data = track.model_dump()
    if any(track_key(t) == track_key(data) for t in fav["tracks"]):
        return {"status": "exists"}
    fav["tracks"].append({"id": str(uuid4()), **data})
    await broadcast_favorites()
    return {"status": "added"}


@app.delete("/api/favorites/{list_id}/tracks/{track_id}")
async def remove_favorite(list_id: str, track_id: str):
    fav = find_list(list_id)
    fav["tracks"] = [t for t in fav["tracks"] if t["id"] != track_id]
    await broadcast_favorites()
    return {"status": "deleted"}


@app.post("/api/favorites/{list_id}/tracks/{track_id}/move")
async def move_favorite(list_id: str, track_id: str, body: Move):
    fav = find_list(list_id)
    track = next((t for t in fav["tracks"] if t["id"] == track_id), None)
    if not track:
        raise HTTPException(404, "Titel nicht in der Liste")
    fav["tracks"].remove(track)
    fav["tracks"].insert(min(body.index, len(fav["tracks"])), track)
    await broadcast_favorites()
    return {"status": "moved"}


# ---------- Nippelsounds (Soundboard) ----------

SOUND_TYPES = {".mp3", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".opus", ".webm", ".flac"}
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_SOUND_BYTES = 8 * 1024 * 1024   # 8 MB
MAX_IMAGE_BYTES = 3 * 1024 * 1024   # 3 MB
COLOR = r"^#[0-9a-fA-F]{6}$"


class SoundInfo(BaseModel):
    name: str = Field(min_length=1, max_length=40, pattern=r"\S")
    color: str = Field(default="#e0242a", pattern=COLOR)


def sounds_message():
    return {"type": "sounds", "sounds": sounds, "volume": sound_settings["volume"]}


async def broadcast_sounds():
    save_data()
    await broadcast(sounds_message())


def find_sound(sound_id):
    found = next((s for s in sounds if s["id"] == sound_id), None)
    if not found:
        raise HTTPException(404, "Sound nicht gefunden")
    return found


def file_suffix(filename, allowed, label):
    suffix = Path(filename or "").suffix.lower()
    if suffix not in allowed:
        raise HTTPException(400, f"{label}: erlaubt sind {', '.join(sorted(allowed))}")
    return suffix


async def read_upload(request: Request, limit, label):
    body = await request.body()
    if not body:
        raise HTTPException(400, f"{label}: Datei ist leer")
    if len(body) > limit:
        raise HTTPException(413, f"{label}: höchstens {limit // (1024 * 1024)} MB")
    return body


def require_remote(request: Request):
    """Sounds verwalten nur über die Fernbedienung an einem PC, nicht am Surface selbst."""
    if is_local(request):
        raise HTTPException(403, "Sounds bitte über die Fernbedienung an einem PC verwalten.")


def remove_file(name):
    if name:
        (SOUND_DIR / name).unlink(missing_ok=True)


@app.get("/api/sounds")
def get_sounds():
    return sounds_message()


@app.post("/api/sounds")
async def create_sound(request: Request, name: str, color: str = "#e0242a", filename: str = ""):
    """Neuer Sound: Audiodatei als Rohdaten im Body, Name/Farbe/Dateiname als Parameter."""
    require_remote(request)
    try:
        info = SoundInfo(name=name.strip(), color=color)
    except ValueError:
        raise HTTPException(400, "Name (1–40 Zeichen) oder Farbe ungültig")
    suffix = file_suffix(filename, SOUND_TYPES, "Ton")
    body = await read_upload(request, MAX_SOUND_BYTES, "Ton")
    sound_id = str(uuid4())
    (SOUND_DIR / f"{sound_id}{suffix}").write_bytes(body)
    sound = {"id": sound_id, "name": info.name, "color": info.color,
             "file": f"{sound_id}{suffix}", "image": None, "created": time.time()}
    sounds.append(sound)
    await broadcast_sounds()
    return sound


@app.patch("/api/sounds/{sound_id}")
async def update_sound(sound_id: str, info: SoundInfo, request: Request):
    require_remote(request)
    sound = find_sound(sound_id)
    sound["name"], sound["color"] = info.name.strip(), info.color
    await broadcast_sounds()
    return sound


@app.put("/api/sounds/{sound_id}/file")
async def replace_sound_file(sound_id: str, request: Request, filename: str = ""):
    require_remote(request)
    sound = find_sound(sound_id)
    suffix = file_suffix(filename, SOUND_TYPES, "Ton")
    body = await read_upload(request, MAX_SOUND_BYTES, "Ton")
    new_name = f"{sound_id}-{int(time.time())}{suffix}"
    (SOUND_DIR / new_name).write_bytes(body)
    remove_file(sound["file"])
    sound["file"] = new_name
    await broadcast_sounds()
    return sound


@app.put("/api/sounds/{sound_id}/image")
async def set_sound_image(sound_id: str, request: Request, filename: str = ""):
    require_remote(request)
    sound = find_sound(sound_id)
    suffix = file_suffix(filename, IMAGE_TYPES, "Bild")
    body = await read_upload(request, MAX_IMAGE_BYTES, "Bild")
    new_name = f"{sound_id}-img-{int(time.time())}{suffix}"
    (SOUND_DIR / new_name).write_bytes(body)
    remove_file(sound.get("image"))
    sound["image"] = new_name
    await broadcast_sounds()
    return sound


@app.delete("/api/sounds/{sound_id}/image")
async def delete_sound_image(sound_id: str, request: Request):
    require_remote(request)
    sound = find_sound(sound_id)
    remove_file(sound.get("image"))
    sound["image"] = None
    await broadcast_sounds()
    return sound


@app.delete("/api/sounds/{sound_id}")
async def delete_sound(sound_id: str, request: Request):
    require_remote(request)
    sound = find_sound(sound_id)
    sounds.remove(sound)
    remove_file(sound["file"])
    remove_file(sound.get("image"))
    await broadcast_sounds()
    return {"status": "deleted"}


@app.post("/api/sounds/{sound_id}/play")
async def play_sound(sound_id: str):
    # Abgespielt wird auf dem Surface – egal, wo der Knopf gedrückt wurde
    sound = find_sound(sound_id)
    await broadcast({"type": "sound-play", "id": sound["id"], "file": sound["file"], "nonce": str(uuid4())})
    return {"status": "playing"}


@app.post("/api/sounds/stop")
async def stop_sounds():
    await broadcast({"type": "sound-stop"})
    return {"status": "stopped"}


@app.post("/api/sounds/volume")
async def set_sound_volume(body: Volume):
    sound_settings["volume"] = body.volume
    await broadcast_sounds()
    return sounds_message()


# ---------- Soundboard exportieren / importieren ----------
# Format: ZIP mit soundboard.json (Name, Farbe, Dateien) und den Ton- und Bilddateien.
# Ein ZIP ohne soundboard.json geht auch: dann wird jede Audiodatei ein Sound (Name = Dateiname).

SOUNDBOARD_FORMAT = "jukebuex-soundboard"
MAX_IMPORT_BYTES = 300 * 1024 * 1024        # hochgeladenes ZIP
MAX_IMPORT_UNPACKED = 600 * 1024 * 1024     # Summe aller entpackten Dateien (Schutz vor ZIP-Bomben)
MAX_IMPORT_SOUNDS = 500


def safe_file_part(name):
    return re.sub(r"[^A-Za-z0-9äöüÄÖÜéèàß_-]+", "-", name).strip("-")[:40] or "sound"


@app.get("/api/sounds/export")
def export_sounds():
    """Alle Sounds als ZIP herunterladen."""
    tmp = tempfile.NamedTemporaryFile(prefix="soundboard-", suffix=".zip", delete=False)
    tmp.close()
    entries = []
    with zipfile.ZipFile(tmp.name, "w", zipfile.ZIP_DEFLATED) as archive:
        ordered = sorted(sounds, key=lambda x: x["name"].lower())
        for index, sound in enumerate(ordered, 1):
            source = SOUND_DIR / sound["file"]
            if not source.is_file():
                continue
            base = f"{index:03d}-{safe_file_part(sound['name'])}"
            entry = {"name": sound["name"], "color": sound["color"],
                     "file": f"sounds/{base}{source.suffix.lower()}", "image": None}
            # Audio ist meist schon komprimiert -> nur speichern, nicht nochmals packen
            archive.write(source, entry["file"], compress_type=zipfile.ZIP_STORED)
            image = SOUND_DIR / sound["image"] if sound.get("image") else None
            if image and image.is_file():
                entry["image"] = f"images/{base}{image.suffix.lower()}"
                archive.write(image, entry["image"], compress_type=zipfile.ZIP_STORED)
            entries.append(entry)
        archive.writestr("soundboard.json", json.dumps(
            {"format": SOUNDBOARD_FORMAT, "version": 1, "app_version": app_version(),
             "exported": time.strftime("%Y-%m-%dT%H:%M:%S"), "volume": sound_settings["volume"],
             "sounds": entries}, ensure_ascii=False, indent=2))
    filename = f"soundboard-{time.strftime('%Y-%m-%d')}.zip"
    return FileResponse(tmp.name, media_type="application/zip", filename=filename,
                        background=BackgroundTask(os.unlink, tmp.name))


@app.post("/api/sounds/import")
async def import_sounds(request: Request):
    """ZIP aus dem Export (oder einfach ein ZIP voller Audiodateien) hinzufügen.
    Sounds mit einem Namen, den es schon gibt, werden übersprungen."""
    require_remote(request)
    body = await read_upload(request, MAX_IMPORT_BYTES, "Import")
    try:
        archive = zipfile.ZipFile(io.BytesIO(body))
    except zipfile.BadZipFile:
        raise HTTPException(400, "Das ist keine gültige ZIP-Datei.")
    with archive:
        infos = {i.filename: i for i in archive.infolist() if not i.is_dir()}
        if sum(i.file_size for i in infos.values()) > MAX_IMPORT_UNPACKED:
            raise HTTPException(413, "Der Inhalt des ZIP ist zu gross.")

        # Liste der Sounds bestimmen
        if "soundboard.json" in infos:
            try:
                meta = json.loads(archive.read("soundboard.json"))
                wanted = [e for e in meta.get("sounds", []) if isinstance(e, dict)]
            except ValueError:
                raise HTTPException(400, "soundboard.json ist beschädigt.")
        else:
            wanted = [{"name": Path(n).stem.replace("_", " ")[:40], "file": n, "image": None}
                      for n in sorted(infos) if Path(n).suffix.lower() in SOUND_TYPES
                      and not Path(n).name.startswith(".") and "__MACOSX" not in n]
        if not wanted:
            raise HTTPException(400, "Im ZIP wurden keine Sounds gefunden.")

        existing = {s["name"].strip().lower() for s in sounds}
        added, skipped, failed = 0, [], []
        for entry in wanted[:MAX_IMPORT_SOUNDS]:
            name = str(entry.get("name") or "").strip()[:40]
            color = entry.get("color") if re.match(COLOR, str(entry.get("color") or "")) else "#e0242a"
            file_info = infos.get(str(entry.get("file") or ""))
            if not name or not file_info or Path(file_info.filename).suffix.lower() not in SOUND_TYPES \
                    or file_info.file_size > MAX_SOUND_BYTES or file_info.file_size == 0:
                failed.append(name or str(entry.get("file")))
                continue
            if name.lower() in existing:
                skipped.append(name)
                continue
            sound_id = str(uuid4())
            suffix = Path(file_info.filename).suffix.lower()
            (SOUND_DIR / f"{sound_id}{suffix}").write_bytes(archive.read(file_info))
            image_name = None
            image_info = infos.get(str(entry.get("image") or ""))
            if image_info and Path(image_info.filename).suffix.lower() in IMAGE_TYPES \
                    and 0 < image_info.file_size <= MAX_IMAGE_BYTES:
                image_name = f"{sound_id}-img{Path(image_info.filename).suffix.lower()}"
                (SOUND_DIR / image_name).write_bytes(archive.read(image_info))
            sounds.append({"id": sound_id, "name": name, "color": color, "file": f"{sound_id}{suffix}",
                           "image": image_name, "created": time.time()})
            existing.add(name.lower())
            added += 1
    if added:
        await broadcast_sounds()
    return {"added": added, "skipped": skipped, "failed": failed}


# ---------- Farbe aus dem Cover (für die Hintergrundfarbe der Oberfläche) ----------

COVER_HOSTS = (".scdn.co", ".spotifycdn.com", ".ytimg.com")
_color_cache = {}


def vibrant_color(data):
    """Eine kräftige, gut lesbare Farbe aus einem Bild bestimmen."""
    from PIL import Image  # nur hier gebraucht
    img = Image.open(io.BytesIO(data)).convert("RGB").resize((32, 32))
    weighted = []
    for r, g, b in img.getdata():
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        # kräftige, nicht zu dunkle und nicht zu helle Pixel zählen mehr
        score = s * s * (1 - abs(v - 0.65))
        weighted.append((score, r, g, b))
    weighted.sort(reverse=True)
    top = weighted[: max(1, len(weighted) // 5)]
    total = sum(w for w, *_ in top) or 1
    r, g, b = (sum(w * c[i] for w, *c in top) / total for i in range(3))
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    l = min(max(l, 0.38), 0.58)       # lesbar auf dunklem Grund
    s = max(s, 0.35) if s > 0.08 else s
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return "#{:02x}{:02x}{:02x}".format(int(r * 255), int(g * 255), int(b * 255))


@app.get("/api/color")
def cover_color(url: str):
    host = urllib.parse.urlparse(url).hostname or ""
    if not url.startswith("https://") or not host.endswith(COVER_HOSTS):
        raise HTTPException(400, "Nur Cover von Spotify oder YouTube")
    if url in _color_cache:
        return {"color": _color_cache[url]}
    try:
        with urllib.request.urlopen(url, timeout=6) as response:
            data = response.read(4 * 1024 * 1024)
        color = vibrant_color(data)
    except Exception:
        color = None
    if len(_color_cache) > 500:
        _color_cache.clear()
    _color_cache[url] = color
    return {"color": color}


# ---------- Bluetooth-Stereoanlage ----------
# Der Bluetooth-Wächter (läuft in der Desktop-Sitzung des Surface) meldet alle
# 5 Sekunden den Zustand und holt sich dabei Wünsche zum Neu-Verbinden ab.

bluetooth = {"mac": None, "name": None, "connected": None, "sink_ok": False,
             "updated": 0.0, "reconnect": False}


class BluetoothStatus(BaseModel):
    mac: Optional[str] = None
    name: Optional[str] = None
    connected: bool = False
    sink_ok: bool = False


def bluetooth_message():
    alive = time.time() - bluetooth["updated"] < 20
    return {"type": "bluetooth", "watcher": alive, "mac": bluetooth["mac"] or None,
            "name": bluetooth["name"] or None, "connected": bluetooth["connected"] if alive else None,
            "sink_ok": bluetooth["sink_ok"], "connecting": bluetooth["reconnect"]}


@app.get("/api/bluetooth")
def get_bluetooth():
    return bluetooth_message()


@app.post("/api/bluetooth/status")
async def bluetooth_status(body: BluetoothStatus, request: Request):
    if not is_local(request):
        raise HTTPException(403, "Nur direkt am Jukebox-Gerät erlaubt")
    before = bluetooth_message()
    was_alive = before["watcher"]
    bluetooth.update(mac=body.mac, name=body.name, connected=body.connected,
                     sink_ok=body.sink_ok, updated=time.time())
    reconnect = bluetooth["reconnect"]
    bluetooth["reconnect"] = False
    after = bluetooth_message()
    if after != before or not was_alive:
        await broadcast(after)
    reply = {"reconnect": reconnect}
    # Aufträge aus der Einrichtung (Geräte suchen / koppeln) an den Wächter übergeben
    if bt_task and bt_task["state"] == "pending":
        bt_task.update(state="running", started=time.time())
        reply["task"] = {"id": bt_task["id"], "action": bt_task["action"], "mac": bt_task.get("mac") or ""}
    return reply


bt_task = {}   # aktueller Bluetooth-Auftrag der Einrichtung
MAC_PATTERN = r"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$"


def bt_task_view():
    if not bt_task:
        return None
    if bt_task["state"] in ("pending", "running") and time.time() - bt_task.get("started", bt_task["created"]) > 90:
        bt_task.update(state="failed", message="Keine Antwort vom Bluetooth-Wächter.")
    return {k: bt_task.get(k) for k in ("id", "action", "mac", "state", "message", "devices")}


@app.post("/api/bluetooth/task/{task_id}")
async def bluetooth_task_result(task_id: str, request: Request, ok: bool = True, message: str = ""):
    """Ergebnis vom Wächter. Geräteliste als Text: eine Zeile pro Gerät 'MAC|gekoppelt|audio|Name'."""
    if not is_local(request):
        raise HTTPException(403, "Nur direkt am Jukebox-Gerät erlaubt")
    if not bt_task or bt_task["id"] != task_id:
        return {"status": "ignored"}
    devices = []
    for line in (await request.body()).decode(errors="ignore").splitlines():
        parts = line.strip().split("|", 3)
        if len(parts) == 4 and re.match(MAC_PATTERN, parts[0]):
            mac, paired, audio, name = parts
            if not name or name.replace("-", ":").upper() == mac.upper():
                continue   # Geräte ohne Namen sind für die Auswahl nutzlos
            devices.append({"mac": mac.upper(), "name": name[:60],
                            "paired": paired == "yes", "audio": audio == "yes"})
    devices.sort(key=lambda d: (not d["audio"], not d["paired"], d["name"].lower()))
    bt_task.update(state="done" if ok else "failed", message=message[:200],
                   devices=devices if bt_task["action"] == "scan" else bt_task.get("devices"))
    return {"status": "ok"}


@app.post("/api/bluetooth/reconnect")
async def bluetooth_reconnect():
    bluetooth["reconnect"] = True
    await broadcast(bluetooth_message())
    return {"status": "requested"}


# ---------- Einrichtungsassistent ----------
# Läuft beim ersten Start am Jukebox-Bildschirm. Zusätzlich per PC unter /setup,
# geschützt durch einen 6-stelligen Code, den nur der Jukebox-Bildschirm anzeigt.

SPOTIFY_ID_PATTERN = r"^[0-9a-fA-F]{32}$"
YOUTUBE_KEY_PATTERN = r"^[A-Za-z0-9_\-]{30,60}$"
SETUP_STEPS = 6


def new_setup_code():
    return f"{secrets.randbelow(1_000_000):06d}"


# Bestehende Installation ohne Assistent (Schlüssel schon vorhanden) gilt als eingerichtet
if not CONFIG.get("SETUP_DONE") and (CONFIG.get("SPOTIFY_CLIENT_ID") or CONFIG.get("YOUTUBE_API_KEY")):
    save_config({"SETUP_DONE": "1"})

setup = {"open": CONFIG.get("SETUP_DONE") != "1", "step": 0, "code": new_setup_code(),
         "tokens": set(), "fails": 0, "locked_until": 0.0}


def setup_authorized(request: Request):
    return is_local(request) or request.headers.get("X-Setup-Token") in setup["tokens"]


def require_setup(request: Request):
    if not setup["open"]:
        raise HTTPException(409, "Die Einrichtung ist abgeschlossen. Neu starten über das Wartungsmenü am Jukebox-Gerät.")
    if not setup_authorized(request):
        raise HTTPException(401, "Bitte den Code eingeben, der auf dem Jukebox-Bildschirm angezeigt wird.")


def masked(value):
    return f"••••{value[-4:]}" if value else None


@app.get("/api/setup")
def setup_status(request: Request):
    ip = local_ip()
    token = load_spotify_token()
    library = [p for p in MUSIC_DIR.rglob("*") if p.suffix.lower() in {".mp3", ".flac"}] if setup["open"] else []
    return {
        "open": setup["open"],
        "step": setup["step"],
        "steps": SETUP_STEPS,
        "local": bool(is_local(request)),
        "authorized": bool(setup_authorized(request)) and setup["open"],
        "name": CONFIG.get("JUKEBOX_NAME") or DEFAULT_NAME,
        "subtitle": CONFIG.get("JUKEBOX_SUBTITLE") or "",
        "skin": current_skin(),
        "setup_url": f"http://{ip}:{PORT}/setup",
        "remote_url": f"http://{ip}:{PORT}/remote",
        "spotify": {"configured": spotify_configured(), "client_id": masked(SPOTIFY_CLIENT_ID),
                    "connected": bool(token), "user": (token or {}).get("user"),
                    "redirect_uri": SPOTIFY_REDIRECT_URI},
        "youtube": {"configured": bool(YOUTUBE_API_KEY), "key": masked(YOUTUBE_API_KEY)},
        "lastfm": {"configured": bool(LASTFM_API_KEY), "key": masked(LASTFM_API_KEY)},
        "bluetooth": {**bluetooth_message(), "task": bt_task_view()},
        "music": {"dir": str(MUSIC_DIR), "tracks": len(library)},
        "version": app_version(),
    }


@app.get("/api/setup/code")
def setup_code(request: Request):
    if not is_local(request):
        raise HTTPException(403, "Der Code wird nur auf dem Jukebox-Bildschirm angezeigt.")
    return {"code": setup["code"] if setup["open"] else None}


class SetupUnlock(BaseModel):
    code: str = Field(max_length=10)


@app.post("/api/setup/unlock")
def setup_unlock(body: SetupUnlock):
    if not setup["open"]:
        raise HTTPException(409, "Die Einrichtung ist abgeschlossen.")
    now = time.time()
    if now < setup["locked_until"]:
        raise HTTPException(429, f"Zu viele Fehlversuche – bitte {int(setup['locked_until'] - now) + 1} Sekunden warten.")
    if not secrets.compare_digest(body.code.strip(), setup["code"]):
        setup["fails"] += 1
        if setup["fails"] >= 5:
            setup.update(fails=0, locked_until=now + 60)
        raise HTTPException(401, "Falscher Code.")
    setup["fails"] = 0
    token = secrets.token_urlsafe(24)
    setup["tokens"].add(token)
    return {"token": token}


class SetupStep(BaseModel):
    step: int = Field(ge=0, lt=SETUP_STEPS)


@app.post("/api/setup/step")
def setup_step(body: SetupStep, request: Request):
    require_setup(request)
    setup["step"] = body.step
    return {"step": body.step}


class SetupName(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    subtitle: str = Field(default="", max_length=40)


def clean_text(value):
    return re.sub(r'["\\$`\n\r]', "", value).strip()


@app.post("/api/setup/name")
def setup_name(body: SetupName, request: Request):
    require_setup(request)
    name = clean_text(body.name)
    if not name:
        raise HTTPException(400, "Bitte einen Namen eingeben.")
    save_config({"JUKEBOX_NAME": name, "JUKEBOX_SUBTITLE": clean_text(body.subtitle) or None})
    return {"status": "ok"}


class SkinChoice(BaseModel):
    skin: str = Field(max_length=20)


@app.post("/api/skin")
async def set_skin(body: SkinChoice, request: Request):
    """Aussehen wechseln: am Gerät selbst (Wartungsmenü) oder im Einrichtungsassistenten."""
    if not is_local(request):
        require_setup(request)
    if body.skin not in SKINS:
        raise HTTPException(400, "Diesen Skin gibt es nicht.")
    save_config({"JUKEBOX_SKIN": None if body.skin == "standard" else body.skin})
    await broadcast({"type": "skin", "skin": body.skin})
    return {"status": "ok", "skin": body.skin}


class SetupSpotify(BaseModel):
    client_id: str = Field(max_length=64)
    client_secret: str = Field(max_length=64)


@app.post("/api/setup/spotify")
def setup_spotify(body: SetupSpotify, request: Request):
    require_setup(request)
    client_id, client_secret = body.client_id.strip(), body.client_secret.strip()
    if not re.match(SPOTIFY_ID_PATTERN, client_id) or not re.match(SPOTIFY_ID_PATTERN, client_secret):
        raise HTTPException(400, "Client ID und Client Secret bestehen je aus 32 Zeichen (0–9, a–f).")
    # Prüfen, ob Spotify die Angaben akzeptiert
    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    check = urllib.request.Request(
        "https://accounts.spotify.com/api/token", data=b"grant_type=client_credentials",
        headers={"Authorization": f"Basic {credentials}",
                 "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(check, timeout=8):
            pass
    except urllib.error.HTTPError as error:
        if error.code in (400, 401):
            raise HTTPException(400, "Spotify kennt diese Client ID / dieses Secret nicht. Bitte nochmals kopieren.")
        raise HTTPException(502, f"Spotify-Fehler {error.code} – bitte später nochmals versuchen.")
    except Exception:
        raise HTTPException(502, "Spotify ist nicht erreichbar. Besteht eine Internetverbindung?")
    if client_id != SPOTIFY_CLIENT_ID:
        SPOTIFY_TOKEN_FILE.unlink(missing_ok=True)   # Anmeldung gehört zur alten App
    save_config({"SPOTIFY_CLIENT_ID": client_id, "SPOTIFY_CLIENT_SECRET": client_secret})
    return {"status": "ok"}


class SetupYouTube(BaseModel):
    key: str = Field(max_length=80)


@app.post("/api/setup/youtube")
def setup_youtube(body: SetupYouTube, request: Request):
    require_setup(request)
    key = body.key.strip()
    if not re.match(YOUTUBE_KEY_PATTERN, key):
        raise HTTPException(400, "Das sieht nicht nach einem YouTube-API-Schlüssel aus (beginnt meist mit «AIza»).")
    # Günstiger Test (1 Einheit statt 100 für eine Suche)
    url = "https://www.googleapis.com/youtube/v3/videos?" + urllib.parse.urlencode(
        {"part": "id", "id": "jNQXAC9IVRw", "key": key})
    warning = None
    try:
        with urllib.request.urlopen(url, timeout=8):
            pass
    except urllib.error.HTTPError as error:
        text = error.read().decode(errors="ignore")
        if "quota" in text.lower():
            warning = "Schlüssel gespeichert – das Tageskontingent ist aber gerade aufgebraucht."
        elif "accessNotConfigured" in text or "SERVICE_DISABLED" in text:
            raise HTTPException(400, "Die «YouTube Data API v3» ist im Google-Projekt noch nicht aktiviert.")
        elif error.code in (400, 403):
            raise HTTPException(400, "Google hat den Schlüssel abgelehnt. Bitte nochmals kopieren und die Einschränkungen prüfen.")
        else:
            raise HTTPException(502, f"YouTube-Fehler {error.code} – bitte später nochmals versuchen.")
    except Exception:
        raise HTTPException(502, "YouTube ist nicht erreichbar. Besteht eine Internetverbindung?")
    save_config({"YOUTUBE_API_KEY": key})
    _youtube_cache.clear()
    return {"status": "ok", "warning": warning}


class SetupLastfm(BaseModel):
    key: str = Field(max_length=80)


@app.post("/api/setup/lastfm")
def setup_lastfm(body: SetupLastfm, request: Request):
    """Optional: Last.fm-Schlüssel für treffsicherere Mix-Vorschläge. Leer = entfernen."""
    require_setup(request)
    key = body.key.strip()
    if not key:
        save_config({"LASTFM_API_KEY": None})
        return {"status": "removed"}
    if not re.fullmatch(r"[0-9a-fA-F]{32}", key):
        raise HTTPException(400, "Das sieht nicht nach einem Last.fm-API-Schlüssel aus (32 Zeichen, 0–9 und a–f).")
    try:
        valid = mixer.check_lastfm_key(key)
    except Exception:
        raise HTTPException(502, "Last.fm ist nicht erreichbar. Besteht eine Internetverbindung?")
    if not valid:
        raise HTTPException(400, "Last.fm hat den Schlüssel abgelehnt. Bitte den «API key» (nicht das «Shared secret») kopieren.")
    save_config({"LASTFM_API_KEY": key})
    return {"status": "ok"}


class SetupSpeaker(BaseModel):
    mac: str = Field(pattern=MAC_PATTERN)


def new_bt_task(action, mac=None):
    if not bluetooth_message()["watcher"]:
        raise HTTPException(503, "Der Bluetooth-Wächter läuft nicht (systemctl --user status jukebox-bluetooth).")
    running = bt_task_view()
    if running and running["state"] in ("pending", "running"):
        raise HTTPException(409, "Bluetooth ist gerade beschäftigt – einen Moment bitte.")
    devices = bt_task.get("devices")
    bt_task.clear()
    bt_task.update(id=uuid4().hex[:8], action=action, mac=mac, state="pending",
                   created=time.time(), message="", devices=devices)
    return bt_task_view()


@app.post("/api/setup/bluetooth/scan")
def setup_bluetooth_scan(request: Request):
    require_setup(request)
    return new_bt_task("scan")


@app.post("/api/setup/bluetooth/select")
def setup_bluetooth_select(body: SetupSpeaker, request: Request):
    require_setup(request)
    mac = body.mac.upper()
    save_config({"SPEAKER_MAC": mac})
    return new_bt_task("pair", mac)


@app.post("/api/setup/finish")
def setup_finish(request: Request):
    require_setup(request)
    save_config({"SETUP_DONE": "1"})
    setup.update(open=False, step=0, code=new_setup_code())
    setup["tokens"].clear()
    return {"status": "done"}


@app.post("/api/setup/reopen")
def setup_reopen(request: Request):
    if not is_local(request):
        raise HTTPException(403, "Nur direkt am Jukebox-Gerät erlaubt")
    setup.update(open=True, step=0, code=new_setup_code(), fails=0)
    setup["tokens"].clear()
    return {"status": "open"}


# ---------- Wartung (nur direkt am Jukebox-Gerät) ----------

MAINTENANCE_FILE = Path(__file__).resolve().parent.parent / "system" / "letzte-wartung.json"


@app.get("/api/system/maintenance")
def last_maintenance():
    try:
        return json.loads(MAINTENANCE_FILE.read_text())
    except (OSError, ValueError):
        return {"time": None}

SYSTEMCTL = "/usr/bin/systemctl"
# Root-Hilfsskript vom Installer (funktioniert mit sudo und sudo-rs gleichermassen)
SYSTEM_HELPER = Path("/usr/local/sbin/jukebox-system")


def privileged(action):
    """Systembefehl ohne Passwort (siehe /etc/sudoers.d/jukebox)."""
    if SYSTEM_HELPER.exists():
        return f"sudo -n {SYSTEM_HELPER} {action}"
    return f"sudo -n {SYSTEMCTL} {action}" + (" jukebox" if action in ("start", "stop", "restart") else "")


SYSTEM_ACTIONS = {
    # Vollbild schliessen, Server läuft weiter
    "exit-kiosk": lambda: "pkill -f '[j]ukebox-chrome'",
    # Vollbild und Server beenden
    "stop": lambda: f"pkill -f '[j]ukebox-chrome'; {privileged('stop')}",
    "reboot": lambda: privileged("reboot"),
    "poweroff": lambda: privileged("poweroff"),
}


def run_later(command, delay=1):
    """Befehl kurz verzögert ausführen, damit die Antwort noch beim Browser ankommt."""
    subprocess.Popen(["bash", "-c", f"sleep {delay}; {command}"], start_new_session=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


@app.post("/api/system/{action}")
def system_action(action: str, request: Request):
    if not is_local(request):
        raise HTTPException(403, "Nur direkt am Jukebox-Gerät erlaubt")
    command = SYSTEM_ACTIONS.get(action)
    if not command:
        raise HTTPException(404, "Unbekannte Aktion")
    run_later(command())
    return {"status": "ok", "action": action}


@app.get("/api/library")
def get_library():
    return scan_library()


@app.get("/api/search")
def search(q: str = "", sources: str = "local"):
    """Durchsucht die gewünschten Quellen, z. B. sources=local,youtube"""
    wanted = {s.strip() for s in sources.split(",")}
    q = q.strip()
    result = {}
    if "local" in wanted:
        words = q.lower().split()
        result["local"] = [
            t for t in scan_library()
            if all(w in f"{t['title']} {t['artist']} {t['album'] or ''}".lower() for w in words)
        ][:30]
    if "youtube" in wanted:
        result["youtube"] = youtube_search(q) if q else []
    if "spotify" in wanted:
        result["spotify"], result["spotify_albums"] = spotify_search(q) if q else ([], [])
    return result


# ---------- Webradio ----------
# Senderverzeichnis: radio-browser.info (frei, ohne Schlüssel). Gespeicherte Sender laufen
# als Lückenfüller: sobald die Warteschlange leer ist. Ein Wunsch unterbricht das Radio.

RADIO_SERVERS = ["de1", "de2", "fi1", "at1", "nl1"]
RADIO_HEADERS = {"User-Agent": "JUKEBUX/1.0 (+https://github.com/Lomi0n/jukebuex)"}
RADIO_CODECS = {"MP3", "AAC", "AAC+", "OGG", "OPUS", "FLAC"}   # spielt Chrome direkt ab
_radio_cache = {}


class Station(BaseModel):
    name: str = Field(min_length=1, max_length=80, pattern=r"\S")
    url: str = Field(max_length=600, pattern=r"^https?://")
    image: Optional[str] = Field(default=None, max_length=600)
    country: Optional[str] = Field(default=None, max_length=60)
    tags: Optional[str] = Field(default=None, max_length=120)
    codec: Optional[str] = Field(default=None, max_length=20)
    bitrate: Optional[int] = None
    homepage: Optional[str] = Field(default=None, max_length=600)
    uuid: Optional[str] = Field(default=None, max_length=60)   # stationuuid bei radio-browser


def radio_message():
    return {"type": "radio", **radio}


async def broadcast_radio():
    save_data()
    await broadcast(radio_message())


def find_station(station_id):
    return next((s for s in radio["stations"] if s["id"] == station_id), None)


def station_subtitle(station):
    parts = [station.get("country"), station.get("tags")]
    return " · ".join(p for p in parts if p) or "Webradio"


def radio_track(station):
    return {"id": str(uuid4()), "source": "radio", "title": station["name"],
            "artist": station_subtitle(station), "subtitle": station_subtitle(station),
            "url": station["url"], "image": station.get("image"), "ref": station["id"],
            "album": None, "duration": None}


def radio_fill():
    """Läuft nichts mehr: Lückenfüller starten – gewählter Sender oder nächster Song aus dem Mix."""
    if current or queue:
        return
    if radio["on"]:
        station = find_station(radio["station_id"])
        if station:
            start(radio_track(station))
    elif mixes["filler_id"]:
        track = next_mix_track()
        if track:
            start(track)


def interrupt_radio():
    """Neuer Wunsch, während das Radio läuft: sofort zum Wunsch wechseln."""
    if is_radio(current) and queue:
        paused = playback["paused"]
        start(queue.pop(0))
        playback["paused"] = paused


def switch_station(step):
    stations = radio["stations"]
    if not stations:
        return
    ids = [s["id"] for s in stations]
    index = ids.index(radio["station_id"]) if radio["station_id"] in ids else -step
    station = stations[(index + step) % len(stations)]
    radio["station_id"] = station["id"]
    start(radio_track(station))


def radio_browser(path, params=None):
    """Fragt das Senderverzeichnis ab, mit Ausweichservern."""
    query = urllib.parse.urlencode(params or {})
    for server in RADIO_SERVERS:
        url = f"https://{server}.api.radio-browser.info{path}" + (f"?{query}" if query else "")
        try:
            request = urllib.request.Request(url, headers=RADIO_HEADERS)
            with urllib.request.urlopen(request, timeout=6) as response:
                return json.loads(response.read())
        except (OSError, ValueError):
            continue
    raise HTTPException(502, "Das Radioverzeichnis ist gerade nicht erreichbar. Bitte später nochmals versuchen.")


def station_from_directory(item):
    tags = [t.strip() for t in (item.get("tags") or "").split(",") if t.strip()][:3]
    return {
        "uuid": item.get("stationuuid"),
        "name": (item.get("name") or "").strip()[:80] or "Unbenannter Sender",
        "url": item.get("url_resolved") or item.get("url"),
        "image": item.get("favicon") or None,
        "country": item.get("country") or None,
        "countrycode": item.get("countrycode") or None,
        "tags": ", ".join(tags) or None,
        "codec": item.get("codec") or None,
        "bitrate": item.get("bitrate") or None,
        "homepage": item.get("homepage") or None,
        "votes": item.get("votes") or 0,
    }


@app.get("/api/radio")
def get_radio():
    return radio


@app.get("/api/radio/search")
def radio_search(q: str = "", country: str = "", tag: str = ""):
    """Sender suchen. Ohne Angaben: beliebte Sender aus der Schweiz."""
    q, country, tag = q.strip()[:80], country.strip().upper()[:2], tag.strip().lower()[:40]
    if not (q or country or tag):
        country = "CH"
    key = (q.lower(), country, tag)
    cached = _radio_cache.get(key)
    if cached and time.time() - cached[0] < 600:
        return cached[1]
    params = {"limit": 80, "hidebroken": "true", "order": "clickcount", "reverse": "true"}
    if q:
        params["name"] = q
    if country:
        params["countrycode"] = country
    if tag:
        params["tag"] = tag
    results, seen = [], set()
    for item in radio_browser("/json/stations/search", params):
        url = item.get("url_resolved") or item.get("url") or ""
        codec = (item.get("codec") or "").upper()
        # HLS-Streams und unbekannte Formate spielt der Browser nicht zuverlässig ab
        if item.get("hls") or not url.startswith(("http://", "https://")) or url in seen:
            continue
        if codec and codec not in RADIO_CODECS:
            continue
        seen.add(url)
        results.append(station_from_directory(item))
    results = results[:40]
    _radio_cache[key] = (time.time(), results)
    return results


def resolve_playlist(url):
    """.pls/.m3u-Links (Senderwebseiten) in die eigentliche Stream-Adresse auflösen."""
    path = urllib.parse.urlparse(url).path.lower()
    if path.endswith(".m3u8"):
        raise HTTPException(400, "HLS-Streams (.m3u8) werden nicht unterstützt. Bitte eine MP3- oder AAC-Adresse verwenden.")
    if not path.endswith((".pls", ".m3u")):
        return url
    try:
        request = urllib.request.Request(url, headers=RADIO_HEADERS)
        with urllib.request.urlopen(request, timeout=6) as response:
            text = response.read(65536).decode("utf-8", "replace")
    except OSError:
        raise HTTPException(400, "Die Playlist-Datei des Senders konnte nicht geladen werden.")
    for line in text.splitlines():
        line = line.strip()
        if "=" in line and line.lower().startswith("file"):
            line = line.split("=", 1)[1].strip()
        if line.startswith(("http://", "https://")):
            return line
    raise HTTPException(400, "In der Playlist-Datei wurde keine Stream-Adresse gefunden.")


def require_remote_radio(request: Request):
    if is_local(request):
        raise HTTPException(403, "Sender bitte über die Fernbedienung an einem PC verwalten.")


@app.post("/api/radio/stations")
async def add_station(station: Station, request: Request):
    require_remote_radio(request)
    data = station.model_dump()
    data["url"] = resolve_playlist(data["url"])
    existing = next((s for s in radio["stations"]
                     if s["url"] == data["url"] or (data["uuid"] and s.get("uuid") == data["uuid"])), None)
    if existing:
        return {"status": "exists", **existing}
    new = {"id": str(uuid4()), **data}
    radio["stations"].append(new)
    await broadcast_radio()
    return {"status": "added", **new}


@app.delete("/api/radio/stations/{station_id}")
async def delete_station(station_id: str, request: Request):
    require_remote_radio(request)
    station = find_station(station_id)
    if not station:
        raise HTTPException(404, "Sender nicht gefunden")
    radio["stations"].remove(station)
    if radio["station_id"] == station_id:
        radio.update(station_id=None, on=False)
        if is_radio(current):
            finish_current()
            await broadcast()
    await broadcast_radio()
    return {"status": "deleted"}


@app.post("/api/radio/stations/{station_id}/move")
async def move_station(station_id: str, body: Move, request: Request):
    require_remote_radio(request)
    station = find_station(station_id)
    if not station:
        raise HTTPException(404, "Sender nicht gefunden")
    radio["stations"].remove(station)
    radio["stations"].insert(min(body.index, len(radio["stations"])), station)
    await broadcast_radio()
    return {"status": "moved"}


def count_click(uuid):
    """Dem Verzeichnis melden, dass der Sender gehört wird (hilft der Rangliste)."""
    try:
        radio_browser(f"/json/url/{urllib.parse.quote(uuid)}")
    except HTTPException:
        pass


@app.post("/api/radio/play/{station_id}")
async def play_station(station_id: str):
    station = find_station(station_id)
    if not station:
        raise HTTPException(404, "Sender nicht gefunden")
    radio.update(station_id=station_id, on=True)
    if mixes["filler_id"]:            # Sender ersetzt einen Mix als Lückenfüller
        mixes["filler_id"] = None
        await broadcast_mixes()
    if station.get("uuid"):
        asyncio.get_running_loop().run_in_executor(None, count_click, station["uuid"])
    # Läuft gerade ein Wunsch, kommt das Radio erst danach (ein Mix-Lückenfüller wird abgelöst)
    waiting = bool(current and not is_radio(current) and not current.get("filler"))
    if not waiting:
        start(radio_track(station))
        await broadcast()
    await broadcast_radio()
    return {"status": "waiting" if waiting else "playing"}


@app.post("/api/radio/off")
async def radio_off():
    radio["on"] = False
    if mixes["filler_id"]:
        mixes["filler_id"] = None
        await broadcast_mixes()
    if is_radio(current):
        finish_current()
        await broadcast()
    await broadcast_radio()
    return {"status": "off"}


# Was läuft gerade? Viele Sender schicken den Titel als ICY-Metadaten im Stream mit.
_radio_meta_task = None


def read_icy_title(url):
    request = urllib.request.Request(url, headers={**RADIO_HEADERS, "Icy-MetaData": "1"})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            metaint = int(response.headers.get("icy-metaint") or 0)
            if not 0 < metaint <= 256 * 1024:
                return None
            remaining = metaint
            while remaining > 0:
                chunk = response.read(min(remaining, 16384))
                if not chunk:
                    return None
                remaining -= len(chunk)
            length = response.read(1)
            if not length:
                return None
            meta = response.read(length[0] * 16).rstrip(b"\0")
    except (OSError, ValueError):
        return None
    try:
        text = meta.decode("utf-8")
    except UnicodeDecodeError:
        text = meta.decode("latin-1")
    match = re.search(r"StreamTitle='(.*?)';", text, re.S)
    title = match.group(1).strip() if match else ""
    return title[:150] or None


async def radio_meta_loop():
    while True:
        await asyncio.sleep(15)
        track = current
        if not is_radio(track) or playback["paused"]:
            continue
        title = await asyncio.to_thread(read_icy_title, track["url"])
        # Inzwischen umgeschaltet? Dann verwerfen
        if current is not track:
            continue
        artist = title or track.get("subtitle") or "Webradio"
        if track.get("now_playing") != title or track.get("artist") != artist:
            track.update(now_playing=title, artist=artist)
            await broadcast()


def ensure_radio_meta_task():
    global _radio_meta_task
    if _radio_meta_task is None or _radio_meta_task.done():
        _radio_meta_task = asyncio.create_task(radio_meta_loop())


# ---------- Automatische Mixe ----------
# Hörprofil (plays.json) -> ähnliche Musik über Deezer/Last.fm (mixer.py) -> auf Spotify suchen.
# Jede Nacht ab 4 Uhr neu gemischt, zusätzlich per Knopf «Neu mischen».

mix_cache = load_json(MIX_CACHE_FILE, {"artists": {}, "matches": {}, "youtube": {}})
MATCH_MISS_DAYS = 14        # nicht gefundene Songs so lange nicht erneut suchen
YOUTUBE_PREFETCH = 40       # nachts vorab höchstens so viele YouTube-Suchen (je 100 Einheiten).
                            # Um 4 Uhr läuft noch der Kontingent-Tag von gestern (Neustart um 9 Uhr).
_mix_task = None
_resolving = set()          # YouTube-Videos, die gerade gesucht werden (Titel-IDs)


def mix_source():
    """Über welche Quelle Mix-Songs laufen: YouTube (Standard) oder Spotify."""
    source = mixes.get("source") or ("youtube" if YOUTUBE_API_KEY else "spotify")
    if source == "youtube" and not YOUTUBE_API_KEY:
        return "spotify"
    if source == "spotify" and not spotify_configured() and YOUTUBE_API_KEY:
        return "youtube"
    return source


def mixes_message():
    return {"type": "mixes", "lists": mixes["lists"], "updated": mixes["updated"],
            "filler_id": mixes["filler_id"], "lastfm": bool(LASTFM_API_KEY), "source": mix_source(),
            "youtube": bool(YOUTUBE_API_KEY), "spotify": spotify_configured(),
            "profile": len(plays), **mix_status}


async def broadcast_mixes():
    save_json(MIXES_FILE, mixes)
    await broadcast(mixes_message())


async def notice(text):
    """Kurze Meldung auf allen Bildschirmen (erscheint als Hinweis unten)."""
    await broadcast({"type": "notice", "text": text, "nonce": str(uuid4())})


def find_mix(mix_id):
    found = next((m for m in mixes["lists"] if m["id"] == mix_id), None)
    if not found:
        raise HTTPException(404, "Mix nicht gefunden")
    return found


def is_pending(track):
    """YouTube-Titel, dessen Video erst noch gesucht werden muss (kommt aus einem Mix)."""
    return bool(track) and track.get("source") == "youtube" and not track.get("ref")


def mix_playable(track, source=None):
    """Mix-Titel -> Titel für die Warteschlange: lokal vor allem, dann die gewählte Quelle, dann die andere.
    Ist das YouTube-Video noch nicht gesucht, wird es erst beim Abspielen gesucht."""
    source = source or mix_source()
    if track.get("local"):
        return dict(track["local"])
    for option in (source, "spotify" if source == "youtube" else "youtube"):
        found = track.get(option)
        if found:
            return {**found, "image": found.get("image") or track.get("image")}
        if option == "youtube" and found is None and YOUTUBE_API_KEY:
            return {"title": track["title"], "artist": track["artist"], "album": track.get("album"),
                    "image": track.get("image"), "duration": track.get("duration"), "source": "youtube", "ref": None}
    return None


def next_mix_track():
    """Lückenfüller: zufälliger Song aus dem Mix, der in dieser Runde noch nicht lief."""
    mix = next((m for m in mixes["lists"] if m["id"] == mixes["filler_id"]), None)
    if not mix or not mix["tracks"]:
        mixes["filler_id"] = None
        return None
    played = set(mixes["filler_played"])
    recent = {mixer.song_key(t.get("artist"), t.get("title")) for t in history[:5]}
    playable = [t for t in mix["tracks"] if mix_playable(t)]
    pool = [t for t in playable if t["id"] not in played and
            mixer.song_key(t.get("artist"), t.get("title")) not in recent]
    if not pool:
        mixes["filler_played"] = []
        pool = [t for t in playable if mixer.song_key(t.get("artist"), t.get("title")) not in recent] or playable
    if not pool:
        return None
    track = pool[int.from_bytes(os.urandom(2), "big") % len(pool)]
    mixes["filler_played"].append(track["id"])
    save_json(MIXES_FILE, mixes)
    return {**mix_playable(track), "id": str(uuid4()), "filler": "mix", "mix_name": mix["name"]}


def library_index():
    index = {}
    for track in scan_library():
        if track.get("artist") and track.get("title"):
            index.setdefault(mixer.song_key(track["artist"], track["title"]), track)
    return index


def find_spotify(artist, title):
    """Song auf Spotify suchen (gemerkt). None = nicht gefunden oder nicht erreichbar."""
    key = mixer.song_key(artist, title)
    matches = mix_cache.setdefault("matches", {})
    cached = matches.get(key)
    if cached and (cached.get("track") or time.time() - cached.get("ts", 0) < MATCH_MISS_DAYS * 86400):
        return cached.get("track")
    if not spotify_configured() or not load_spotify_token():
        return None
    clean = mixer.clean_title(title)
    try:
        data = spotify_api("/search", {"q": f'track:"{clean}" artist:"{mixer.main_artist(artist)}"',
                                       "type": "track", "limit": 5})
    except Exception:
        return None   # Netzfehler: nicht als «nicht gefunden» merken
    track = None
    for item in data.get("tracks", {}).get("items", []):
        candidate = spotify_track(item)
        if candidate and mixer.same_artist(candidate["artist"], artist) and mixer.same_title(candidate["title"], clean):
            track = candidate
            break
    matches[key] = {"ts": time.time(), "track": track}
    return track


def cached_youtube(artist, title):
    """Titel = gefunden, False = gesucht und nicht gefunden, None = noch nie gesucht."""
    entry = mix_cache.setdefault("youtube", {}).get(mixer.song_key(artist, title))
    if not entry:
        return None
    if entry.get("track"):
        return entry["track"]
    return False if time.time() - entry.get("ts", 0) < MATCH_MISS_DAYS * 86400 else None


def find_youtube(artist, title):
    """YouTube-Video zu einem Song suchen (kostet 100 Einheiten, wird für immer gemerkt).
    Liefert Titel, False (nicht gefunden), "quota" (Kontingent leer) oder None (Fehler)."""
    cached = cached_youtube(artist, title)
    if cached is not None:
        return cached
    results = youtube_search(f"{mixer.main_artist(artist)} {mixer.clean_title(title)}")
    if not isinstance(results, list):
        return "quota" if "Kontingent" in str((results or {}).get("error", "")) else None
    name = mixer.norm(mixer.main_artist(artist))
    match = next((t for t in results if mixer.same_title(t["title"], title) and
                  (mixer.same_artist(t["artist"], artist) or name in mixer.norm(t["title"] + " " + t["artist"]))), None) \
        or next((t for t in results[:3] if mixer.same_title(t["title"], title)), None)
    mix_cache.setdefault("youtube", {})[mixer.song_key(artist, title)] = {"ts": time.time(), "track": match}
    save_json(MIX_CACHE_FILE, mix_cache)
    return match or False


def remember_youtube(artist, title, result):
    """Ergebnis einer YouTube-Suche in alle Mixe übernehmen."""
    if result is not False and not isinstance(result, dict):
        return   # Kontingent leer oder Fehler: nichts merken, später nochmals versuchen
    key = mixer.song_key(artist, title)
    for mix in mixes["lists"]:
        for track in mix["tracks"]:
            if mixer.song_key(track.get("artist"), track.get("title")) == key:
                track["youtube"] = result
    save_json(MIXES_FILE, mixes)


def make_resolver():
    """Wo ist ein vorgeschlagener Song abspielbar? Lokal und Spotify werden gleich gesucht (gratis),
    YouTube nur aus dem Zwischenspeicher – gesucht wird dort sparsam (nachts bzw. beim Abspielen)."""
    local = library_index()

    def resolve(candidate):
        artist, title = candidate["artist"], candidate["title"]
        key = mixer.song_key(artist, title)
        entry = {"title": title, "artist": artist, "album": candidate.get("album"),
                 "image": candidate.get("image"), "duration": candidate.get("duration")}
        source = candidate.get("source")
        if source in ("spotify", "youtube", "local") and (candidate.get("ref") or candidate.get("url")):
            # Bekannter Song: so wie er schon lief
            entry[source] = {k: candidate.get(k) for k in ("title", "artist", "album", "source", "url", "ref", "image", "duration")}
        if key in local:
            entry["local"] = local[key]
        if not entry.get("spotify"):
            entry["spotify"] = find_spotify(artist, title)
        if not entry.get("youtube"):
            entry["youtube"] = cached_youtube(artist, title)
        entry["image"] = entry["image"] or next((entry[s]["image"] for s in ("spotify", "youtube", "local")
                                                  if entry.get(s) and entry[s].get("image")), None)
        if entry.get("local") or entry.get("spotify") or entry.get("youtube") or \
                (YOUTUBE_API_KEY and entry.get("youtube") is None):
            return entry
        return None

    return resolve


def run_mix_generation(progress):
    favorite_tracks = [t for f in favorites for t in f["tracks"]]
    resolve = make_resolver()
    lists = mixer.generate(plays, favorite_tracks, mixes["blocked"], mix_cache.setdefault("artists", {}),
                           resolve, lastfm_key=LASTFM_API_KEY, progress=progress)
    # Bekannte Lieblingssongs ebenfalls mit allen Quellen versehen
    for mix in lists:
        mix["tracks"] = [t if t.get("new") else resolve(t) or t for t in mix["tracks"]]
    save_json(MIX_CACHE_FILE, mix_cache)
    prefetch_youtube(lists, progress)
    return lists


def prefetch_youtube(lists, progress):
    """Nachts schon die YouTube-Videos suchen, damit es beim Abspielen keine Pause gibt."""
    if not YOUTUBE_API_KEY or mix_source() != "youtube":
        return
    filler_name = next((m["name"] for m in mixes["lists"] if m["id"] == mixes["filler_id"]), None)
    ordered = sorted(lists, key=lambda m: m["name"] != filler_name)
    todo = [t for m in ordered for t in m["tracks"] if not t.get("local") and t.get("youtube") is None]
    for i, track in enumerate(todo[:YOUTUBE_PREFETCH], 1):
        progress(f"YouTube-Videos suchen ({i}/{min(len(todo), YOUTUBE_PREFETCH)})")
        result = find_youtube(track["artist"], track["title"])
        if result == "quota" or result is None:
            break   # Kontingent leer oder YouTube nicht erreichbar: Rest beim Abspielen
        for t in (t for m in lists for t in m["tracks"]):
            if mixer.song_key(t["artist"], t["title"]) == mixer.song_key(track["artist"], track["title"]):
                t["youtube"] = result


def schedule_pending():
    """Laufender bzw. nächster Titel braucht noch sein YouTube-Video: im Hintergrund suchen."""
    for item in ([current] if current else []) + queue[:1]:
        if is_pending(item) and item["id"] not in _resolving:
            _resolving.add(item["id"])
            asyncio.get_running_loop().create_task(resolve_pending(item))


async def resolve_pending(item):
    global current
    try:
        result = await asyncio.to_thread(find_youtube, item["artist"], item["title"])
        remember_youtube(item["artist"], item["title"], result)
        if isinstance(result, dict):
            item.update(ref=result["ref"], duration=item.get("duration") or result.get("duration"))
        else:
            # Kein Video (oder Kontingent leer): über Spotify abspielen, sonst überspringen
            fallback = await asyncio.to_thread(find_spotify, item["artist"], item["title"])
            reason = "Das YouTube-Tageskontingent ist aufgebraucht" if result == "quota" else "Kein passendes YouTube-Video gefunden"
            if fallback:
                replacement = {**fallback, "id": item["id"], "image": item.get("image") or fallback.get("image"),
                               **{k: item[k] for k in ("filler", "mix_name") if k in item}}
                await notice(f"{reason} – «{item['title']}» läuft über Spotify.")
            else:
                replacement = None
                await notice(f"{reason} – «{item['title']}» wird übersprungen.")
            if current is item:
                if replacement:
                    current = {**replacement, "play_id": str(uuid4())}
                else:
                    current = None
                    playback.update(paused=False, position=0.0, duration=0.0)
                    if queue:
                        start(queue.pop(0))
                    else:
                        radio_fill()
            elif item in queue:
                index = queue.index(item)
                if replacement:
                    queue[index] = replacement
                else:
                    queue.pop(index)
        await broadcast()
        await broadcast(mixes_message())
    finally:
        _resolving.discard(item["id"])


async def generate_mixes():
    loop = asyncio.get_running_loop()
    mix_status.update(running=True, progress="Hörprofil auswerten …", error=None)
    await broadcast_mixes()

    def progress(text):
        mix_status["progress"] = text
        asyncio.run_coroutine_threadsafe(broadcast(mixes_message()), loop)

    try:
        lists = await asyncio.to_thread(run_mix_generation, progress)
    except ValueError as error:
        mix_status["error"] = str(error)
    except Exception as error:
        print("Mixe konnten nicht erstellt werden:", repr(error), flush=True)
        mix_status["error"] = "Das Mischen hat nicht geklappt. Besteht eine Internetverbindung?"
    else:
        # Lückenfüller beim gleichnamigen neuen Mix weiterlaufen lassen
        old_names = {m["id"]: m["name"] for m in mixes["lists"]}
        filler_name = old_names.get(mixes["filler_id"])
        for mix in lists:
            mix["id"] = str(uuid4())
            for track in mix["tracks"]:
                track["id"] = str(uuid4())
        mixes["lists"] = lists
        mixes["filler_id"] = next((m["id"] for m in lists if m["name"] == filler_name), None) if filler_name else None
        if filler_name and not mixes["filler_id"] and lists:
            mixes["filler_id"] = lists[0]["id"]
        mixes["filler_played"] = []
        mixes["updated"] = time.time()
    finally:
        mixes["day"] = time.strftime("%Y-%m-%d")
        mix_status.update(running=False, progress=None)
        await broadcast_mixes()


class MixSource(BaseModel):
    source: str = Field(pattern="^(youtube|spotify)$")


@app.post("/api/mixes/source")
async def set_mix_source(body: MixSource):
    if body.source == "youtube" and not YOUTUBE_API_KEY:
        raise HTTPException(400, "YouTube ist nicht eingerichtet.")
    if body.source == "spotify" and not spotify_configured():
        raise HTTPException(400, "Spotify ist nicht eingerichtet.")
    mixes["source"] = body.source
    await broadcast_mixes()
    return {"status": "ok", "source": body.source}


def start_mix_generation():
    global _mix_task
    if _mix_task and not _mix_task.done():
        return False
    _mix_task = asyncio.create_task(generate_mixes())
    return True


async def mix_schedule_loop():
    await asyncio.sleep(60)
    while True:
        now = time.localtime()
        # Jede Nacht ab 4 Uhr – und einmalig, sobald genug gehört wurde
        first_time = not mixes["lists"] and not mixes["day"] and len(plays) >= 8
        if mixer.nightly_due(now, mixes["day"]) or first_time:
            start_mix_generation()
        await asyncio.sleep(300)


@app.get("/api/mixes")
def get_mixes():
    return mixes_message()


@app.post("/api/mixes/refresh")
async def refresh_mixes():
    if not start_mix_generation():
        raise HTTPException(409, "Die Mixe werden gerade schon neu gemischt.")
    return {"status": "started"}


@app.post("/api/mixes/filler/off")
async def mix_filler_off():
    mixes["filler_id"] = None
    await broadcast_mixes()
    return {"status": "off"}


@app.post("/api/mixes/{mix_id}/filler")
async def mix_filler_on(mix_id: str):
    mix = find_mix(mix_id)
    mixes.update(filler_id=mix_id, filler_played=[])
    radio["on"] = False              # Mix ersetzt das Radio als Lückenfüller
    waiting = bool(current and not is_radio(current) and not current.get("filler"))
    if current and not waiting:
        finish_current()     # Radio oder Song aus einem anderen Mix ablösen
    radio_fill()
    await broadcast()
    await broadcast_radio()
    await broadcast_mixes()
    return {"status": "waiting" if waiting else "playing", "name": mix["name"]}


@app.post("/api/mixes/{mix_id}/block/{track_id}")
async def block_mix_track(mix_id: str, track_id: str):
    """«Nicht mehr vorschlagen»: aus dem Mix nehmen und künftig auslassen."""
    mix = find_mix(mix_id)
    track = next((t for t in mix["tracks"] if t["id"] == track_id), None)
    if not track:
        raise HTTPException(404, "Titel nicht im Mix")
    mix["tracks"].remove(track)
    key = mixer.song_key(track.get("artist"), track.get("title"))
    if key not in mixes["blocked"]:
        mixes["blocked"] = (mixes["blocked"] + [key])[-1000:]
    await broadcast_mixes()
    return {"status": "blocked"}


def ensure_background_tasks():
    global _mix_schedule_task
    ensure_radio_meta_task()
    if _mix_schedule_task is None or _mix_schedule_task.done():
        _mix_schedule_task = asyncio.create_task(mix_schedule_loop())


_mix_schedule_task = None


# ---------- Eigener Hintergrund ----------
# Versteckte Funktion: nur über die Fernbedienung (5× auf den Urheber-Vermerk tippen), nie am Gerät selbst.
# Das Bild bleibt auf diesem Gerät und wird auf Bildschirmgrösse verkleinert.

BG_DIR = SOUND_DIR.parent / "background"      # ~/jukebox/background
BG_DIR.mkdir(parents=True, exist_ok=True)
MAX_BG_BYTES = 15 * 1024 * 1024
BG_SIZE = (2736, 1824)                        # Surface Pro: mehr braucht es nicht


def background_message():
    return {"type": "background", "dim": background["dim"], "blur": background["blur"],
            "url": f"/api/background/image?v={background['version']}" if background["file"] else None}


async def broadcast_background():
    save_data()
    await broadcast(background_message())


def require_remote_background(request: Request):
    if is_local(request):
        raise HTTPException(403, "Nicht verfügbar.")


def convert_background(body):
    from PIL import Image, ImageOps   # nur hier gebraucht
    Image.MAX_IMAGE_PIXELS = 60_000_000
    try:
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(body))).convert("RGB")
    except Exception:
        raise HTTPException(400, "Das Bild konnte nicht gelesen werden (JPG, PNG oder WebP verwenden).")
    image.thumbnail(BG_SIZE)
    name = f"bg-{int(time.time())}.jpg"
    image.save(BG_DIR / name, "JPEG", quality=86, optimize=True)
    return name


@app.put("/api/background")
async def set_background(request: Request, filename: str = ""):
    require_remote_background(request)
    file_suffix(filename, IMAGE_TYPES, "Bild")
    body = await read_upload(request, MAX_BG_BYTES, "Bild")
    name = await asyncio.to_thread(convert_background, body)
    if background["file"]:
        (BG_DIR / background["file"]).unlink(missing_ok=True)
    background.update(file=name, version=int(time.time()))
    await broadcast_background()
    return background_message()


class BackgroundLook(BaseModel):
    dim: int = Field(ge=0, le=90)
    blur: int = Field(ge=0, le=30)


@app.patch("/api/background")
async def set_background_look(body: BackgroundLook, request: Request):
    require_remote_background(request)
    background.update(dim=body.dim, blur=body.blur)
    await broadcast_background()
    return background_message()


@app.delete("/api/background")
async def delete_background(request: Request):
    require_remote_background(request)
    if background["file"]:
        (BG_DIR / background["file"]).unlink(missing_ok=True)
    background.update(file=None, version=int(time.time()))
    await broadcast_background()
    return background_message()


@app.get("/api/background/image")
def background_image():
    if not background["file"] or not (BG_DIR / background["file"]).exists():
        raise HTTPException(404, "Kein Hintergrund")
    return FileResponse(BG_DIR / background["file"], headers={"Cache-Control": "max-age=31536000"})


# ---------- Live-Verbindung ----------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    ensure_background_tasks()
    for message in (state(), {"type": "favorites", "lists": favorites}, sounds_message(),
                    bluetooth_message(), radio_message(), mixes_message(), background_message()):
        if not await send_safe(websocket, message):
            await close_quietly(websocket)
            return
    connections.append(websocket)
    try:
        while True:
            try:
                message = json.loads(await websocket.receive_text())
            except ValueError:
                continue
            # Lebenszeichen der Geräte: sofort beantworten
            if message.get("type") == "ping":
                if not await send_safe(websocket, {"type": "pong"}):
                    break
            # Das Surface meldet regelmässig die Abspielposition
            elif message.get("type") == "position":
                playback["position"] = float(message.get("position") or 0)
                playback["duration"] = float(message.get("duration") or 0)
                await broadcast({"type": "position", **{k: playback[k] for k in ("position", "duration")}},
                                exclude=websocket)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        if websocket in connections:
            connections.remove(websocket)


# ---------- Fertige Oberfläche ausliefern (npm run build) ----------
# Muss ganz am Schluss stehen, damit /api/... und /ws Vorrang haben.

if (FRONTEND_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{path:path}")
    def frontend(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Unbekannte API-Adresse")
        file = (FRONTEND_DIST / path).resolve()
        if path and file.is_file() and FRONTEND_DIST in file.parents:
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html", headers={"Cache-Control": "no-cache"})  # z. B. / und /remote

