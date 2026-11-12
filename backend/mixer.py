"""Automatische Mixe: aus dem Hörprofil ähnliche Musik finden und nach Genre gruppieren.

Spotify gibt eigenen Apps keine Empfehlungen mehr heraus (seit Nov. 2024 / Feb. 2026).
Darum kommen die Vorschläge aus öffentlichen Musikverzeichnissen:
  - Deezer (ohne Schlüssel): ähnliche Künstler, deren Top-Songs, Genre über die Alben
  - Last.fm (optional, mit Schlüssel): ähnliche Songs und treffsicherere Genres (Tags)
Wo die Songs abspielbar sind (lokal, Spotify, YouTube), klärt `resolve` aus main.py.

Alles hier ist blockierend (urllib) und läuft in einem eigenen Thread.
"""
import json
import math
import random
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

HEADERS = {"User-Agent": "JUKEBUX/1.1 (+https://github.com/Lomi0n/jukebuex)", "Accept-Language": "de"}
MIX_SIZE = 25            # Titel pro Mix
KNOWN_PER_MIX = 6        # davon bekannte Lieblingssongs (wie bei den Spotify-Mixen)
MAX_MIXES = 4
MAX_SEEDS = 16           # meistgehörte Interpreten, die als Ausgangspunkt dienen
HALF_LIFE_DAYS = 30      # ältere Wiedergaben zählen weniger
CACHE_DAYS = 14          # Künstlerinfos so lange zwischenspeichern
MAX_LOOKUPS = 160        # höchstens so viele Suchen bei Spotify/YouTube pro Durchlauf

# Rohe Genres (Deezer) und Tags (Last.fm) auf wenige, verständliche Mixe abbilden.
# Reihenfolge zählt: Spezielles vor Allgemeinem («Pop Rock» -> Rock, «Synthpop» -> Elektronisch).
GENRES = [
    ("Hip-Hop", ["hip hop", "hip-hop", "hiphop", "rap", "trap", "mundart rap", "deutschrap", "grime"]),
    ("Elektronisch", ["electro", "electronic", "electronica", "dance", "house", "techno", "edm", "trance",
                      "drum and bass", "dubstep", "synthpop", "synth-pop", "eurodance", "disco"]),
    ("R&B & Soul", ["r&b", "rnb", "soul", "funk", "neo-soul", "motown"]),
    ("Schlager & Volksmusik", ["schlager", "volksmusik", "volkstümlich", "ländler", "oberkrainer"]),
    ("Metal", ["metal", "heavy metal", "hard rock", "metalcore", "thrash metal"]),
    ("Jazz & Blues", ["jazz", "blues", "swing", "bossa nova"]),
    ("Klassik", ["classical", "klassik", "orchestral", "opera", "oper", "piano"]),
    ("Reggae", ["reggae", "dancehall", "ska", "dub"]),
    ("Latin", ["latin", "reggaeton", "salsa", "latin pop", "bachata"]),
    ("Country & Folk", ["country", "folk", "americana", "bluegrass", "singer-songwriter"]),
    ("Indie & Alternative", ["indie", "alternative", "indie rock", "indie pop", "alternative rock", "britpop", "post-punk"]),
    ("Rock", ["rock", "punk", "grunge", "classic rock", "pop rock", "pop/rock", "mundartrock", "soft rock"]),
    ("Pop", ["pop", "dance pop", "europop", "k-pop", "chanson", "deutschpop", "mundart", "schweizer pop", "variété"]),
]


def genre_bucket(raw):
    """«Rap/Hip Hop», «indie rock» usw. einem Mix zuordnen (None = unbekannt)."""
    text = (raw or "").lower().replace("/", " ").strip()
    if not text:
        return None
    for name, words in GENRES:
        for word in words:
            if text == word or re.search(rf"(^|[\s\-]){re.escape(word)}($|[\s\-])", text):
                return name
    return None


# ---------- Namen vergleichen ----------

_BRACKETS = re.compile(r"\s*[\(\[][^)\]]*[\)\]]")
_SUFFIX = re.compile(r"\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo|radio|single|feat).*$", re.I)


