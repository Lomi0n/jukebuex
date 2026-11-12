import { useEffect, useState } from 'react'
import { Radio as RadioIcon, Search, X, Plus, Check, Pencil, Trash2, Power, Link2, LoaderCircle } from 'lucide-react'
import { getResult, radioActions } from './jukebox'
import { Cover, SortableList } from './components'
import { Equalizer } from './Brand'

const IS_REMOTE = window.location.pathname.startsWith('/remote')

const COUNTRIES = [['CH', 'Schweiz'], ['DE', 'Deutschland'], ['AT', 'Österreich']]
const GENRES = [['pop', 'Pop'], ['rock', 'Rock'], ['80s', '80er'], ['dance', 'Dance'], ['jazz', 'Jazz'], ['classical', 'Klassik']]

const asTrack = station => ({ source: 'radio', title: station.name, image: station.image })

function stationInfo(station) {
  return [station.country, station.tags].filter(Boolean).join(' · ') || 'Webradio'
}

function quality(station) {
  if (!station.codec && !station.bitrate) return null
  return [station.codec, station.bitrate ? `${station.bitrate} kbit/s` : null].filter(Boolean).join(' ')
}

// ---------- Bereich "Radio" ----------

export function RadioView({ jb, notify }) {
  const { radio, current, playing, mixes } = jb
  const fillerMix = mixes.lists.find(m => m.id === mixes.filler_id)
  const [editing, setEditing] = useState(false)
  const radioPlaying = current?.source === 'radio'

  async function play(station) {
    const result = await radioActions.play(station)
    if (result?.error) notify(result.error, 'warn')
    else if (result?.status === 'waiting') notify(`„${station.name}“ startet, sobald die Warteschlange fertig ist`)
  }

  async function remove(station) {
    const result = await radioActions.remove(station)
    if (result?.error) notify(result.error, 'warn')
    else notify(`„${station.name}“ entfernt`)
  }

  return (
    <div className="radio">
      <div className="head-row">
        <div>
          <h1>Radio <span className="count">{radio.stations.length}</span></h1>
          <p className="muted">Läuft automatisch, sobald die Warteschlange leer ist. Ein Wunsch unterbricht das Radio, danach geht es weiter.</p>
        </div>
        <div className="sb-actions">
          {radio.on && (
            <button className="btn-secondary" onClick={() => radioActions.off()}>
              <Power size={17} /> Radio aus
            </button>
          )}
          {IS_REMOTE && radio.stations.length > 0 && (
            <button className={`btn-secondary ${editing ? 'active' : ''}`} onClick={() => setEditing(!editing)}>
              {editing ? <><Check size={17} /> Fertig</> : <><Pencil size={16} /> Bearbeiten</>}
            </button>
          )}
        </div>
      </div>

      {fillerMix && (
        <p className="radio-filler-note">
          Als Lückenfüller ist gerade <b>{fillerMix.name}</b> gewählt. Ein Tipp auf einen Sender ersetzt ihn.
        </p>
      )}
      <h2 className="radio-heading">Meine Sender</h2>
      {radio.stations.length === 0 ? (
        <div className="radio-empty">
          <RadioIcon size={44} strokeWidth={1.3} />
          <p>{IS_REMOTE
            ? 'Noch keine Sender gespeichert. Such unten nach einem Sender und füge ihn hinzu.'
            : 'Noch keine Sender gespeichert. Sender fügst du über die Fernbedienung am PC hinzu.'}</p>
        </div>
      ) : editing ? (
        <div className="radio-edit">
          <p className="muted">Zum Umsortieren am Griff ziehen. Die Reihenfolge gilt auch für «Weiter» und «Zurück» im Radio.</p>
          <SortableList items={radio.stations} onMove={(station, index) => radioActions.move(station, index)}>
            {(station, i, drag) => (
              <div key={station.id} className={`row ${drag.className}`} style={drag.style}>
                {drag.handle}
                <Cover track={asTrack(station)} size={44} />
                <div className="row-info">
                  <strong>{station.name}</strong>
                  <span>{stationInfo(station)}</span>
                </div>
                <button className="icon-btn danger" onClick={() => remove(station)} title="Sender entfernen">
                  <Trash2 size={18} />
                </button>
              </div>
            )}
          </SortableList>
        </div>
      ) : (
        <div className="grid station-grid">
          {radio.stations.map(station => {
            const active = radio.on && radio.station_id === station.id
            const live = active && radioPlaying
            return (
              <button key={station.id} className={`card station-card ${active ? 'active' : ''}`} onClick={() => play(station)}>
                <Cover track={asTrack(station)} size={140} />
                <strong>{station.name}</strong>
                <span>{stationInfo(station)}</span>
                {live && <em className="station-state"><Equalizer playing={playing} size={12} /> {playing ? 'Läuft' : 'Pausiert'}</em>}
                {active && !live && <em className="station-state">Nach der Warteschlange</em>}
              </button>
            )
          })}
        </div>
      )}

      {IS_REMOTE && <StationSearch stations={radio.stations} notify={notify} />}
    </div>
  )
}

