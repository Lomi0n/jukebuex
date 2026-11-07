import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { API, actions } from './jukebox'

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

// Spotify Web API aufrufen, bei Bedarf mit Wiederholung
async function webApi(method, path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const token = await getToken()
      const response = await fetch(`https://api.spotify.com/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (response.ok) return true
      if (response.status === 401) tokenCache.value = null
    } catch (error) {
      console.warn('Spotify-Anfrage fehlgeschlagen', error)
    }
    await new Promise(resolve => setTimeout(resolve, 1000))  // z. B. Gerät noch nicht bereit
  }
  return false
}

// Spielt Spotify-Titel auf dem Surface ab. Das Surface erscheint in Spotify als Gerät "Jukebox".
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
  const [ready, setReady] = useState(false)
  const [blocked, setBlocked] = useState(false)
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

  // Player erstellen, sobald Spotify verbunden ist
  useEffect(() => {
    if (!connected) return
    let player
    let cancelled = false
    loadSpotifySdk().then(Spotify => {
      if (cancelled) return
      player = new Spotify.Player({
        name: 'Jukebox',
        getOAuthToken: callback => getToken().then(callback).catch(() => onError('Spotify-Anmeldung abgelaufen – bitte neu verbinden.')),
        volume: volumeRef.current / 100,
      })
      player.addListener('ready', ({ device_id }) => {
        deviceRef.current = device_id
        setReady(true)
        onError(null)
      })
      player.addListener('not_ready', () => setReady(false))
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
      setReady(false)
    }
  }, [connected])

  async function startTrack(track) {
    startedRef.current = track.play_id
    seenPlayingRef.current = false
    lastPosRef.current = 0
    const ok = await webApi('PUT', `/me/player/play?device_id=${deviceRef.current}`, { uris: [track.ref] })
    if (!ok && currentRef.current?.play_id === track.play_id) {
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
