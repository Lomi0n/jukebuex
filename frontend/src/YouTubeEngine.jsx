/* JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE). */
import { useEffect, useRef, useState } from 'react'
import { Volume2, Maximize2, Minimize2 } from 'lucide-react'
import { actions } from './jukebox'

// Lädt die offizielle YouTube-IFrame-API (nur einmal)
let apiPromise
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!apiPromise) {
    apiPromise = new Promise(resolve => {
      const previous = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT) }
      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(script)
    })
  }
  return apiPromise
}

// Spielt YouTube-Titel auf dem Surface ab. Das Video erscheint gross in
// "Jetzt läuft" und als Mini-Player, wenn eine andere Ansicht offen ist.
export default function YouTubeEngine({ jb }) {
  const { current, paused, volume } = jb
  const containerRef = useRef(null)
  const dockRef = useRef(null)
  const playerRef = useRef(null)
  const currentRef = useRef(current)
  const pausedRef = useRef(paused)
  const [ready, setReady] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [big, setBig] = useState(false)      // Video im Vollbild
  const bigRef = useRef(false)
  bigRef.current = big
  currentRef.current = current
  pausedRef.current = paused

  const active = current?.source === 'youtube'
  const playId = current?.play_id

  // Player einmalig erstellen
  useEffect(() => {
    let cancelled = false
    loadYouTubeApi().then(YT => {
      if (cancelled) return
      const element = document.createElement('div')
      containerRef.current.appendChild(element)
      playerRef.current = new YT.Player(element, {
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, disablekb: 1, fs: 0 },
        events: {
          onReady: () => setReady(true),
          onStateChange: event => {
            if (event.data === YT.PlayerState.PLAYING) setBlocked(false)
            if (event.data === YT.PlayerState.ENDED) {
              const track = currentRef.current
              if (track?.source === 'youtube') actions.ended(track.play_id)
            }
          },
          onError: event => {
            // z. B. 101/150 = Einbetten vom Uploader verboten -> nächster Titel
            console.warn('YouTube-Fehler', event.data)
            const track = currentRef.current
            if (track?.source === 'youtube') actions.ended(track.play_id)
          },
        },
      })
    })
    return () => {
      cancelled = true
      playerRef.current?.destroy?.()
      playerRef.current = null
      if (containerRef.current) containerRef.current.innerHTML = ''
      setReady(false)
    }
  }, [])

  // Prüfen, ob der Browser die Wiedergabe blockiert hat
  function checkBlocked() {
    setTimeout(() => {
      const player = playerRef.current
      if (!player || currentRef.current?.source !== 'youtube' || pausedRef.current) return
      const state = player.getPlayerState?.()
      if (state !== 1 && state !== 3) setBlocked(true)  // 1 = läuft, 3 = puffert
    }, 3000)
  }

  // Vollbild endet automatisch mit dem Titel: neuer Titel = wieder normale Ansicht
  useEffect(() => { setBig(false) }, [playId, active])

  // Neuer Titel
  useEffect(() => {
    const player = playerRef.current
    if (!ready || !player) return
    if (active && !current.ref) {
      player.stopVideo()   // Video wird noch gesucht (Song aus einem Mix) – gleich geht's los
    } else if (active) {
      if (pausedRef.current) player.cueVideoById(current.ref)
      else {
        player.loadVideoById(current.ref)
        checkBlocked()
      }
    } else {
      player.stopVideo()
    }
  }, [playId, ready, current?.ref])

  // Pause / Weiter
  useEffect(() => {
    const player = playerRef.current
    if (!ready || !player || !active || !currentRef.current?.ref) return
    if (paused) player.pauseVideo()
    else {
      player.playVideo()
      checkBlocked()
    }
  }, [paused])

  // Lautstärke
  useEffect(() => {
    if (ready) playerRef.current?.setVolume(volume)
  }, [volume, ready])

  // Spulen
  useEffect(() => jb.onSeek(position => {
    if (currentRef.current?.source === 'youtube') playerRef.current?.seekTo(position, true)
  }), [])

  // Fortschritt jede Sekunde melden
  useEffect(() => {
    if (!ready || !active) return
    const timer = setInterval(() => {
      const player = playerRef.current
      const position = player?.getCurrentTime?.() || 0
      const duration = player?.getDuration?.() || 0
      jb.setPosition(position)
      jb.setDuration(duration)
      jb.sendPosition(position, duration)
    }, 1000)
    return () => clearInterval(timer)
  }, [ready, active, playId])

  // Video-Fenster an den Platzhalter in "Jetzt läuft" andocken, sonst Mini-Player
  useEffect(() => {
    const dock = dockRef.current
    if (!active) return
    let frame
    function follow() {
      const slot = document.getElementById('yt-slot')
      const main = document.querySelector('.main')
      if (bigRef.current) {
        dock.style.cssText = ''
        dock.classList.remove('mini')
      } else if (slot && main) {
        const r = slot.getBoundingClientRect()
        const m = main.getBoundingClientRect()
        dock.classList.remove('mini')
        Object.assign(dock.style, {
          left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
          clipPath: `inset(${Math.max(0, m.top - r.top)}px 0 ${Math.max(0, r.bottom - m.bottom)}px 0 round 14px)`,
        })
      } else {
        dock.style.cssText = ''
        dock.classList.add('mini')
      }
      frame = requestAnimationFrame(follow)
    }
    follow()
    return () => {
      cancelAnimationFrame(frame)
      dock.style.cssText = ''
    }
  }, [active])

  return (
    <>
      <div ref={dockRef} className={`yt-dock ${active ? '' : 'hidden'} ${big ? 'fullscreen' : ''}`}>
        <div ref={containerRef} className="yt-frame" />
        {/* Durchsichtige Fläche über dem Video: Antippen = Vollbild ein/aus */}
        <button className="yt-tap" onClick={() => setBig(b => !b)}
          aria-label={big ? 'Vollbild verlassen' : 'Video im Vollbild zeigen'}>
          <span className="yt-tap-icon">{big ? <Minimize2 size={22} /> : <Maximize2 size={20} />}</span>
        </button>
      </div>
      {active && blocked && (
        <button className="unlock" onClick={() => { playerRef.current?.playVideo(); setBlocked(false); checkBlocked() }}>
          <Volume2 size={22} /> Tippen, um die Wiedergabe zu aktivieren
        </button>
      )}
    </>
  )
}
