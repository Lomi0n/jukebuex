/* JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE). */
import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { API, actions, branding } from './jukebox'

// Lädt das offizielle Spotify Web Playback SDK (nur einmal)
let sdkPromise
function loadSpotifySdk() {
  if (window.Spotify?.Player) return Promise.resolve(window.Spotify)
  if (!sdkPromise) {
    sdkPromise = new Promise(resolve => {
      window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify)
      const script = document.createElement('script')
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      document.head.appendChild(script)
    })
  }
  return sdkPromise
}

// Zugriffstoken vom eigenen Server holen (wird dort automatisch erneuert)
const tokenCache = { value: null, expires: 0 }
async function getToken() {
  if (tokenCache.value && Date.now() < tokenCache.expires) return tokenCache.value
  const response = await fetch(`${API}/api/spotify/token`)
  if (!response.ok) throw new Error('Kein Spotify-Token')
  const data = await response.json()
  tokenCache.value = data.access_token
  tokenCache.expires = Date.now() + Math.max(0, data.expires_in - 60) * 1000
  return tokenCache.value
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Spotify Web API aufrufen, bei Bedarf mit Wiederholung. Liefert { ok, status, data }.
async function webApi(method, path, body, attempts = 4) {
  let status = 0
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const token = await getToken()
      const response = await fetch(`https://api.spotify.com/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      status = response.status
      if (response.ok) {
        const data = response.status === 204 ? null : await response.json().catch(() => null)
        return { ok: true, status, data }
      }
      if (response.status === 401) tokenCache.value = null
    } catch (error) {
      console.warn('Spotify-Anfrage fehlgeschlagen', error)
    }
    await sleep(1000)  // z. B. Gerät noch nicht bereit
  }
  return { ok: false, status }
}

// Name des Geräts in der Spotify-App – mit Untertitel, damit mehrere Jukeboxen unterscheidbar sind
function deviceName() {
  return [branding.name || 'JUKEBÜX', branding.subtitle].filter(Boolean).join(' – ').slice(0, 60)
}

// Spielt Spotify-Titel auf dem Jukebox-Gerät ab. Es erscheint in Spotify unter dem Namen der Jukebox.
export default function SpotifyEngine({ jb, connected, onError }) {
  const { current, paused, volume } = jb
  const playerRef = useRef(null)
  const deviceRef = useRef(null)
  const currentRef = useRef(current)
  const pausedRef = useRef(paused)
  const volumeRef = useRef(volume)
  const startedRef = useRef(null)     // play_id, das bei Spotify gestartet wurde
  const seenPlayingRef = useRef(false)
  const lastPosRef = useRef(0)
  const durationRef = useRef(0)
  const endedRef = useRef(null)
  const readyRef = useRef(false)
  const readyWaiters = useRef([])
  const [ready, setReady] = useState(false)
  const [blocked, setBlocked] = useState(false)
  // Wird hochgezählt, um den Spotify-Player komplett neu aufzubauen (Selbstheilung)
  const [generation, setGeneration] = useState(0)
  const lastRebuild = useRef(0)
  currentRef.current = current
  pausedRef.current = paused
  volumeRef.current = volume

  const active = current?.source === 'spotify'
  const playId = current?.play_id

  function isOurTrack(playing, track) {
    return playing && (playing.uri === track.ref || playing.linked_from?.uri === track.ref)
  }

  // Ende eines Titels erkennen
  function handleState(state) {
    const track = currentRef.current
    if (!state || track?.source !== 'spotify' || startedRef.current !== track.play_id) return
    const playing = state.track_window?.current_track
    const ours = isOurTrack(playing, track)
    if (ours && !state.paused && state.position > 0) {
      seenPlayingRef.current = true
      lastPosRef.current = state.position
      durationRef.current = state.duration
    }
    const reachedEnd = state.paused && state.position === 0 &&
      lastPosRef.current >= durationRef.current - 4000
    const otherTrack = playing && !ours   // Spotify-Autoplay hat etwas anderes gestartet
    if (seenPlayingRef.current && (reachedEnd || otherTrack) && endedRef.current !== track.play_id) {
      endedRef.current = track.play_id
      actions.ended(track.play_id)
    }
  }

  function markReady(value) {
    readyRef.current = value
    setReady(value)
    if (value) {
      readyWaiters.current.splice(0).forEach(resolve => resolve(true))
    }
  }

  // Warten, bis der (neu aufgebaute) Player bei Spotify angemeldet ist
  function waitForReady(ms = 15000) {
    if (readyRef.current) return Promise.resolve(true)
    return new Promise(resolve => {
      readyWaiters.current.push(resolve)
      setTimeout(() => resolve(false), ms)
    })
  }

  // Player neu aufbauen – z. B. wenn Spotify das Gerät über Nacht vergessen hat
  function rebuild(reason) {
    if (Date.now() - lastRebuild.current < 20000) return false   // nicht in Endlosschleife
    lastRebuild.current = Date.now()
    console.warn('Spotify-Player wird neu verbunden:', reason)
    tokenCache.value = null
    markReady(false)
    setGeneration(g => g + 1)
    return true
  }

  // Player erstellen, sobald Spotify verbunden ist
  useEffect(() => {
    if (!connected) return
    let player
    let cancelled = false
    loadSpotifySdk().then(Spotify => {
      if (cancelled) return
      player = new Spotify.Player({
        name: deviceName(),
        getOAuthToken: callback => getToken().then(callback).catch(() => onError('Spotify-Anmeldung abgelaufen – bitte neu verbinden.')),
        volume: volumeRef.current / 100,
      })
      player.addListener('ready', ({ device_id }) => {
        if (cancelled) return
        deviceRef.current = device_id
        markReady(true)
        onError(null)
      })
      // Verbindung zu Spotify verloren: das SDK versucht es selbst, sonst baut der Wächter neu auf
      player.addListener('not_ready', () => { if (!cancelled) markReady(false) })
      player.addListener('initialization_error', ({ message }) => onError(`Spotify-Player konnte nicht starten: ${message}`))
      player.addListener('authentication_error', () => onError('Spotify-Anmeldung abgelaufen – bitte neu verbinden.'))
      player.addListener('account_error', () => onError('Für die Wiedergabe wird Spotify Premium benötigt.'))
      player.addListener('playback_error', ({ message }) => console.warn('Spotify-Wiedergabefehler', message))
      player.addListener('autoplay_failed', () => setBlocked(true))
      player.addListener('player_state_changed', handleState)
      player.connect()
      playerRef.current = player
    })

    // Browser-Freigabe für Ton beim ersten Tippen auf die Seite
    const unlock = () => playerRef.current?.activateElement?.()
    document.addEventListener('click', unlock)
    return () => {
      cancelled = true
      document.removeEventListener('click', unlock)
      player?.disconnect()
      playerRef.current = null
      markReady(false)
    }
  }, [connected, generation])

  // Wächter: alle 2 Minuten prüfen, ob Spotify unser Gerät noch kennt.
  // Nach vielen Stunden ohne Wiedergabe vergisst Spotify das Gerät manchmal still und leise –
  // bisher half dann nur ein Neustart der Jukebox.
  useEffect(() => {
    if (!connected) return
    let notReadySince = 0
    const timer = setInterval(async () => {
      if (!readyRef.current) {
        notReadySince = notReadySince || Date.now()
        if (Date.now() - notReadySince > 60000) rebuild('Player seit über 1 Minute nicht bereit')
        return
      }
      notReadySince = 0
      const result = await webApi('GET', '/me/player/devices', undefined, 1)
      if (!result.ok) return   // Netz weg o. Ä. – nächstes Mal wieder
      const known = (result.data?.devices || []).some(d => d.id === deviceRef.current)
      if (!known) rebuild('Gerät ist bei Spotify nicht mehr bekannt')
    }, 120000)
    return () => clearInterval(timer)
  }, [connected])

  async function startTrack(track) {
    startedRef.current = track.play_id
    seenPlayingRef.current = false
    lastPosRef.current = 0
    if (!readyRef.current) await waitForReady()
    const result = await webApi('PUT', `/me/player/play?device_id=${deviceRef.current}`, { uris: [track.ref] })
    if (result.ok || currentRef.current?.play_id !== track.play_id) return
    // Gerät unbekannt oder Player hängt: einmal neu verbinden. Sobald der neue Player bereit ist,
    // startet der Effekt "Neuer Titel" den Titel automatisch nochmals.
    if (result.status !== 403 && rebuild(`Abspielen fehlgeschlagen (${result.status || 'Netz'})`)) {
      if (await waitForReady(20000)) return
    }
    if (currentRef.current?.play_id === track.play_id) {
      onError(`„${track.title}“ konnte auf Spotify nicht abgespielt werden.`)
      actions.ended(track.play_id)  // überspringen statt hängen bleiben
    }
  }

  // Neuer Titel
  useEffect(() => {
    if (!ready) return
    if (active) {
      if (!pausedRef.current) startTrack(current)
    } else if (startedRef.current) {
      startedRef.current = null
      playerRef.current?.pause()
    }
  }, [playId, ready])

  // Pause / Weiter
  useEffect(() => {
    const player = playerRef.current
    if (!ready || !player || !active) return
    if (paused) player.pause()
    else if (startedRef.current !== current.play_id) startTrack(current)
    else player.resume()
  }, [paused])

  // Lautstärke
  useEffect(() => {
    if (ready) playerRef.current?.setVolume(volume / 100)
  }, [volume, ready])

  // Spulen
  useEffect(() => jb.onSeek(position => {
    if (currentRef.current?.source === 'spotify') playerRef.current?.seek(Math.round(position * 1000))
  }), [])

  // Fortschritt jede Sekunde melden
  useEffect(() => {
    if (!ready || !active) return
    const timer = setInterval(async () => {
      const state = await playerRef.current?.getCurrentState()
      const track = currentRef.current
      if (!state || !track || !isOurTrack(state.track_window?.current_track, track)) return
      if (!state.paused) lastPosRef.current = state.position
      durationRef.current = state.duration
      const position = state.position / 1000
      const duration = state.duration / 1000
      jb.setPosition(position)
      jb.setDuration(duration)
      jb.sendPosition(position, duration)
    }, 1000)
    return () => clearInterval(timer)
  }, [ready, active, playId])

  if (!(active && blocked)) return null
  return (
    <button className="unlock" onClick={async () => {
      await playerRef.current?.activateElement?.()
      setBlocked(false)
      startTrack(currentRef.current)
    }}>
      <Volume2 size={22} /> Tippen, um die Wiedergabe zu aktivieren
    </button>
  )
}
