/* JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE). */
import { ArrowLeft, ListMusic, Shuffle, ListStart, RefreshCw, Sparkles, LoaderCircle, ThumbsDown, Repeat, Power } from 'lucide-react'
import { actions, mixActions } from './jukebox'
import { TrackRow } from './components'
import { Equalizer } from './Brand'

// Farbe pro Genre (wie die Spotify-Mixe: jedes Genre hat seinen eigenen Farbton)
const HUES = {
  'Pop': 330, 'Rock': 8, 'Hip-Hop': 45, 'Elektronisch': 190, 'R&B & Soul': 280, 'Schlager & Volksmusik': 95,
  'Metal': 0, 'Jazz & Blues': 215, 'Klassik': 40, 'Reggae': 120, 'Latin': 20, 'Country & Folk': 30,
  'Indie & Alternative': 160, 'Gemischt': 260,
}

function shuffled(list) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function since(timestamp) {
  if (!timestamp) return null
  const date = new Date(timestamp * 1000)
  const today = new Date()
  const time = date.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === today.toDateString()) return `heute, ${time}`
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `gestern, ${time}`
  return `${date.toLocaleDateString('de-CH')}, ${time}`
}

const label = mix => mix.genre === 'Gemischt' ? 'Entdeckt' : mix.genre

// Wie der Server: lokal vor allem, dann die gewählte Quelle, dann die andere. Ist das YouTube-Video
// noch nicht gesucht, sucht die Jukebox es erst, wenn der Song an der Reihe ist (spart Kontingent).
export function mixPlayable(track, mixes) {
  if (track.local) return track.local
  const source = mixes.source || 'youtube'
  for (const option of [source, source === 'youtube' ? 'spotify' : 'youtube']) {
    const found = track[option]
    if (found) return { ...found, image: found.image || track.image }
    if (option === 'youtube' && found == null && mixes.youtube) {
      return { title: track.title, artist: track.artist, album: track.album, image: track.image,
        duration: track.duration, source: 'youtube', ref: null }
    }
  }
  return null
}

// «Abspielen über YouTube | Spotify» – gilt für alle Mixe
export function SourceSwitch({ mixes, notify }) {
  if (!mixes.youtube || !mixes.spotify) return null
  async function pick(source) {
    if (source === mixes.source) return
    const result = await mixActions.source(source)
    if (result?.error) notify(result.error, 'warn')
    else notify(`Mixe laufen jetzt über ${source === 'youtube' ? 'YouTube' : 'Spotify'}`)
  }
  return (
    <div className="source-switch" role="group" aria-label="Mixe abspielen über">
      <span>Abspielen über</span>
      {[['youtube', 'YouTube'], ['spotify', 'Spotify']].map(([key, name]) => (
        <button key={key} className={mixes.source === key ? `active ${key}` : ''} onClick={() => pick(key)}>{name}</button>
      ))}
    </div>
  )
}

// Cover aus bis zu vier Albumbildern, darunter ein Band in der Genre-Farbe
export function MixCover({ mix, size = 140 }) {
  const images = [...new Set(mix.tracks.map(t => t.image).filter(Boolean))].slice(0, 4)
  const hue = HUES[mix.genre] ?? 260
  return (
    <div className="cover mix-cover" style={{ width: size, height: size, '--mix-hue': hue }}>
      <div className={`mix-mosaic n${images.length >= 4 ? 4 : images.length ? 1 : 0}`}>
        {(images.length >= 4 ? images : images.slice(0, 1)).map(src => <img key={src} src={src} alt="" />)}
      </div>
      <span className="mix-band" style={{ fontSize: Math.max(11, Math.round(size / 9)) }}>{label(mix)}</span>
    </div>
  )
}

// ---------- Abschnitt "Für euch gemischt" auf der Favoriten-Startseite ----------

