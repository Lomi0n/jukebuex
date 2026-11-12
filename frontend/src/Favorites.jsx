/* JUKEBÜX – © 2026 Lomi0n. PolyForm Strict License 1.0.0 (siehe LICENSE). */
import { useEffect, useRef, useState } from 'react'
import {
  Star, Plus, Check, ArrowLeft, ListMusic, Shuffle, ListStart, Pencil, Trash2, X
} from 'lucide-react'
import { actions, favoriteActions } from './jukebox'
import { Cover, SortableList, TrackRow, trackKey } from './components'
import Keyboard from './Keyboard'
import { MixesSection, MixListView } from './Mixes'

const IS_REMOTE = window.location.pathname.startsWith('/remote')

function shuffled(list) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function minutes(tracks) {
  return Math.round(tracks.reduce((sum, t) => sum + (t.duration || 0), 0) / 60)
}

// ---------- Name eingeben (neue Liste / umbenennen), auf dem Surface mit Bildschirmtastatur ----------

export function NameDialog({ title, initial = '', confirmLabel, onSave, onClose }) {
  const [name, setName] = useState(initial)
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  function save(event) {
    event?.preventDefault()
    if (name.trim()) onSave(name.trim())
  }

  return (
    <div className="dialog-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={save}>
        <h2>{title}</h2>
        <input ref={inputRef} value={name} maxLength={60} onChange={e => setName(e.target.value)}
          inputMode={IS_REMOTE ? undefined : 'none'} placeholder="Name der Liste, z. B. Party" />
        <div className="dialog-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn-primary" disabled={!name.trim()}>{confirmLabel}</button>
        </div>
      </form>
      {!IS_REMOTE && (
        <Keyboard value={name} onChange={v => setName(v.slice(0, 60))} onEnter={save} onClose={onClose}
          enterLabel={confirmLabel} />
      )}
    </div>
  )
}

// ---------- Auswahl, in welche Liste ein Titel kommt (öffnet sich beim Stern) ----------

export function FavoritePicker({ track, anchor, lists, notify, onClose }) {
  const [creating, setCreating] = useState(false)
  const key = trackKey(track)

  // Unter dem Stern öffnen, bei Platzmangel darüber
  const width = 290
  const left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))
  const below = anchor.bottom + 8
  const style = below + 320 < window.innerHeight
    ? { left, top: below, width }
    : { left, bottom: window.innerHeight - anchor.top + 8, width }

  async function toggle(list) {
    const inList = list.tracks.find(t => trackKey(t) === key)
    if (inList) {
      if (await favoriteActions.removeTrack(list, inList)) notify(`„${track.title}“ aus „${list.name}“ entfernt`)
    } else {
      if (await favoriteActions.add(list, track)) notify(`„${track.title}“ zu „${list.name}“ hinzugefügt`)
    }
    onClose()
  }

  async function createAndAdd(name) {
    const list = await favoriteActions.create(name)
    if (list && await favoriteActions.add(list, track)) notify(`„${track.title}“ zu „${name}“ hinzugefügt`)
    onClose()
  }

  if (creating) {
    return <NameDialog title="Neue Favoritenliste" confirmLabel="Erstellen"
      onSave={createAndAdd} onClose={onClose} />
  }

  return (
    <div className="popover-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className="popover" style={style}>
        <div className="popover-head">
          <span>Zu Favoriten hinzufügen</span>
          <button className="icon-btn" onClick={onClose} aria-label="Schliessen"><X size={18} /></button>
        </div>
        <div className="popover-list">
          {lists.length === 0 && <p className="muted">Noch keine Liste vorhanden.</p>}
          {lists.map(list => {
            const inList = list.tracks.some(t => trackKey(t) === key)
            return (
              <button key={list.id} className={`popover-item ${inList ? 'on' : ''}`} onClick={() => toggle(list)}>
                <Star size={18} fill={inList ? 'currentColor' : 'none'} />
                <span>{list.name}</span>
                <small>{list.tracks.length}</small>
                {inList && <Check size={18} />}
              </button>
            )
          })}
        </div>
        <button className="popover-item new" onClick={() => setCreating(true)}>
          <Plus size={18} /> <span>Neue Liste …</span>
        </button>
      </div>
    </div>
  )
}

// ---------- Bereich "Favoriten" ----------

export function FavoritesView({ lists, mixes, current, openId, setOpenId, enqueue, enqueueMany, notify }) {
  const open = lists.find(l => l.id === openId)
  if (open) {
    return <FavoriteListView list={open} onBack={() => setOpenId(null)}
      enqueue={enqueue} enqueueMany={enqueueMany} notify={notify} />
  }
  const mix = mixes.lists.find(m => m.id === openId)
  if (mix) {
    return <MixListView mix={mix} mixes={mixes} current={current} onBack={() => setOpenId(null)}
      enqueue={enqueue} enqueueMany={enqueueMany} notify={notify} />
  }
  return <FavoritesHome lists={lists} mixes={mixes} open={setOpenId} notify={notify} />
}