// ---------- Sender suchen und hinzufügen (nur Fernbedienung) ----------

function StationSearch({ stations, notify }) {
  const [query, setQuery] = useState('')
  const [country, setCountry] = useState('CH')
  const [tag, setTag] = useState('')
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(null)
  const q = query.trim()

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      const params = new URLSearchParams({ q, country, tag })
      const result = await getResult(`/api/radio/search?${params}`)
      if (cancelled) return
      setLoading(false)
      setError(result.error || null)
      setResults(result.data || [])
    }, q ? 450 : 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [q, country, tag])

  const saved = new Set(stations.flatMap(s => [s.url, s.uuid].filter(Boolean)))

  async function add(station) {
    setAdding(station.url)
    const result = await radioActions.add(station)
    setAdding(null)
    if (result?.error) notify(result.error, 'warn')
    else if (result?.status === 'exists') notify(`„${station.name}“ ist schon gespeichert`, 'warn')
    else notify(`„${station.name}“ zu «Meine Sender» hinzugefügt`)
  }

  const heading = q ? `Treffer für «${q}»`
    : [COUNTRIES.find(c => c[0] === country)?.[1], GENRES.find(g => g[0] === tag)?.[1]].filter(Boolean).join(' · ') || 'Beliebte Sender'

  return (
    <section className="station-search">
      <h2 className="radio-heading">Sender suchen</h2>
      <form className="search-bar" onSubmit={e => e.preventDefault()}>
        <Search size={24} />
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Sendername, z. B. SRF 3, Energy, Radio 24 …" />
        {query && <button type="button" className="icon-btn" onClick={() => setQuery('')}><X size={20} /></button>}
      </form>

      <div className="chips radio-chips">
        {COUNTRIES.map(([code, label]) => (
          <button key={code} className={country === code ? 'chip active' : 'chip'}
            onClick={() => setCountry(country === code ? '' : code)}>{label}</button>
        ))}
        <span className="chip-sep" />
        {GENRES.map(([key, label]) => (
          <button key={key} className={tag === key ? 'chip active' : 'chip'}
            onClick={() => setTag(tag === key ? '' : key)}>{label}</button>
        ))}
      </div>

      <h3 className="sub-heading">{heading} {loading && <LoaderCircle size={16} className="spin" />}</h3>
      {error && <p className="muted error">{error}</p>}
      {!error && results?.length === 0 && !loading && <p className="muted">Keine Sender gefunden.</p>}
      <div className="station-results">
        {results?.map(station => {
          const isSaved = saved.has(station.url) || (station.uuid && saved.has(station.uuid))
          return (
            <div key={station.uuid || station.url} className="row">
              <Cover track={asTrack(station)} size={44} />
              <div className="row-info">
                <strong>{station.name}</strong>
                <span>{stationInfo(station)}</span>
              </div>
              {quality(station) && <span className="badge">{quality(station)}</span>}
              <button className={`btn-secondary station-add ${isSaved ? 'saved' : ''}`} disabled={isSaved || adding === station.url}
                onClick={() => add(station)}>
                {isSaved ? <><Check size={16} /> Gespeichert</> : <><Plus size={17} /> Hinzufügen</>}
              </button>
            </div>
          )
        })}
      </div>

      <ManualStation notify={notify} />
    </section>
  )
}

function ManualStation({ notify }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (!name.trim() || !/^https?:\/\//i.test(url.trim())) {
      notify('Bitte Name und eine Adresse mit http:// oder https:// angeben', 'warn')
      return
    }
    setBusy(true)
    const result = await radioActions.add({ name: name.trim(), url: url.trim() })
    setBusy(false)
    if (result?.error) { notify(result.error, 'warn'); return }
    notify(result.status === 'exists' ? 'Dieser Sender ist schon gespeichert' : `„${name.trim()}“ hinzugefügt`,
      result.status === 'exists' ? 'warn' : 'ok')
    setName(''); setUrl(''); setOpen(false)
  }

  if (!open) {
    return (
      <button className="link-card manual-station" onClick={() => setOpen(true)}>
        <Link2 size={26} />
        <div>
          <strong>Sender nicht gefunden?</strong>
          <span>Eigenen Sender mit der Stream-Adresse hinzufügen (MP3/AAC, auch .pls/.m3u)</span>
        </div>
      </button>
    )
  }
  return (
    <form className="manual-form" onSubmit={submit}>
      <h3>Eigener Sender</h3>
      <label>Name<input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="z. B. Radio Pilatus" /></label>
      <label>Stream-Adresse<input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/stream.mp3" /></label>
      <div className="manual-actions">
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Abbrechen</button>
        <button className="btn-primary" disabled={busy}><Plus size={18} /> Hinzufügen</button>
      </div>
    </form>
  )
}