export function MixesSection({ mixes, open, notify }) {
  async function refresh() {
    const result = await mixActions.refresh()
    if (result?.error) notify(result.error, 'warn')
    else notify('Die Mixe werden neu gemischt – das dauert etwa eine Minute')
  }

  return (
    <section className="mixes">
      <div className="mixes-head">
        <div>
          <h2><Sparkles size={22} /> Für euch gemischt</h2>
          <p className="muted">
            {mixes.running ? (mixes.progress || 'Wird gemischt …')
              : mixes.updated ? `Jede Nacht neu nach Genre gemischt, passend zu dem, was hier läuft · zuletzt ${since(mixes.updated)}`
                : 'Jede Nacht neu nach Genre gemischt, passend zu dem, was hier läuft.'}
          </p>
          <SourceSwitch mixes={mixes} notify={notify} />
        </div>
        <button className="btn-secondary" onClick={refresh} disabled={mixes.running}>
          {mixes.running ? <LoaderCircle size={17} className="spin" /> : <RefreshCw size={17} />}
          {mixes.running ? 'Mischt …' : 'Neu mischen'}
        </button>
      </div>
      {mixes.error && !mixes.running && <p className="mixes-error">{mixes.error}</p>}
      {mixes.lists.length === 0 ? (
        !mixes.error && (
          <div className="radio-empty">
            <Sparkles size={40} strokeWidth={1.3} />
            <p>Noch keine Mixe. Sobald ein paar Songs gelaufen sind, stellt die JUKEBÜX hier Mixe nach Genre
              zusammen – mit Lieblingssongs und neuen Entdeckungen. Oder jetzt «Neu mischen» drücken.</p>
          </div>
        )
      ) : (
        <div className="grid">
          {mixes.lists.map(mix => (
            <button key={mix.id} className={`card ${mixes.filler_id === mix.id ? 'mix-active' : ''}`} onClick={() => open(mix.id)}>
              <MixCover mix={mix} />
              <strong>{mix.name}</strong>
              <span>{mix.description}</span>
              {mixes.filler_id === mix.id && <em className="station-state"><Repeat size={12} /> Lückenfüller</em>}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// ---------- Einzelner Mix ----------

export function MixListView({ mix, mixes, current, onBack, enqueue, enqueueMany, notify }) {
  // Jeder Mix-Song in der gewählten Quelle (YouTube oder Spotify); nirgends abspielbare fallen weg
  const rows = mix.tracks.map(t => ({ item: t, track: mixPlayable(t, mixes) })).filter(r => r.track)
  const tracks = rows.map(r => r.track)
  const isFiller = mixes.filler_id === mix.id
  const fresh = rows.filter(r => r.item.new).length

  async function toggleFiller() {
    const result = isFiller ? await mixActions.fillerOff() : await mixActions.filler(mix)
    if (result?.error) notify(result.error, 'warn')
    else if (isFiller) notify(`„${mix.name}“ ist kein Lückenfüller mehr`)
    else if (result.status === 'waiting') notify(`„${mix.name}“ läuft, sobald die Warteschlange fertig ist`)
    else notify(`„${mix.name}“ läuft jetzt als Lückenfüller`)
  }

  async function block(track) {
    const result = await mixActions.block(mix, track)
    if (result?.error) notify(result.error, 'warn')
    else notify(`„${track.title}“ wird nicht mehr vorgeschlagen`)
  }

  return (
    <div className="collection">
      <button className="back" onClick={onBack}><ArrowLeft size={20} /> Favoriten</button>
      <div className="collection-head">
        <MixCover mix={mix} size={190} />
        <div className="collection-text">
          <span className="eyebrow">
            {isFiller && current?.filler === 'mix' ? <><Equalizer playing size={12} /> Läuft als Lückenfüller</> : 'Automatischer Mix'}
          </span>
          <h1>{mix.name}</h1>
          <p className="muted">{mix.description} · {tracks.length} Titel, davon {fresh} neu</p>
          <div className="collection-actions">
            {tracks.length > 0 && (
              <>
                <button className="btn-primary" onClick={() => enqueueMany(shuffled(tracks))}>
                  <Shuffle size={20} /> Gemischt einreihen
                </button>
                <button className="btn-secondary" onClick={() => enqueueMany(tracks)}>
                  <ListMusic size={18} /> Alle einreihen
                </button>
                <button className="btn-secondary" onClick={() => enqueueMany(tracks, true)}>
                  <ListStart size={18} /> Als Nächstes
                </button>
                <button className={`btn-secondary ${isFiller ? 'active' : ''}`} onClick={toggleFiller}>
                  {isFiller ? <><Power size={17} /> Lückenfüller aus</> : <><Repeat size={17} /> Als Lückenfüller</>}
                </button>
              </>
            )}
          </div>
          <SourceSwitch mixes={mixes} notify={notify} />
        </div>
      </div>

      <p className="muted mix-note">
        «Neu» sind Vorschläge, die hier noch nie liefen. Was nicht passt, mit <ThumbsDown size={14} /> aussortieren –
        und was gefällt, mit ☆ in eine eigene Favoritenliste übernehmen. Gehörte und übersprungene Songs fliessen
        in den nächsten Mix ein.
      </p>
      <div className="track-list">
        {rows.map(({ item, track }, i) => (
          <TrackRow key={item.id} track={track} index={i + 1} tag={item.new ? 'Neu' : null}
            onPlay={() => actions.play(track)} onNext={() => enqueue(track, true)} onAdd={() => enqueue(track)}
            onRemove={() => block(item)} removeIcon={<ThumbsDown size={18} />} removeTitle="Nicht mehr vorschlagen" />
        ))}
      </div>
    </div>
  )
}
