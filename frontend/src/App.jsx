/* JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE). */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Disc3, Search, HardDrive, ListMusic, Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Laptop, MonitorSpeaker, History as HistoryIcon, X,
  LibraryBig, ListStart, Shuffle, ArrowLeft, Heart, Star, Link2, ListVideo, CircleDot,
  Bluetooth, BluetoothConnected, BluetoothOff, Server, Radio as RadioIcon, Power, Repeat
} from 'lucide-react'
import { useJukebox, actions, radioActions, getJson, getResult, API, branding } from './jukebox'
import AudioEngine from './AudioEngine'
import YouTubeEngine from './YouTubeEngine'
import SpotifyEngine from './SpotifyEngine'
import Keyboard from './Keyboard'
import { Cover, SourceBadge, TrackRow, SortableList, FavoritesContext, formatTime, trackKey } from './components'
import { FavoritesView, FavoritePicker } from './Favorites'
import { AdminMenu, useLongPress } from './Admin'
import { SoundsView } from './Sounds'
import { RadioView } from './Radio'
import SoundEngine from './SoundEngine'
import Screensaver from './Screensaver'
import { Logo, Equalizer, Splash, useCoverColor, COPYRIGHT } from './Brand'
import { useFavorites as useContextFavorites } from './components'
import SetupWizard, { SetupNotice } from './Setup'
import './App.css'

// Surface:       http://localhost:8000/          (spielt ab, Vollbild)
// Fernbedienung: http://<IP-des-Surface>:8000/remote
// Einrichtung vom PC: http://<IP-des-Surface>:8000/setup
const IS_REMOTE = window.location.pathname.startsWith('/remote')
const IS_SETUP = window.location.pathname.startsWith('/setup')

export default function App() {
  const [info, setInfo] = useState(null)
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    let timer
    async function load() {
      const data = await getJson('/api/info')
      if (data) {
        branding.name = data.name || 'JUKEBÜX'
        branding.subtitle = data.subtitle || ''
        document.title = IS_REMOTE ? `${branding.name} – Fernbedienung` : branding.name
        setInfo(data)
      } else {
        setOffline(true)
        timer = setTimeout(load, 2000)   // Server startet noch
      }
    }
    load()
    return () => clearTimeout(timer)
  }, [])

  if (!info) return offline ? <div className="boot muted">Warte auf den Jukebox-Server …</div> : null
  if (IS_SETUP) return <SetupWizard onDevice={false} />
  if (info.setup_open) return IS_REMOTE ? <SetupNotice /> : <SetupWizard onDevice />
  return <JukeboxApp info={info} />
}

