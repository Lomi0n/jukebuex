/* JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE). */
import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { API, actions } from './jukebox'

// Spielt lokale Musikdateien und Webradio-Streams auf dem Surface ab.
export default function AudioEngine({ jb, audioRef }) {
  const { current, paused, volume } = jb
  const [needsUnlock, setNeedsUnlock] = useState(false)
  const lastReport = useRef(0)
  const retryTimer = useRef(null)
  const retries = useRef(0)
  const isLive = current?.source === 'radio'

  function sourceUrl() {
    return current.url.startsWith('http') ? current.url : API + current.url
  }

  // Radio: Stream neu aufbauen (nach Pause wieder «live» statt verzögert, nach Abbruch neu verbinden)
  function reconnect() {
    const audio = audioRef.current
    if (!current?.url) return
    audio.src = sourceUrl()
    if (!paused) tryPlay()
  }

  // Abbruch oder Fehler beim Radiostream: mit wachsender Wartezeit neu verbinden (max. 30 s)
  function retryLive() {
    clearTimeout(retryTimer.current)
    const delay = Math.min(30, 3 * 2 ** retries.current) * 1000
    retries.current += 1
    retryTimer.current = setTimeout(reconnect, delay)
  }

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
    clearTimeout(retryTimer.current)
    retries.current = 0
    if (!current || !current.url) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      jb.setPosition(0)
      jb.setDuration(0)
      return
    }
    audio.src = sourceUrl()
    if (!paused) tryPlay()
  }, [playId])

  useEffect(() => {
    if (paused) {
      audioRef.current.pause()
      if (isLive) clearTimeout(retryTimer.current)
    }
    else if (isLive && audioRef.current.getAttribute('src')) reconnect()
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
        onLoadedMetadata={e => jb.setDuration(Number.isFinite(e.target.duration) ? e.target.duration : 0)}
        onPlaying={() => { retries.current = 0 }}
        onError={() => isLive && !paused && retryLive()}
        onEnded={() => isLive ? retryLive() : current && actions.ended(current.play_id)}
      />
      {needsUnlock && (
        <button className="unlock" onClick={tryPlay}>
          <Volume2 size={22} /> Tippen, um die Wiedergabe zu aktivieren
        </button>
      )}
    </>
  )
}