def norm(text):
    """Vereinfachte Schreibweise zum Vergleichen: «Züri West» == «zuri west»."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def clean_title(title):
    """«Song (Remastered 2011)» / «Song - Radio Edit» -> «Song»."""
    cleaned = _SUFFIX.sub("", _BRACKETS.sub("", title or "")).strip()
    return cleaned or (title or "")


def main_artist(artist):
    """Erster Interpret: «A, B» / «A feat. B» -> «A» («Lo & Leduc» bleibt ganz)."""
    first = re.split(r",\s+|\s+(?:feat\.?|ft\.?|featuring|x|vs\.?)\s+", artist or "", maxsplit=1, flags=re.I)[0]
    return first.strip() or (artist or "")


def song_key(artist, title):
    return f"{norm(main_artist(artist))}|{norm(clean_title(title))}"


def same_artist(a, b):
    a, b = norm(main_artist(a)), norm(main_artist(b))
    return bool(a) and (a == b or a.removeprefix("the ") == b.removeprefix("the "))


def same_title(a, b):
    a, b = norm(clean_title(a)), norm(clean_title(b))
    return bool(a) and (a == b or (len(a) > 3 and (b.startswith(a) or a.startswith(b))))


# ---------- Verzeichnisse abfragen ----------

class Directories:
    def __init__(self, lastfm_key=None):
        self.lastfm_key = lastfm_key
        self.calls = 0
        self._last = 0.0

    def _get(self, url, delay):
        # Höflich bleiben: Deezer erlaubt 50 Abfragen pro 5 Sekunden
        wait = self._last + delay - time.time()
        if wait > 0:
            time.sleep(wait)
        self._last = time.time()
        self.calls += 1
        request = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())

    def deezer(self, path, **params):
        url = f"https://api.deezer.com{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
        try:
            data = self._get(url, 0.15)
        except (OSError, ValueError):
            return None
        if isinstance(data, dict) and data.get("error"):
            return None
        return data

    def lastfm(self, method, **params):
        if not self.lastfm_key:
            return None
        query = urllib.parse.urlencode({"method": method, "api_key": self.lastfm_key, "format": "json",
                                        "autocorrect": 1, **params})
        try:
            data = self._get(f"https://ws.audioscrobbler.com/2.0/?{query}", 0.25)
        except (OSError, ValueError):
            return None
        if isinstance(data, dict) and data.get("error"):
            return None
        return data


def check_lastfm_key(key):
    """True = gültig, False = abgelehnt. Wirft OSError, wenn Last.fm nicht erreichbar ist."""
    query = urllib.parse.urlencode({"method": "artist.getinfo", "artist": "Patent Ochsner",
                                    "api_key": key, "format": "json"})
    request = urllib.request.Request(f"https://ws.audioscrobbler.com/2.0/?{query}", headers=HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            data = json.loads(response.read())
    except urllib.error.HTTPError as error:
        try:
            data = json.loads(error.read())
        except ValueError:
            raise OSError(f"Last.fm-Fehler {error.code}")
    return not (isinstance(data, dict) and data.get("error") in (10, 26))


def deezer_track(item):
    album = item.get("album") or {}
    return {
        "title": item.get("title_short") or item.get("title") or "",
        "artist": (item.get("artist") or {}).get("name") or "",
        "album": album.get("title"),
        "album_id": album.get("id"),
        "image": album.get("cover_medium"),
        "duration": item.get("duration"),
    }


def artist_info(name, directories, cache, need_genre=True):
    """Deezer-ID, Top-Songs, ähnliche Interpreten und Genre – mit Zwischenspeicher."""
    key = norm(name)
    entry = cache.get(key)
    fresh = entry and time.time() - entry.get("ts", 0) < CACHE_DAYS * 86400
    if fresh and (entry.get("genre_checked") or not need_genre):
        return entry
    if not fresh:
        entry = {"name": name, "ts": time.time()}
        found = directories.deezer("/search/artist", q=name, limit=5) or {}
        candidates = found.get("data") or []
        match = next((a for a in candidates if norm(a.get("name")) == key), None)
        if match:
            entry.update(deezer_id=match["id"], name=match.get("name") or name, image=match.get("picture_medium"))
            top = directories.deezer(f"/artist/{match['id']}/top", limit=10) or {}
            entry["top"] = [deezer_track(t) for t in top.get("data") or []]
            related = directories.deezer(f"/artist/{match['id']}/related", limit=15) or {}
            entry["related"] = [{"name": a.get("name"), "deezer_id": a.get("id")}
                                for a in related.get("data") or [] if a.get("name")]
        else:
            entry.update(top=[], related=[])
        similar = directories.lastfm("artist.getsimilar", artist=name, limit=15)
        if similar:
            names = [a.get("name") for a in (similar.get("similarartists") or {}).get("artist") or [] if a.get("name")]
            known = {norm(r["name"]) for r in entry["related"]}
            # Last.fm ist bei ähnlichen Interpreten meist treffsicherer: zuerst
            entry["related"] = [{"name": n} for n in names if norm(n) not in known] + entry["related"]
        cache[key] = entry
    if need_genre and not entry.get("genre_checked"):
        entry["genre"] = find_genre(entry, directories)
        entry["genre_checked"] = True
    return entry


def find_genre(entry, directories):
    tags = directories.lastfm("artist.gettoptags", artist=entry["name"])
    if tags:
        for tag in ((tags.get("toptags") or {}).get("tag") or [])[:8]:
            bucket = genre_bucket(tag.get("name"))
            if bucket:
                return bucket
    # Deezer: Genres der Alben der bekanntesten Songs
    for track in (entry.get("top") or [])[:3]:
        if not track.get("album_id"):
            continue
        album = directories.deezer(f"/album/{track['album_id']}") or {}
        for genre in (album.get("genres") or {}).get("data") or []:
            bucket = genre_bucket(genre.get("name"))
            if bucket:
                return bucket
    return None


def related_tracks(name, deezer_id, directories, cache):
    """Top-Songs eines ähnlichen Interpreten (ohne Genre-Abfrage)."""
    key = norm(name)
    entry = cache.get(key)
    if entry and time.time() - entry.get("ts", 0) < CACHE_DAYS * 86400:
        return entry.get("top") or []
    if deezer_id:
        top = directories.deezer(f"/artist/{deezer_id}/top", limit=10) or {}
        tracks = [deezer_track(t) for t in top.get("data") or []]
        cache[key] = {"name": name, "ts": time.time(), "deezer_id": deezer_id, "top": tracks, "related": []}
        return tracks
    return artist_info(name, directories, cache, need_genre=False).get("top") or []


# ---------- Hörprofil ----------

def decay(timestamp, now):
    days = max(0.0, (now - (timestamp or now)) / 86400)
    return 0.5 ** (days / HALF_LIFE_DAYS)


def build_profile(plays, favorite_tracks, now=None):
    """Interpreten nach Beliebtheit: gespielt (mit Abklingen), übersprungen zählt negativ."""
    now = now or time.time()
    artists = {}

    def add(track, weight):
        name = main_artist(track.get("artist") or "")
        key = norm(name)
        if not key or track.get("source") == "radio":
            return
        a = artists.setdefault(key, {"name": name, "score": 0.0, "tracks": {}})
        a["score"] += weight
        song = song_key(track.get("artist"), track.get("title"))
        old = a["tracks"].get(song)
        if not old or weight > old[0]:
            a["tracks"][song] = (weight, track)

    for entry in plays.values():
        weight = (entry.get("count", 0) - 1.5 * entry.get("skips", 0)) * decay(entry.get("last"), now)
        add(entry["track"], weight)
    for track in favorite_tracks:
        add(track, 1.5)
    return sorted((a for a in artists.values() if a["score"] > 0), key=lambda a: -a["score"])


# ---------- Mixe zusammenstellen ----------

def spread(tracks):
    """Mischen, aber nie zweimal derselbe Interpret hintereinander (wenn möglich)."""
    pool = tracks[:]
    random.shuffle(pool)
    result = []
    while pool:
        last = norm(main_artist(result[-1]["artist"])) if result else None
        index = next((i for i, t in enumerate(pool) if norm(main_artist(t["artist"])) != last), 0)
        result.append(pool.pop(index))
    return result


def generate(plays, favorite_tracks, blocked, cache, resolve, lastfm_key=None, progress=None):
    """Liefert eine Liste von Mixen: {name, genre, description, seeds, tracks}.

    resolve(vorschlag) -> Mix-Titel mit seinen Quellen (dict) oder None, wenn nirgends abspielbar
    """
    say = progress or (lambda text: None)
    directories = Directories(lastfm_key)
    profile = build_profile(plays, favorite_tracks)
    if not profile:
        raise ValueError("Noch zu wenig gehört: Spielt ein paar Songs ab oder legt Favoriten an, dann klappt das Mischen.")
    seeds = profile[:MAX_SEEDS]
    known_songs = {song for a in profile for song in a["tracks"]} | set(plays) | set(blocked)
    seed_keys = {norm(a["name"]) for a in seeds}

    # 1) Genre der meistgehörten Interpreten bestimmen
    groups = {}
    for i, seed in enumerate(seeds, 1):
        say(f"Hörprofil auswerten: {seed['name']} ({i}/{len(seeds)})")
        info = artist_info(seed["name"], directories, cache)
        seed["info"] = info
        genre = info.get("genre") or "Gemischt"
        groups.setdefault(genre, []).append(seed)

    # Wenig Material: alles in einen Mix. Sonst die stärksten Genres (mind. 2 Interpreten).
    ranked = sorted(groups.items(), key=lambda g: -sum(s["score"] for s in g[1]))
    strong = [(g, s) for g, s in ranked if g != "Gemischt" and len(s) >= 2][:MAX_MIXES]
    if len(strong) < 2:
        strong = [("Gemischt", seeds)]
    else:
        # Interpreten aus schwachen Genres dem passendsten (grössten) Mix zuschlagen, nicht verlieren
        used = {norm(s["name"]) for _, group in strong for s in group}
        leftovers = [s for s in seeds if norm(s["name"]) not in used]
        strong[0] = (strong[0][0], strong[0][1] + leftovers[:2])

    lookups = {"left": MAX_LOOKUPS}
    used_songs = set()
    mixes = []
    for genre, group in strong:
        title = "Mix: Entdeckt für euch" if genre == "Gemischt" else f"Mix: {genre}"
        say(f"{title} zusammenstellen …")
        tracks = build_mix(group, profile, known_songs, used_songs, seed_keys, directories, cache, resolve, lookups)
        if len(tracks) < 5:
            continue
        names = [s["name"] for s in group[:3]]
        mixes.append({
            "name": title,
            "genre": genre,
            "description": f"{', '.join(names)} und mehr",
            "seeds": [s["name"] for s in group[:8]],
            "tracks": tracks,
        })
    if not mixes:
        raise ValueError("Es konnten keine passenden Songs gefunden werden. Ist Spotify verbunden?")
    return mixes


def build_mix(group, profile, known_songs, used_songs, seed_keys, directories, cache, resolve, lookups):
    # 2) Ähnliche Interpreten sammeln – wer zu mehreren Lieblingen passt, zählt mehr
    related = {}
    for rank, seed in enumerate(group[:6]):
        weight = 1.0 / (1 + rank * 0.4)
        for position, artist in enumerate(seed["info"].get("related", [])[:10]):
            key = norm(artist["name"])
            if not key or key in seed_keys:
                continue
            r = related.setdefault(key, {"name": artist["name"], "deezer_id": artist.get("deezer_id"), "score": 0.0})
            r["score"] += weight * (1 - position / 12)
            r["deezer_id"] = r["deezer_id"] or artist.get("deezer_id")
    picked = sorted(related.values(), key=lambda r: -r["score"] * random.uniform(0.7, 1.3))[:14]

    candidates = []    # (Priorität, Titelinfo)
    per_artist = {}

    def offer(track, priority, limit=2):
        if not track.get("title") or not track.get("artist"):
            return
        song = song_key(track["artist"], track["title"])
        artist = norm(main_artist(track["artist"]))
        if song in known_songs or song in used_songs or per_artist.get(artist, 0) >= limit:
            return
        per_artist[artist] = per_artist.get(artist, 0) + 1
        used_songs.add(song)
        candidates.append((priority * random.uniform(0.8, 1.2), track))

    for r in picked:
        top = related_tracks(r["name"], r.get("deezer_id"), directories, cache)
        for track in random.sample(top[:6], min(len(top[:6]), 3)):
            offer(track, r["score"])

    # Last.fm: zu den Lieblingssongs passende Songs
    if directories.lastfm_key:
        favorites = sorted(((w, t) for s in group for w, t in s["tracks"].values()), key=lambda x: -x[0])[:4]
        for _, fav in favorites:
            data = directories.lastfm("track.getsimilar", artist=main_artist(fav["artist"]),
                                      track=clean_title(fav["title"]), limit=12)
            for item in ((data or {}).get("similartracks") or {}).get("track") or []:
                track = {"title": item.get("name"), "artist": (item.get("artist") or {}).get("name")}
                offer(track, 1.2 * float(item.get("match") or 0.5))

    # Weniger bekannte Songs der eigenen Lieblinge
    for seed in group[:4]:
        for track in (seed["info"].get("top") or [])[:8]:
            if song_key(track["artist"], track["title"]) not in known_songs:
                offer(track, 0.6, limit=1)
                break

    # 3) Auf Spotify (bzw. lokal/YouTube) suchen, bis der Mix voll ist
    candidates.sort(key=lambda c: -c[0])
    fresh = []
    for _, candidate in candidates:
        if len(fresh) >= MIX_SIZE - KNOWN_PER_MIX or lookups["left"] <= 0:
            break
        lookups["left"] -= 1
        track = resolve(candidate)
        if track:
            fresh.append({**track, "new": True})

    # 4) Ein paar bekannte Lieblingssongs dazumischen
    favorites = sorted(((w, t) for s in group for w, t in s["tracks"].values()), key=lambda x: -x[0])[:15]
    known = [t for _, t in random.sample(favorites, min(len(favorites), KNOWN_PER_MIX))]
    known = [{k: v for k, v in t.items() if k not in ("id", "play_id", "filler", "new")} for t in known]
    room = MIX_SIZE - len(fresh)
    return spread(fresh + known[:room])


def nightly_due(now_struct, last_day, hour=4):
    """Jede Nacht ab 4 Uhr einmal."""
    return now_struct.tm_hour >= hour and time.strftime("%Y-%m-%d", now_struct) != last_day


def score_entry(entry, now):
    """Für das Ausdünnen der Statistik: wenig gespielt und lange her fliegt zuerst."""
    return (entry.get("count", 0) + 0.5) * decay(entry.get("last"), now) - math.log1p(entry.get("skips", 0))