function JukeboxApp({ info }) {
  const audioRef = useRef(null)
  const jb = useJukebox(!IS_REMOTE)
  const [view, setView] = useState(IS_REMOTE ? 'search' : 'now')
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const [spotify, setSpotify] = useState(null)        // Verbindungsstatus
  const [spotifyError, setSpotifyError] = useState(null)
  const [collection, setCollection] = useState(null)  // geöffnete Spotify-Playlist / Album
  const [searchCollection, setSearchCollection] = useState(null)  // aus der Suche geöffnet
  const [favOpenId, setFavOpenId] = useState(null)    // geöffnete Favoritenliste
  const [picker, setPicker] = useState(null)          // { track, anchor } für die Listenauswahl
  const [admin, setAdmin] = useState(false)           // verstecktes Wartungsmenü
  const coverColor = useCoverColor(jb.current)        // Grundfarbe aus dem aktuellen Cover

  // Für die Sterne: welche Titel stecken in irgendeiner Favoritenliste?
  const favorites = useMemo(() => ({
    keys: new Set(jb.favorites.flatMap(list => list.tracks.map(trackKey))),
    pick: (track, element) => setPicker({ track, anchor: element.getBoundingClientRect() }),
  }), [jb.favorites])

  useEffect(() => {
    getJson('/api/spotify/status').then(setSpotify)
    if (IS_REMOTE) return
    // Rückkehr von der Spotify-Anmeldung
    const result = new URLSearchParams(window.location.search).get('spotify')
    if (result) {
      notify(result === 'connected' ? 'Spotify ist verbunden' : 'Spotify-Anmeldung fehlgeschlagen')
      window.history.replaceState(null, '', '/')
    }
  }, [])

  function notify(text, kind = 'ok', ms = 2200) {
    setToast({ text, kind })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }

  // Meldungen vom Server (z. B. «YouTube-Kontingent aufgebraucht – läuft über Spotify»)
  useEffect(() => {
    if (jb.notice) notify(jb.notice.text, 'warn', 6000)
  }, [jb.notice?.nonce])

  async function enqueue(track, next = false) {
    const result = await actions.enqueue(track, next)
    if (!result) return
    const name = `„${track.title}“`
    // Doppelte Wünsche: nicht nochmals einreihen, sondern Bescheid geben
    if (result.status === 'playing') notify(`${name} läuft gerade`, 'warn')
    else if (result.status === 'duplicate') notify(`${name} steht schon auf Platz ${result.position} der Warteschlange`, 'warn')
    else if (result.status === 'moved') notify(`${name} von Platz ${result.from} nach vorne geholt`)
    else notify(next ? `${name} wird als Nächstes gespielt` : `${name} zur Warteschlange hinzugefügt`)
  }

  async function enqueueMany(tracks, next = false) {
    if (!tracks.length) return
    const result = await actions.enqueueMany(tracks, next)
    if (!result) return
    const skipped = result.skipped ? ` (${result.skipped} waren schon drin)` : ''
    if (!result.added) notify(`Alle ${tracks.length} Titel sind schon in der Warteschlange`, 'warn')
    else notify(`${result.added} Titel ${next ? 'als Nächstes eingereiht' : 'zur Warteschlange hinzugefügt'}${skipped}`)
  }

  function navigate(key) {
    if (key === 'spotify') setCollection(null)
    if (key === 'favorites') setFavOpenId(null)
    setView(key)
  }

  // Album oder YouTube-Playlist aus der Suche öffnen; "Zurück" führt wieder zur Suche
  function openFromSearch(item) {
    setSearchCollection({ ...item, from: 'search' })
    setView('collection')
  }

  return (
    <FavoritesContext.Provider value={favorites}>
    <div className={`shell ${IS_REMOTE ? 'is-remote' : 'is-surface'} ${jb.current?.source === 'youtube' ? 'yt-active' : ''}`}
      style={coverColor ? { '--cover': coverColor } : undefined}>
      {!IS_REMOTE && (
        <>
          <AudioEngine jb={jb} audioRef={audioRef} />
          <YouTubeEngine jb={jb} />
          <SpotifyEngine jb={jb} connected={Boolean(spotify?.connected)} onError={setSpotifyError} />
          <SoundEngine jb={jb} />
        </>
      )}

      <Sidebar view={view} navigate={navigate} connected={jb.connected} spotify={spotify} spotifyError={spotifyError}
        onAdmin={() => setAdmin(true)} bluetooth={jb.bluetooth} info={info} />

      <main className="main">
        {view === 'now' && <NowPlaying jb={jb} enqueue={enqueue} goSearch={() => setView('search')} />}
        {/* Suche bleibt im Hintergrund erhalten, damit Suchbegriff und Treffer nicht verloren gehen */}
        <SearchView active={view === 'search'} enqueue={enqueue} openCollection={openFromSearch} />
        {view === 'collection' && searchCollection && (
          <CollectionView collection={searchCollection} onBack={() => setView('search')}
            enqueue={enqueue} enqueueMany={enqueueMany} />
        )}
        {view === 'favorites' && (
          <FavoritesView lists={jb.favorites} mixes={jb.mixes} current={jb.current} openId={favOpenId} setOpenId={setFavOpenId}
            enqueue={enqueue} enqueueMany={enqueueMany} notify={notify} />
        )}
        {view === 'radio' && <RadioView jb={jb} notify={notify} />}
        {view === 'sounds' && <SoundsView jb={jb} notify={notify} />}
        {view === 'spotify' && (
          <SpotifyView collection={collection} onBack={() => setCollection(null)}
            setCollection={setCollection} enqueue={enqueue} enqueueMany={enqueueMany} />
        )}
        {view === 'library' && <LibraryView enqueue={enqueue} musicDir={info.music_dir} />}
      </main>

      <QueuePanel jb={jb} />
      <PlayerBar jb={jb} />

      {picker && <FavoritePicker track={picker.track} anchor={picker.anchor} lists={jb.favorites}
        notify={notify} onClose={() => setPicker(null)} />}

      {admin && <AdminMenu onClose={() => setAdmin(false)} />}
      {!IS_REMOTE && <Screensaver jb={jb} />}
      {!IS_REMOTE && <Splash connected={jb.connected} />}

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
    </FavoritesContext.Provider>
  )
}

