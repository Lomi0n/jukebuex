import { useEffect, useRef, useState } from 'react'
import { Music2 } from 'lucide-react'
import { getJson, branding } from './jukebox'
import { Cover, SourceBadge, formatTime } from './components'

// Bildschirmschoner für das Surface: nach einigen Minuten ohne Berührung
// grosses Cover, Titel, Uhrzeit und "Als Nächstes". Ein Tipp beendet ihn.
const IDLE_MINUTES = 5

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

export default function Screensaver({ jb }) {
  const [active, setActive] = useState(false)
  const [now, setNow] = useState(new Date())
  const [remoteUrl, setRemoteUrl] = useState(null)
  const lastActivity = useRef(Date.now())
  const { current, queue, playing, position, duration } = jb

  // Jede Berührung zählt als Aktivität
  useEffect(() => {
    const touch = () => { lastActivity.current = Date.now() }
    const events = ['pointerdown', 'keydown', 'wheel']
    events.forEach(e => document.addEventListener(e, touch, true))
    getJson('/api/info').then(info => info && setRemoteUrl(info.remote_url))
    return () => events.forEach(e => document.removeEventListener(e, touch, true))
  }, [])

  // Läuft ein YouTube-Video, ist das Video selbst der Blickfang – dann kein Bildschirmschoner
  const videoPlaying = current?.source === 'youtube' && playing

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date())
      if (!active && !videoPlaying && Date.now() - lastActivity.current > IDLE_MINUTES * 60000) setActive(true)
    }, 1000)
    return () => clearInterval(timer)
  }, [active, videoPlaying])

  useEffect(() => { if (videoPlaying) setActive(false) }, [videoPlaying])

  if (!active) return null

  function wake(event) {
    event.preventDefault()
    event.stopPropagation()
    lastActivity.current = Date.now()
    setActive(false)
  }

  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const date = `${WEEKDAYS[now.getDay()]}, ${now.getDate()}. ${MONTHS[now.getMonth()]}`
  const upNext = queue.slice(0, 3)

  return (
    <div className="saver" onClick={wake}>
      {current?.image && <div className="saver-bg" style={{ backgroundImage: `url("${current.image}")` }} />}
      <div className="saver-shade" />

      <div className="saver-clock">
        <strong>{time}</strong>
        <span>{date}</span>
      </div>

      <div className="saver-drift">
        {current ? (
          <div className="saver-now">
            <Cover track={current} size={340} className="saver-cover" />
            <div className="saver-text">
              <span className="eyebrow">{playing ? 'Jetzt läuft' : 'Pausiert'}</span>
              <h1>{current.title}</h1>
              <p>{current.artist}</p>
              <SourceBadge source={current.source} />
              {duration > 0 && (
                <div className="saver-progress">
                  <div style={{ width: `${Math.min(100, position / duration * 100)}%` }} />
                  <span>{formatTime(position)} / {formatTime(duration)}</span>
                </div>
              )}
              {upNext.length > 0 && (
                <div className="saver-next">
                  <span className="eyebrow">Als Nächstes</span>
                  {upNext.map(t => <div key={t.id}>{t.title} <small>– {t.artist}</small></div>)}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="saver-idle">
            <div className="logo-icon big"><Music2 size={64} /></div>
            <h1>{branding.name}</h1>
            <p>Gerade läuft nichts – wünsch dir etwas!</p>
          </div>
        )}
      </div>

      <div className="saver-foot">
        {remoteUrl && <span>Musik wünschen vom PC: <b>{remoteUrl}</b></span>}
        <span>Zum Fortfahren antippen</span>
      </div>
    </div>
  )
}
