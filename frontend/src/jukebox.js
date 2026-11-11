import { useEffect, useRef, useState } from 'react'

export const API = `${window.location.protocol}//${window.location.hostname}:8000`

// Name und Untertitel aus der Einrichtung (wird beim Start einmal gesetzt)
export const branding = { name: 'JUKEBÜX', subtitle: '' }
const WS = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:8000/ws`

// ---------- Server-Aufrufe ----------

async function request(method, path, body) {
  try {
    const options = { method }
    if (body !== undefined) {
      options.headers = { 'Content-Type': 'application/json' }
      options.body = JSON.stringify(body)
    }
    const response = await fetch(`${API}${path}`, options)
    if (!response.ok) throw new Error(`${response.status} ${path}`)
    return await response.json()
  } catch (error) {
    console.error('Aktion fehlgeschlagen:', error)
    return null
  }
}

// Wie getJson, liefert aber auch die Fehlermeldung des Servers: { data } oder { error }
export async function getResult(path) {
  try {
    const response = await fetch(`${API}${path}`)
    const body = await response.json().catch(() => null)
    if (!response.ok) return { error: body?.detail || `Fehler ${response.status}` }
    return { data: body }
  } catch {
    return { error: 'Server nicht erreichbar.' }
  }
}

export async function getJson(path) {
  try {
    const response = await fetch(`${API}${path}`)
    return await response.json()
  } catch (error) {
    console.error('Laden fehlgeschlagen:', error)
    return null
  }
}

function trackData(track) {
  const { title, artist, source, url, ref, image, album, duration } = track
  return { title, artist, source, url, ref, image, album, duration }
}

export const actions = {
  play: track => request('POST', '/api/play', trackData(track)),
  enqueue: (track, next = false) => request('POST', `/api/queue${next ? '?next=true' : ''}`, trackData(track)),
  enqueueMany: (tracks, next = false) => request('POST', '/api/queue/bulk', { tracks: tracks.map(trackData), next }),
  move: (track, index) => request('POST', `/api/queue/${encodeURIComponent(track.id)}/move`, { index }),
  playFromQueue: track => request('POST', `/api/queue/${encodeURIComponent(track.id)}/play`),
  remove: track => request('DELETE', `/api/queue/${encodeURIComponent(track.id)}`),
  next: () => request('POST', '/api/next'),
  previous: () => request('POST', '/api/previous'),
  toggle: () => request('POST', '/api/toggle'),
  ended: playId => request('POST', `/api/ended/${playId}`),
  volume: volume => request('POST', '/api/volume', { volume }),
  seek: position => request('POST', '/api/seek', { position }),
  bluetoothReconnect: () => request('POST', '/api/bluetooth/reconnect'),
}

// Nippelsounds: Dateien werden als Rohdaten hochgeladen, Name/Farbe als Parameter
async function upload(method, path, file, params = {}) {
  try {
    const query = new URLSearchParams({ ...params, filename: file.name }).toString()
    const response = await fetch(`${API}${path}?${query}`, { method, body: file })
    const body = await response.json().catch(() => null)
    if (!response.ok) return { error: body?.detail || `Fehler ${response.status}` }
    return body
  } catch {
    return { error: 'Server nicht erreichbar.' }
  }
}

export const soundActions = {
  play: sound => request('POST', `/api/sounds/${sound.id}/play`),
  stop: () => request('POST', '/api/sounds/stop'),
  volume: volume => request('POST', '/api/sounds/volume', { volume }),
  create: (name, color, file) => upload('POST', '/api/sounds', file, { name, color }),
  update: (sound, name, color) => request('PATCH', `/api/sounds/${sound.id}`, { name, color }),
  replaceFile: (sound, file) => upload('PUT', `/api/sounds/${sound.id}/file`, file),
  setImage: (sound, file) => upload('PUT', `/api/sounds/${sound.id}/image`, file),
  removeImage: sound => request('DELETE', `/api/sounds/${sound.id}/image`),
  remove: sound => request('DELETE', `/api/sounds/${sound.id}`),
  importZip: file => upload('POST', '/api/sounds/import', file),
  exportUrl: () => `${API}/api/sounds/export`,
}

// Webradio: Sender verwalten (nur Fernbedienung) und abspielen
async function send(method, path, body) {
  try {
    const options = { method }
    if (body !== undefined) {
      options.headers = { 'Content-Type': 'application/json' }
      options.body = JSON.stringify(body)
    }
    const response = await fetch(`${API}${path}`, options)
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = Array.isArray(data?.detail) ? 'Ungültige Angaben.' : data?.detail
      return { error: detail || `Fehler ${response.status}` }
    }
    return data
  } catch {
    return { error: 'Server nicht erreichbar.' }
  }
}

export const radioActions = {
  play: station => send('POST', `/api/radio/play/${station.id}`),
  off: () => send('POST', '/api/radio/off'),
  add: station => send('POST', '/api/radio/stations', station),
  remove: station => send('DELETE', `/api/radio/stations/${station.id}`),
  move: (station, index) => send('POST', `/api/radio/stations/${station.id}/move`, { index }),
}

export const favoriteActions = {
  create: name => request('POST', '/api/favorites', { name }),
  rename: (list, name) => request('PATCH', `/api/favorites/${list.id}`, { name }),
  remove: list => request('DELETE', `/api/favorites/${list.id}`),
  add: (list, track) => request('POST', `/api/favorites/${list.id}/tracks`, trackData(track)),
  removeTrack: (list, track) => request('DELETE', `/api/favorites/${list.id}/tracks/${track.id}`),
  moveTrack: (list, track, index) => request('POST', `/api/favorites/${list.id}/tracks/${track.id}/move`, { index }),
}

// ---------- Gemeinsamer Zustand (Live über WebSocket) ----------

export function useJukebox(isPlayer) {
  const [queue, setQueue] = useState([])
  const [current, setCurrent] = useState(null)
  const [history, setHistory] = useState([])
  const [paused, setPaused] = useState(false)
  const [volume, setVolume] = useState(80)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [connected, setConnected] = useState(false)
  const [favorites, setFavorites] = useState([])
  const [sounds, setSounds] = useState([])
  const [soundVolume, setSoundVolume] = useState(80)
  const soundHandlers = useRef(new Set())
  const [bluetooth, setBluetooth] = useState(null)
  const [radio, setRadio] = useState({ stations: [], station_id: null, on: false })
  const wsRef = useRef(null)
  const seekHandlers = useRef(new Set())

  function handleMessage(msg) {
    if (msg.type === 'state') {
      setQueue(msg.queue || [])
      setCurrent(msg.current || null)
      setHistory(msg.history || [])
      setPaused(Boolean(msg.paused))
      setVolume(msg.volume ?? 80)
      if (!isPlayer) {
        setPosition(msg.position || 0)
        setDuration(msg.duration || 0)
      }
    } else if (msg.type === 'favorites') {
      setFavorites(msg.lists || [])
    } else if (msg.type === 'sounds') {
      setSounds(msg.sounds || [])
      setSoundVolume(msg.volume ?? 80)
    } else if (msg.type === 'radio') {
      setRadio({ stations: msg.stations || [], station_id: msg.station_id, on: Boolean(msg.on) })
    } else if (msg.type === 'bluetooth') {
      setBluetooth(msg)
    } else if (msg.type === 'sound-play' || msg.type === 'sound-stop') {
      if (isPlayer) soundHandlers.current.forEach(handler => handler(msg))
    } else if (msg.type === 'position' && !isPlayer) {
      setPosition(msg.position)
      setDuration(msg.duration)
    } else if (msg.type === 'seek') {
      setPosition(msg.position)
      if (isPlayer) seekHandlers.current.forEach(handler => handler(msg.position))
    }
  }

  useEffect(() => {
    let ws
    let retry
    let stopped = false
    let lastMessage = Date.now()
    function connect() {
      ws = new WebSocket(WS)
      wsRef.current = ws
      lastMessage = Date.now()
      ws.onopen = () => setConnected(true)
      ws.onmessage = event => {
        lastMessage = Date.now()
        const msg = JSON.parse(event.data)
        if (msg.type !== 'pong') handleMessage(msg)
      }
      ws.onclose = () => {
        setConnected(false)
        if (!stopped) retry = setTimeout(connect, 2000)  // automatisch neu verbinden
      }
    }
    // Lebenszeichen: alle 15 s ein Ping. Kommt 40 s lang nichts zurück (z. B. nach dem
    // Aufwachen aus dem Standby), Verbindung verwerfen und sofort neu aufbauen.
    const heartbeat = setInterval(() => {
      if (!ws || stopped) return
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
      if (Date.now() - lastMessage > 40000) {
        ws.onclose = null
        ws.onmessage = null
        try { ws.close() } catch { /* egal */ }
        setConnected(false)
        clearTimeout(retry)
        connect()
      }
    }, 15000)
    connect()
    // Falls der Bluetooth-Wächter ausfällt, kommt keine Meldung mehr – darum regelmässig nachfragen
    const btPoll = setInterval(() => getJson('/api/bluetooth').then(data => data && setBluetooth(data)), 15000)
    return () => {
      stopped = true
      clearTimeout(retry)
      clearInterval(btPoll)
      clearInterval(heartbeat)
      ws.close()
    }
  }, [])

  function sendPosition(pos, dur) {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'position', position: pos, duration: dur }))
    }
  }

  // Player-Module (lokal, YouTube, Spotify) melden sich hier für Spul-Befehle an
  function onSeek(handler) {
    seekHandlers.current.add(handler)
    return () => seekHandlers.current.delete(handler)
  }

  // Das Soundboard-Modul auf dem Surface meldet sich hier für Abspiel-Befehle an
  function onSoundEvent(handler) {
    soundHandlers.current.add(handler)
    return () => soundHandlers.current.delete(handler)
  }

  function changeSoundVolume(value) {
    setSoundVolume(value)
    soundActions.volume(value)
  }

  function changeVolume(value) {
    setVolume(value)
    actions.volume(value)
  }

  function seekTo(value) {
    setPosition(value)
    actions.seek(value)
  }

  return {
    queue, current, history, paused, volume, position, duration, connected, favorites,
    sounds, soundVolume, onSoundEvent, changeSoundVolume, bluetooth, radio,
    playing: Boolean(current) && !paused,
    setPosition, setDuration, sendPosition, onSeek, changeVolume, seekTo,
  }
}
