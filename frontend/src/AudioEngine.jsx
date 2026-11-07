import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { API, actions } from './jukebox'

// Spielt lokale Musikdateien auf dem Surface ab.
export default function AudioEngine({ jb, audioRef }) {
  const { current, paused, volume } = jb
  const [needsUnlock, setNeedsUnlock] = useState(false)
  const lastReport = useRef(0)

  function tryPlay() {
    const audio = audioRef.current
    if (!audio || !audio.getAttribute('src')) return
    audio.play()
      .then(() => setNeedsUnlock(false))
      .catch(error => {
        if (error.name === 'NotAllowedError') setNeedsUnlock(true)
        else if (error.name !== 'AbortError') console.error('Wiedergabe fehlgeschlagen:', error)
      })
  }

  const playId = current?.play_id

  useEffect(() => jb.onSeek(position => {
    if (audioRef.current?.getAttribute('src')) audioRef.current.currentTime = position
  }), [])

  useEffect(() => {
    const audio = audioRef.current
    if (!current || !current.url) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      jb.setPosition(0)
      jb.setDuration(0)
      return
    }
    audio.src = current.url.startsWith('http') ? current.url : API + current.url
    if (!paused) tryPlay()
  }, [playId])

  useEffect(() => {
    if (paused) audioRef.current.pause()
    else tryPlay()
  }, [paused])

  useEffect(() => {
    audioRef.current.volume = volume / 100
  }, [volume])

  function onTimeUpdate(e) {
    const audio = e.target
    jb.setPosition(audio.currentTime)
    const now = Date.now()
    if (now - lastReport.current < 1000) return
    lastReport.current = now
    jb.sendPosition(audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : 0)
  }

  return (
    <>
      <audio
        ref={audioRef}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={e => jb.setDuration(e.target.duration)}
        onEnded={() => current && actions.ended(current.play_id)}
      />
      {needsUnlock && (
        <button className="unlock" onClick={tryPlay}>
          <Volume2 size={22} /> Tippen, um die Wiedergabe zu aktivieren
        </button>
      )}
    </>
  )
}