// ---------- Seitenleiste ----------

function Sidebar({ view, navigate, connected, spotify, spotifyError, onAdmin, bluetooth, info }) {
  // Logo 2 Sekunden gedrückt halten = Wartungsmenü (nur am Jukebox-Gerät)
  const longPress = useLongPress(onAdmin)

  const nav = [
    ['now', Disc3, 'Jetzt läuft'],
    ['search', Search, 'Suchen'],
    ['favorites', Star, 'Favoriten'],
    ['radio', RadioIcon, 'Radio'],
    ['sounds', CircleDot, 'Soundboard'],
    ...(spotify?.configured ? [['spotify', LibraryBig, 'Spotify']] : []),
    ['library', HardDrive, 'Lokale Musik'],
  ]

  return (
    <aside className="sidebar panel">
      <div className="logo">
        <div className={`logo-icon ${longPress.pressing ? 'pressing' : ''}`} {...(IS_REMOTE ? {} : longPress.handlers)}>
          <Logo size={46} />
        </div>
        <div>
          <strong>{branding.name}{info?.version && <small className="logo-version">v{info.version}</small>}</strong>
          {(IS_REMOTE || branding.subtitle) && <span>{IS_REMOTE ? 'Fernbedienung' : branding.subtitle}</span>}
        </div>
      </div>

      <nav>
        {nav.map(([key, Icon, label]) => (
          <button key={key} className={view === key || (key === 'search' && view === 'collection') ? 'active' : ''}
            onClick={() => navigate(key)}>
            <Icon size={22} /> {label}
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <StatusPanel connected={connected} spotify={spotify} spotifyError={spotifyError} bt={bluetooth} />
        <div className="status-hint">
          {IS_REMOTE
            ? <><Laptop size={14} /> Musik spielt auf der Jukebox</>
            : info && <><MonitorSpeaker size={14} /> <span>Wünsche: <b>{info.remote_url.replace(/^https?:\/\//, '')}</b></span></>}
        </div>
        <div className="copyright">{COPYRIGHT}</div>
      </div>
    </aside>
  )
}

// Kompakte Statusanzeige unten links: Stereoanlage, Spotify, Server
function StatusPanel({ connected, spotify, spotifyError, bt }) {
  const rows = []

  // Stereoanlage (vom Bluetooth-Wächter auf dem Surface gemeldet)
  if (bt) {
    let state, text, title = bt.name || bt.mac || ''
    if (!bt.watcher) { state = 'unknown'; text = 'Unbekannt'; title = 'Bluetooth-Wächter läuft nicht' }
    else if (!bt.mac) { state = 'unknown'; text = 'Nicht eingerichtet'; title = 'SPEAKER_MAC in config.env fehlt' }
    else if (bt.connecting) { state = 'busy'; text = 'Verbinde …' }
    else if (bt.connected && bt.sink_ok) { state = 'on'; text = 'Verbunden' }
    else if (bt.connected) {
      // Verbunden, aber der Audioausgang der Box wurde (noch) nicht gefunden
      state = 'busy'; text = 'Verbunden'
      title = `${title} – verbunden, aber der Ton läuft evtl. noch nicht über die Box`
    }
    else { state = 'off'; text = 'Getrennt' }
    const Icon = bt.connected ? BluetoothConnected : state === 'off' ? BluetoothOff : Bluetooth
    // "Verbinden" nur anbieten, wenn die Box wirklich getrennt ist
    const canConnect = bt.watcher && bt.mac && !bt.connecting && state === 'off'
    rows.push({ key: 'bt', Icon, label: 'Lautsprecher', state, text, title,
      action: canConnect ? { label: 'Verbinden', run: () => actions.bluetoothReconnect() } : null })
  }

  // Spotify
  if (spotify?.configured) {
    const login = () => { window.location.href = `${API}/api/spotify/login` }
    let state = 'on', text = 'Verbunden', action = null
    if (spotifyError) { state = 'busy'; text = 'Problem' }
    if (!spotify.connected) { state = 'off'; text = 'Nicht verbunden'; action = IS_REMOTE ? null : { label: 'Anmelden', run: login } }
    else if (spotify.needs_reconnect) { state = 'busy'; text = 'Neu verbinden'; action = IS_REMOTE ? null : { label: 'Verbinden', run: login } }
    rows.push({ key: 'spotify', Icon: LibraryBig, label: 'Spotify', state, text,
      title: spotifyError || (spotify.user ? `Angemeldet als ${spotify.user}` : ''), action })
  }

  // Verbindung zum Server
  rows.push({ key: 'server', Icon: Server, label: 'Server', state: connected ? 'on' : 'off', text: connected ? 'Online' : 'Offline' })

  return (
    <div className="status-panel">
      {rows.map(({ key, Icon, label, state, text, title, action }) => (
        <div key={key} className={`status-row st-${state}`} title={title}>
          <Icon size={16} />
          <span className="status-label">{label}</span>
          {action
            ? <button className="status-action" onClick={action.run}>{action.label}</button>
            : <span className="status-text">{text}</span>}
          <span className="status-dot" />
        </div>
      ))}
      {spotifyError && <p className="status-error">{spotifyError}</p>}
    </div>
  )
}

// ---------- Jetzt läuft ----------

function NowPlaying({ jb, enqueue, goSearch }) {
  const { current, history, playing } = jb

  if (!current) {
    return (
      <div className="now-empty">
        <Disc3 size={90} strokeWidth={1} />
        <h1>Gerade läuft nichts</h1>
        <p>Such dir einen Song aus und füg ihn zur Warteschlange hinzu.</p>
        <button className="btn-primary" onClick={goSearch}><Search size={20} /> Musik suchen</button>
        {history.length > 0 && <HistoryStrip history={history} enqueue={enqueue} />}
      </div>
    )
  }

  // Auf dem Surface wird bei YouTube das Video statt des Covers gezeigt
  const showVideo = !IS_REMOTE && current.source === 'youtube'
  if (current.source === 'radio') return <NowPlayingRadio jb={jb} enqueue={enqueue} />

  return (
    <div className="now">
      <div key={current.play_id} className={`now-hero ${showVideo ? 'with-video' : ''}`}>
        {showVideo
          ? <div id="yt-slot" className="video-slot" />
          : <Cover track={current} size={300} className={`now-cover ${playing ? 'is-playing' : ''}`} />}
        <div className="now-text">
          <span className="eyebrow"><Equalizer playing={playing} /> {playing ? 'Jetzt läuft' : 'Pausiert'}
            {current.filler === 'mix' && <span className="eyebrow-mix"> · aus {current.mix_name}</span>}
            {current.source === 'youtube' && !current.ref && <span className="eyebrow-mix"> · YouTube-Video wird gesucht …</span>}</span>
          <h1>{current.title}</h1>
          <p>{current.artist}{current.album ? ` · ${current.album}` : ''}</p>
          <div className="now-meta">
            <SourceBadge source={current.source} />
            <FavoriteButton track={current} />
          </div>
        </div>
      </div>
      {history.length > 0 && <HistoryStrip history={history} enqueue={enqueue} />}
    </div>
  )
}

// Radio: Sendername gross, darunter der laufende Song (falls der Sender ihn mitschickt)
function NowPlayingRadio({ jb, enqueue }) {
  const { current, history, playing } = jb
  const song = current.now_playing
  const [artist, title] = song && song.includes(' - ') ? song.split(/ - (.+)/) : [null, song]
  return (
    <div className="now">
      <div key={current.play_id} className="now-hero">
        <Cover track={current} size={300} className={`now-cover ${playing ? 'is-playing' : ''}`} />
        <div className="now-text">
          <span className="eyebrow"><Equalizer playing={playing} /> {playing ? 'Live im Radio' : 'Radio pausiert'}</span>
          <h1>{title || current.title}</h1>
          <p>{title ? `${artist ? `${artist} · ` : ''}${current.title}` : current.subtitle}</p>
          <div className="now-meta">
            <SourceBadge source="radio" />
            <span className="live-pill"><i /> Live</span>
            <button className="btn-secondary" onClick={() => radioActions.off()}><Power size={17} /> Radio aus</button>
          </div>
          <p className="radio-hint">Läuft, bis jemand einen Song wünscht. «Weiter» wechselt zum nächsten Sender.</p>
        </div>
      </div>
      {history.length > 0 && <HistoryStrip history={history} enqueue={enqueue} />}
    </div>
  )
}

function FavoriteButton({ track }) {
  const fav = useContextFavorites()
  const on = fav.keys.has(trackKey(track))
  return (
    <button className={`btn-secondary fav-btn ${on ? 'on' : ''}`} onClick={e => fav.pick(track, e.currentTarget)}>
      <Star size={18} fill={on ? 'currentColor' : 'none'} /> {on ? 'In Favoriten' : 'Zu Favoriten'}
    </button>
  )
}

function HistoryStrip({ history, enqueue }) {
  return (
    <section className="history">
      <h2><HistoryIcon size={20} /> Zuletzt gespielt <span className="count">{history.length}</span></h2>
      <div className="history-list">
        {history.map((track, i) => (
          <TrackRow key={`${track.id}-${i}`} track={track} index={i + 1}
            onPlay={() => actions.play(track)} onNext={() => enqueue(track, true)} onAdd={() => enqueue(track)} />
        ))}
      </div>
    </section>
  )
}

// ---------- Suche ----------

function SearchView({ active, enqueue, openCollection }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({})
  const [source, setSource] = useState('all')
  const [ytQuery, setYtQuery] = useState('')      // wofür YouTube zuletzt gesucht hat
  const [ytLoading, setYtLoading] = useState(false)
  const [keyboard, setKeyboard] = useState(false)
  const inputRef = useRef(null)
  const q = query.trim()

  // Eingefügte YouTube-Links erkennen
  const isLink = /^https?:\/\//i.test(q) || /(^|\.)youtu\.?be/i.test(q)
  const ytPlaylist = q.match(/[?&]list=([A-Za-z0-9_-]{10,})/)?.[1]
  const ytVideo = /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)[A-Za-z0-9_-]{11}/.test(q)

  // Beim Öffnen der Suche: Suchfeld aktivieren (auf dem Surface mit Tastatur)
  useEffect(() => {
    if (!active) return
    inputRef.current?.focus()
    if (!IS_REMOTE) setKeyboard(true)
  }, [active])

  // Spotify und lokale Musik live beim Tippen durchsuchen
  useEffect(() => {
    if (!q) { setResults({}); setYtQuery(''); return }
    if (isLink) {
      setResults({})
      if (ytVideo) searchYouTube()   // Video-Link: kostet nur 1 Einheit
      return
    }
    const timer = setTimeout(async () => {
      const data = await getJson(`/api/search?q=${encodeURIComponent(q)}&sources=local,spotify`)
      if (data) setResults(r => ({ ...r, ...data }))
    }, 400)
    return () => clearTimeout(timer)
  }, [q])

  // YouTube erst mit Enter durchsuchen (schont das tägliche Kontingent)
  async function searchYouTube(event) {
    event?.preventDefault()
    if (!q || ytLoading) return
    if (isLink && !ytVideo) return   // Playlist-Link: kein (teurer) Suchauftrag
    setYtLoading(true)
    const data = await getJson(`/api/search?q=${encodeURIComponent(q)}&sources=youtube`)
    setResults(r => ({ ...r, youtube: data ? data.youtube : { error: 'Server nicht erreichbar.' } }))
    setYtQuery(q)
    setYtLoading(false)
  }

  const sources = [
    ['all', 'Alle'], ['spotify', 'Spotify'], ['youtube', 'YouTube'], ['local', 'Lokal'],
  ]
  const shown = source === 'all' ? ['spotify', 'youtube', 'local'] : [source]

  return (
    <div className={`search ${keyboard && !IS_REMOTE ? 'with-keyboard' : ''}`} style={active ? undefined : { display: 'none' }}>
      <form className="search-bar" onSubmit={searchYouTube}>
        <Search size={24} />
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
          inputMode={IS_REMOTE ? undefined : 'none'}
          onFocus={() => !IS_REMOTE && setKeyboard(true)}
          placeholder="Was möchtest du hören? Titel, Interpret, Album …" />
        {query && <button type="button" className="icon-btn" onClick={() => setQuery('')}><X size={20} /></button>}
      </form>

      {!IS_REMOTE && active && keyboard && (
        <Keyboard
          value={query}
          onChange={setQuery}
          onEnter={() => { searchYouTube(); setKeyboard(false); inputRef.current?.blur() }}
          onClose={() => { setKeyboard(false); inputRef.current?.blur() }}
        />
      )}

      <div className="chips">
        {sources.map(([key, label]) => (
          <button key={key} className={source === key ? 'chip active' : 'chip'} onClick={() => setSource(key)}>
            {label}
          </button>
        ))}
      </div>

      {isLink ? (
        <section className="results">
          <h2><Link2 size={22} /> Link erkannt</h2>
          {ytPlaylist && (
            <button className="link-card" onClick={() => openCollection({ type: 'ytplaylist', id: ytPlaylist, name: 'YouTube-Playlist' })}>
              <ListVideo size={30} />
              <div>
                <strong>YouTube-Playlist öffnen</strong>
                <span>Alle Titel anzeigen, ganz oder gemischt einreihen</span>
              </div>
            </button>
          )}
          {ytVideo && (
            <ResultSection source="youtube" tracks={ytQuery === q ? results.youtube : undefined}
              loading={ytLoading} enqueue={enqueue} />
          )}
          {!ytPlaylist && !ytVideo && (
            <p className="muted">Dieser Link wird nicht unterstützt. Möglich sind YouTube-Links zu Videos und Playlists.</p>
          )}
        </section>
      ) : !q ? (
        <div className="search-start">
          <Search size={56} strokeWidth={1.2} />
          <h2>Musik suchen</h2>
          <p>Finde Songs auf Spotify, YouTube oder in der lokalen Sammlung und füge sie zur Warteschlange hinzu. Auch YouTube-Links zu Videos und Playlists lassen sich hier einfügen.</p>
        </div>
      ) : shown.map(key => key === 'youtube' ? (
        <ResultSection key={key} source={key}
          tracks={ytQuery === q ? results.youtube : 'pending'}
          loading={ytLoading} onSearch={searchYouTube} enqueue={enqueue} />
      ) : (
        <ResultSection key={key} source={key} tracks={results[key]} enqueue={enqueue}
          albums={key === 'spotify' ? results.spotify_albums : null} openCollection={openCollection} />
      ))}
    </div>
  )
}

function ResultSection({ source, tracks, enqueue, loading, onSearch, albums, openCollection }) {
  const names = { spotify: 'Spotify', youtube: 'YouTube', local: 'Lokale Musik' }
  let body
  if (loading) body = <p className="muted">Suche auf YouTube …</p>
  else if (tracks === 'pending') body = (
    <button className="btn-secondary" onClick={onSearch}>
      <Search size={18} /> Auf YouTube suchen <kbd>Enter</kbd>
    </button>
  )
  else if (tracks === null) body = <p className="muted">Nicht eingerichtet – Zugangsdaten fehlen in config.env.</p>
  else if (tracks === undefined) body = <p className="muted">Suche …</p>
  else if (tracks.error) body = <p className="muted error">{tracks.error}</p>
  else if (tracks.length === 0) body = <p className="muted">Keine Treffer.</p>
  else body = tracks.map(track => (
    <TrackRow key={track.id} track={track}
      onPlay={() => actions.play(track)} onNext={() => enqueue(track, true)} onAdd={() => enqueue(track)} />
  ))

  return (
    <section className="results">
      <h2><SourceBadge source={source} /> {names[source]}</h2>
      {body}
      {albums?.length > 0 && (
        <>
          <h3 className="sub-heading">Alben</h3>
          <div className="cards">
            {albums.map(album => (
              <button key={album.id} className="card"
                onClick={() => openCollection({ type: 'album', id: album.id, name: album.name })}>
                <Cover track={{ image: album.image, title: album.name, artist: album.artist }} size={140} />
                <strong>{album.name}</strong>
                <span>{album.artist}{album.year ? ` · ${album.year}` : ''}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

// ---------- Spotify-Mediathek ----------

function SpotifyView({ collection, onBack, setCollection, enqueue, enqueueMany }) {
  return collection
    ? <CollectionView collection={collection} onBack={onBack} enqueue={enqueue} enqueueMany={enqueueMany} />
    : <SpotifyHome open={setCollection} />
}

function SpotifyHome({ open }) {
  const [playlists, setPlaylists] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    getResult('/api/spotify/playlists').then(r => r.error ? setError(r.error) : setPlaylists(r.data))
  }, [])

  const own = playlists?.filter(p => p.available) || []
  const others = playlists?.filter(p => !p.available) || []

  return (
    <div className="spotify-home">
      <h1>Spotify-Mediathek</h1>
      <p className="muted">Deine Playlists und Lieblingssongs – ganz oder einzeln einreihen.</p>
      {error && <p className="muted error">{error}</p>}
      {!playlists && !error && <p className="muted">Lade …</p>}
      {playlists && (
        <div className="grid">
          <button className="card" onClick={() => open({ type: 'saved', name: 'Lieblingssongs' })}>
            <div className="cover liked-cover" style={{ width: 140, height: 140 }}><Heart size={52} fill="currentColor" /></div>
            <strong>Lieblingssongs</strong>
            <span>Deine gespeicherten Songs</span>
          </button>
          {own.map(p => (
            <button key={p.id} className="card" onClick={() => open({ type: 'playlist', id: p.id, name: p.name })}>
              <Cover track={{ image: p.image, title: p.name }} size={140} />
              <strong>{p.name}</strong>
              <span>{p.total ?? '?'} Titel</span>
            </button>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <>
          <h3 className="sub-heading">Gefolgte Playlists</h3>
          <p className="muted">
            Den Inhalt fremder Playlists (z. B. von Spotify selbst) gibt Spotify für private Apps nicht frei.
            Tipp: In der Spotify-App den Inhalt in eine eigene Playlist kopieren.
          </p>
          <div className="grid">
            {others.map(p => (
              <div key={p.id} className="card disabled">
                <Cover track={{ image: p.image, title: p.name }} size={140} />
                <strong>{p.name}</strong>
                <span>von {p.owner}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function shuffled(list) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function CollectionView({ collection, onBack, enqueue, enqueueMany }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const labels = { playlist: 'Playlist', album: 'Album', saved: 'Lieblingssongs', ytplaylist: 'YouTube-Playlist' }

  useEffect(() => {
    const path = collection.type === 'saved' ? '/api/spotify/saved'
      : collection.type === 'album' ? `/api/spotify/albums/${collection.id}`
      : collection.type === 'ytplaylist' ? `/api/youtube/playlist/${collection.id}`
      : `/api/spotify/playlists/${collection.id}`
    setData(null)
    setError(null)
    getResult(path).then(r => r.error ? setError(r.error) : setData(r.data))
  }, [collection])

  const tracks = data?.tracks || []
  const totalMinutes = Math.round(tracks.reduce((sum, t) => sum + (t.duration || 0), 0) / 60)

  return (
    <div className="collection">
      <button className="back" onClick={onBack}>
        <ArrowLeft size={20} /> {collection.from === 'search' ? 'Zurück zur Suche' : 'Spotify-Mediathek'}
      </button>
      <div className="collection-head">
        {collection.type === 'saved'
          ? <div className="cover liked-cover" style={{ width: 190, height: 190 }}><Heart size={70} fill="currentColor" /></div>
          : <Cover track={{ image: data?.image, title: collection.name }} size={190} />}
        <div className="collection-text">
          <span className="eyebrow">{labels[collection.type]}</span>
          <h1>{data?.name || collection.name}</h1>
          <p className="muted">
            {data?.subtitle}{data ? ` · ${tracks.length} Titel · ${totalMinutes} Min.` : ''}
          </p>
          {tracks.length > 0 && (
            <div className="collection-actions">
              <button className="btn-primary" onClick={() => enqueueMany(tracks)}>
                <ListMusic size={20} /> Alle einreihen
              </button>
              <button className="btn-secondary" onClick={() => enqueueMany(shuffled(tracks))}>
                <Shuffle size={18} /> Gemischt einreihen
              </button>
              <button className="btn-secondary" onClick={() => enqueueMany(tracks, true)}>
                <ListStart size={18} /> Als Nächstes
              </button>
            </div>
          )}
        </div>
      </div>

      {error && <p className="muted error">{error}</p>}
      {!data && !error && <p className="muted">Lade …</p>}
      {data && tracks.length === 0 && <p className="muted">Keine abspielbaren Titel gefunden.</p>}
      {tracks.map((track, i) => (
        <TrackRow key={`${track.id}-${i}`} track={track} index={i + 1}
          onPlay={() => actions.play(track)} onNext={() => enqueue(track, true)} onAdd={() => enqueue(track)} />
      ))}
    </div>
  )
}

// ---------- Lokale Musik ----------

function LibraryView({ enqueue, musicDir }) {
  const [library, setLibrary] = useState(null)
  useEffect(() => { getJson('/api/library').then(setLibrary) }, [])

  return (
    <div className="library">
      <h1>Lokale Musik</h1>
      <p className="muted">Dateien aus {musicDir} auf dem Jukebox-Gerät.</p>
      {library === null ? <p className="muted">Lade …</p>
        : library.length === 0 ? <p className="muted">Keine MP3- oder FLAC-Dateien gefunden.</p>
        : library.map(track => (
          <TrackRow key={track.id} track={track}
            onPlay={() => actions.play(track)} onNext={() => enqueue(track, true)} onAdd={() => enqueue(track)} />
        ))}
    </div>
  )
}

// ---------- Warteschlange (rechts) ----------

function QueuePanel({ jb }) {
  const { queue, current, playing, radio, mixes } = jb
  const station = radio.on && radio.stations.find(s => s.id === radio.station_id)
  const fillerMix = mixes.lists.find(m => m.id === mixes.filler_id)
  const filler = station?.name || fillerMix?.name
  return (
    <aside className="queue-panel panel">
      <h2><ListMusic size={22} /> Warteschlange <span className="count">{queue.length}</span></h2>

      {current && (
        <>
          <h3>Läuft gerade</h3>
          <div className="row current" key={current.play_id}>
            <Cover track={current} size={44} className={playing ? 'is-playing' : ''} />
            <div className="row-info">
              <strong>{current.title}</strong>
              <span>{current.artist}</span>
            </div>
            <Equalizer playing={playing} size={16} />
          </div>
        </>
      )}

      <h3>Als Nächstes</h3>
      {queue.length === 0
        ? <p className="muted">{filler
          ? current?.source === 'radio' || current?.filler
            ? `Die Warteschlange ist leer – ${filler} läuft, bis jemand einen Song wünscht.`
            : `Die Warteschlange ist leer. Danach läuft ${filler}.`
          : 'Die Warteschlange ist leer. Füge über die Suche Songs hinzu.'}</p>
        : <QueueList queue={queue} />}
      {filler && queue.length > 0 && (
        <p className="queue-radio">{station ? <RadioIcon size={15} /> : <Repeat size={15} />} Danach: {filler}</p>
      )}
    </aside>
  )
}

// Warteschlange: per Griff links umsortieren (Maus und Touch)
function QueueList({ queue }) {
  return (
    <SortableList items={queue} onMove={(track, index) => actions.move(track, index)}>
      {(track, i, drag) => (
        <TrackRow key={track.id} track={track} noFavorite
          handle={drag.handle} style={drag.style} className={drag.className}
          onPlay={() => actions.playFromQueue(track)}
          onNext={i > 0 ? () => actions.move(track, 0) : undefined}
          onRemove={() => actions.remove(track)} />
      )}
    </SortableList>
  )
}

// ---------- Player-Leiste (unten) ----------

function PlayerBar({ jb }) {
  const { current, playing, position, duration, volume } = jb
  return (
    <footer className="playerbar">
      <div className="pb-track">
        {current ? (
          <>
            <Cover track={current} size={58} />
            <div className="row-info">
              <strong>{current.title}</strong>
              <span>{current.artist}</span>
            </div>
          </>
        ) : <span className="muted">Kein Titel ausgewählt</span>}
      </div>

      <div className="pb-center">
        <div className="pb-buttons">
          <button className="icon-btn" onClick={actions.previous} aria-label="Zurück"><SkipBack size={24} fill="currentColor" /></button>
          <button className="pb-play" onClick={actions.toggle} aria-label="Play/Pause">
            {playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={actions.next} aria-label="Weiter"><SkipForward size={24} fill="currentColor" /></button>
        </div>
        {current?.source === 'radio' ? (
          <div className="pb-timeline pb-live">
            <span className="live-pill"><i /> Live</span>
          </div>
        ) : (
          <div className="pb-timeline">
            <span>{formatTime(position)}</span>
            <input type="range" min="0" max={duration || 0} step="1"
              value={Math.min(position, duration || 0)}
              onChange={e => jb.seekTo(Number(e.target.value))} />
            <span>{formatTime(duration)}</span>
          </div>
        )}
      </div>

      <div className="pb-volume">
        <button className="icon-btn" onClick={() => jb.changeVolume(volume > 0 ? 0 : 60)} aria-label="Stumm">
          {volume > 0 ? <Volume2 size={22} /> : <VolumeX size={22} />}
        </button>
        <input type="range" min="0" max="100" value={volume}
          onChange={e => jb.changeVolume(Number(e.target.value))} />
      </div>
    </footer>
  )
}