function FavoritesHome({ lists, mixes, open, notify }) {
  const [creating, setCreating] = useState(false)

  async function create(name) {
    const list = await favoriteActions.create(name)
    setCreating(false)
    if (list) {
      notify(`Liste „${name}“ erstellt`)
      open(list.id)
    }
  }

  return (
    <div className="favorites-home">
      <div className="head-row">
        <div>
          <h1>Favoriten</h1>
          <p className="muted">Eigene Listen aus Spotify, YouTube und lokaler Musik – mit einem Klick einreihen.</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={20} /> Neue Liste</button>
      </div>

      <MixesSection mixes={mixes} open={open} notify={notify} />
      <h2 className="radio-heading">Eigene Listen</h2>

      {lists.length === 0 && mixes.lists.length > 0 ? (
        <p className="muted">Noch keine eigenen Listen. Tippe bei einem Titel auf den Stern ☆, um ihn in eine Liste zu legen.</p>
      ) : lists.length === 0 ? (
        <div className="search-start">
          <Star size={56} strokeWidth={1.2} />
          <h2>Noch keine Favoriten</h2>
          <p>Erstelle eine Liste oder tippe bei einem beliebigen Titel auf den Stern ☆.</p>
        </div>
      ) : (
        <div className="grid">
          {lists.map(list => (
            <button key={list.id} className="card" onClick={() => open(list.id)}>
              {list.tracks.find(t => t.image)
                ? <Cover track={{ image: list.tracks.find(t => t.image).image }} size={140} />
                : <div className="cover fav-cover" style={{ width: 140, height: 140 }}><Star size={52} fill="currentColor" /></div>}
              <strong>{list.name}</strong>
              <span>{list.tracks.length} Titel</span>
            </button>
          ))}
        </div>
      )}

      {creating && <NameDialog title="Neue Favoritenliste" confirmLabel="Erstellen"
        onSave={create} onClose={() => setCreating(false)} />}
    </div>
  )
}

function FavoriteListView({ list, onBack, enqueue, enqueueMany, notify }) {
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const tracks = list.tracks
  const cover = tracks.find(t => t.image)

  async function rename(name) {
    setRenaming(false)
    if (await favoriteActions.rename(list, name)) notify(`Liste umbenannt in „${name}“`)
  }

  async function remove() {
    if (!confirmDelete) { setConfirmDelete(true); return }
    if (await favoriteActions.remove(list)) {
      notify(`Liste „${list.name}“ gelöscht`)
      onBack()
    }
  }

  return (
    <div className="collection">
      <button className="back" onClick={onBack}><ArrowLeft size={20} /> Favoriten</button>
      <div className="collection-head">
        {cover
          ? <Cover track={{ image: cover.image }} size={190} />
          : <div className="cover fav-cover" style={{ width: 190, height: 190 }}><Star size={70} fill="currentColor" /></div>}
        <div className="collection-text">
          <span className="eyebrow">Favoritenliste</span>
          <h1>{list.name}</h1>
          <p className="muted">{tracks.length} Titel · {minutes(tracks)} Min.</p>
          <div className="collection-actions">
            {tracks.length > 0 && (
              <>
                <button className="btn-primary" onClick={() => enqueueMany(tracks)}>
                  <ListMusic size={20} /> Alle einreihen
                </button>
                <button className="btn-secondary" onClick={() => enqueueMany(shuffled(tracks))}>
                  <Shuffle size={18} /> Gemischt einreihen
                </button>
                <button className="btn-secondary" onClick={() => enqueueMany(tracks, true)}>
                  <ListStart size={18} /> Als Nächstes
                </button>
              </>
            )}
            <button className="btn-secondary" onClick={() => setRenaming(true)}>
              <Pencil size={18} /> Umbenennen
            </button>
            <button className={`btn-secondary ${confirmDelete ? 'danger' : ''}`} onClick={remove}
              onBlur={() => setConfirmDelete(false)}>
              <Trash2 size={18} /> {confirmDelete ? 'Wirklich löschen?' : 'Liste löschen'}
            </button>
          </div>
        </div>
      </div>

      {tracks.length === 0 ? (
        <p className="muted">Diese Liste ist noch leer. Tippe bei einem Titel auf den Stern ☆ und wähle „{list.name}“.</p>
      ) : (
        <SortableList items={tracks} onMove={(track, index) => favoriteActions.moveTrack(list, track, index)}>
          {(track, i, drag) => (
            <TrackRow key={track.id} track={track} noFavorite
              handle={drag.handle} style={drag.style} className={drag.className}
              onPlay={() => actions.play(track)} onNext={() => enqueue(track, true)} onAdd={() => enqueue(track)}
              onRemove={async () => {
                if (await favoriteActions.removeTrack(list, track)) notify(`„${track.title}“ aus „${list.name}“ entfernt`)
              }} />
          )}
        </SortableList>
      )}

      {renaming && <NameDialog title="Liste umbenennen" initial={list.name} confirmLabel="Speichern"
        onSave={rename} onClose={() => setRenaming(false)} />}
    </div>
  )
}
