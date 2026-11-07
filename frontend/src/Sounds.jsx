import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, Square, Volume2, Search, X, Upload, Play, ImageOff } from 'lucide-react'
import { API, soundActions } from './jukebox'
import Keyboard from './Keyboard'

const IS_REMOTE = window.location.pathname.startsWith('/remote')

const COLORS = [
  '#e0242a', '#f2711c', '#f5c518', '#9ccc3d', '#21ba45', '#00b5ad',
  '#2bb3e6', '#2f6fd6', '#7a4ddb', '#c13fd8', '#e64a9e', '#9b6b43',
  '#e8c9a0', '#f2f2f2', '#8a8a92', '#1c1c1c',
]

// ---------- Ein runder Knopf ----------

export function SoundButton({ sound, color, image, onPress, size = 104 }) {
  const [pressed, setPressed] = useState(false)
  const style = { '--c': color || sound?.color || '#e0242a', width: size, height: size }
  const img = image ?? (sound?.image ? `${API}/soundfiles/${sound.image}` : null)
  return (
    <button type="button" className={`sb-button ${pressed ? 'pressed' : ''} ${img ? 'with-image' : ''}`} style={style}
      onPointerDown={() => setPressed(true)} onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)} onClick={onPress} aria-label={sound?.name || 'Sound'}>
      {img && <span className="sb-image" style={{ backgroundImage: `url("${img}")` }} />}
    </button>
  )
}

// ---------- Bereich "Nippelsounds" ----------

export function SoundsView({ jb, notify }) {
  const [filter, setFilter] = useState('')
  const [keyboard, setKeyboard] = useState(false)
  const [editing, setEditing] = useState(false)
  const [dialog, setDialog] = useState(null)        // null | 'new' | sound
  const [confirmDelete, setConfirmDelete] = useState(null)

  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = [...jb.sounds]
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }))
    .filter(s => words.every(w => s.name.toLowerCase().includes(w)))

  async function remove(sound) {
    if (confirmDelete !== sound.id) { setConfirmDelete(sound.id); return }
    setConfirmDelete(null)
    if (await soundActions.remove(sound)) notify(`„${sound.name}“ gelöscht`)
  }

  return (
    <div className={`sounds ${keyboard && !IS_REMOTE ? 'with-keyboard' : ''}`}>
      <div className="head-row">
        <div>
          <h1>Soundboard <span className="count">{jb.sounds.length}</span></h1>
          <p className="muted">Knopf drücken – der Sound kommt aus der Stereoanlage.</p>
        </div>
        <div className="sb-actions">
          <button className="btn-secondary sb-stop" onClick={() => soundActions.stop()}>
            <Square size={16} fill="currentColor" /> Stopp
          </button>
          {/* Sounds verwalten (hochladen, bearbeiten, löschen) nur über die Fernbedienung am PC */}
          {IS_REMOTE && (
            <>
              <button className={`btn-secondary ${editing ? 'active' : ''}`} onClick={() => { setEditing(!editing); setConfirmDelete(null) }}>
                <Pencil size={17} /> {editing ? 'Fertig' : 'Bearbeiten'}
              </button>
              <button className="btn-primary" onClick={() => setDialog('new')}><Plus size={20} /> Neuer Sound</button>
            </>
          )}
        </div>
      </div>

      <div className="sb-toolbar">
        <div className="sb-filter">
          <Search size={18} />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Sounds filtern …"
            inputMode={IS_REMOTE ? undefined : 'none'} onFocus={() => !IS_REMOTE && setKeyboard(true)} />
          {filter && <button className="icon-btn" onClick={() => setFilter('')}><X size={18} /></button>}
        </div>
        <div className="sb-volume">
          <Volume2 size={20} />
          <input type="range" min="0" max="100" value={jb.soundVolume}
            onChange={e => jb.changeSoundVolume(Number(e.target.value))} aria-label="Lautstärke der Sounds" />
          <span>{jb.soundVolume}%</span>
        </div>
      </div>

      {jb.sounds.length === 0 ? (
        <div className="search-start">
          <Upload size={56} strokeWidth={1.2} />
          <h2>Noch keine Sounds</h2>
          <p>{IS_REMOTE
            ? 'Mit „Neuer Sound“ eine Audiodatei hochladen.'
            : 'Neue Sounds werden über die Fernbedienung an einem PC hochgeladen.'}</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">Kein Sound passt zu „{filter}“.</p>
      ) : (
        <div className="sb-grid">
          {shown.map(sound => (
            <div key={sound.id} className="sb-tile">
              <SoundButton sound={sound} onPress={() => soundActions.play(sound)} />
              <span className="sb-name">{sound.name}</span>
              {editing && (
                <div className="sb-edit">
                  <button className="icon-btn" onClick={() => setDialog(sound)} aria-label="Bearbeiten"><Pencil size={17} /></button>
                  <button className={`icon-btn danger ${confirmDelete === sound.id ? 'armed' : ''}`} onClick={() => remove(sound)}
                    aria-label="Löschen">
                    {confirmDelete === sound.id ? 'Löschen?' : <Trash2 size={17} />}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!IS_REMOTE && keyboard && !dialog && (
        <Keyboard value={filter} onChange={setFilter} enterLabel="Fertig"
          onEnter={() => setKeyboard(false)} onClose={() => setKeyboard(false)} />
      )}

      {dialog && (
        <SoundDialog sound={dialog === 'new' ? null : dialog} notify={notify} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

// ---------- Neuer Sound / Sound bearbeiten ----------

function FilePick({ label, accept, file, current, onPick }) {
  const inputRef = useRef(null)
  return (
    <div className="file-pick">
      <span className="field-label">{label}</span>
      <div className="file-row">
        <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()}>
          <Upload size={16} /> Datei wählen
        </button>
        <span className="file-name">{file ? file.name : current || 'Keine Datei ausgewählt'}</span>
      </div>
      <input ref={inputRef} type="file" accept={accept} hidden
        onChange={e => { onPick(e.target.files?.[0] || null); e.target.value = '' }} />
    </div>
  )
}

function SoundDialog({ sound, notify, onClose }) {
  const [name, setName] = useState(sound?.name || '')
  const [color, setColor] = useState(sound?.color || COLORS[0])
  const [audioFile, setAudioFile] = useState(null)
  const [imageFile, setImageFile] = useState(null)
  const [dropImage, setDropImage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [keyboard, setKeyboard] = useState(false)
  const previewRef = useRef(null)

  const localImage = useMemo(() => imageFile ? URL.createObjectURL(imageFile) : null, [imageFile])
  useEffect(() => () => { if (localImage) URL.revokeObjectURL(localImage) }, [localImage])
  const imagePreview = localImage || (dropImage ? null : sound?.image ? `${API}/soundfiles/${sound.image}` : null)

  // Probehören auf diesem Gerät (nicht auf der Stereoanlage)
  function preview() {
    previewRef.current?.pause()
    const src = audioFile ? URL.createObjectURL(audioFile) : sound ? `${API}/soundfiles/${sound.file}` : null
    if (!src) return
    previewRef.current = new Audio(src)
    previewRef.current.play().catch(() => {})
  }
  useEffect(() => () => previewRef.current?.pause(), [])

  async function save(event) {
    event?.preventDefault()
    if (!name.trim()) { setError('Bitte einen Namen eingeben.'); return }
    if (!sound && !audioFile) { setError('Bitte eine Audiodatei wählen.'); return }
    setBusy(true)
    setError(null)
    let target = sound
    let result
    if (!sound) {
      result = await soundActions.create(name.trim(), color, audioFile)
      target = result?.error ? null : result
    } else {
      result = await soundActions.update(sound, name.trim(), color)
      if (result && audioFile) result = await soundActions.replaceFile(sound, audioFile)
    }
    if (target && !result?.error && imageFile) result = await soundActions.setImage(target, imageFile)
    else if (target && !result?.error && dropImage && sound?.image) result = await soundActions.removeImage(target)
    setBusy(false)
    if (!result || result.error) { setError(result?.error || 'Speichern fehlgeschlagen.'); return }
    notify(sound ? `„${name.trim()}“ gespeichert` : `„${name.trim()}“ erstellt`)
    onClose()
  }

  return (
    <div className="dialog-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <form className={`dialog sound-dialog ${keyboard ? 'compact' : ''}`} onSubmit={save}>
        <div className="sound-dialog-head">
          <SoundButton color={color} image={imagePreview} size={88} onPress={preview} />
          <div>
            <h2>{sound ? 'Sound bearbeiten' : 'Neuer Sound'}</h2>
            <button type="button" className="link-btn" onClick={preview}><Play size={14} /> Probehören (auf diesem Gerät)</button>
          </div>
        </div>

        <label className="field">
          <span className="field-label">Name</span>
          <input value={name} maxLength={40} onChange={e => { setName(e.target.value); setError(null) }} placeholder="z. B. Bier Bier"
            inputMode={IS_REMOTE ? undefined : 'none'} onFocus={() => !IS_REMOTE && setKeyboard(true)} />
        </label>

        {!keyboard && (
          <>
            <FilePick label={sound ? 'Ton ersetzen (optional)' : 'Ton'} accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.opus,.webm,.flac"
              file={audioFile} current={sound ? 'Bisherige Datei behalten' : null} onPick={setAudioFile} />
            <FilePick label="Bild (optional)" accept="image/png,image/jpeg,image/webp,image/gif"
              file={imageFile} current={sound?.image && !dropImage ? 'Bisheriges Bild' : null}
              onPick={file => { setImageFile(file); setDropImage(false) }} />
            {(imageFile || (sound?.image && !dropImage)) && (
              <button type="button" className="link-btn" onClick={() => { setImageFile(null); setDropImage(true) }}>
                <ImageOff size={14} /> Bild entfernen
              </button>
            )}
            <div>
              <span className="field-label">Farbe</span>
              <div className="swatches">
                {COLORS.map(c => (
                  <button type="button" key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }}
                    onClick={() => setColor(c)} aria-label={`Farbe ${c}`} />
                ))}
                <label className="swatch custom" title="Eigene Farbe">
                  <input type="color" value={color} onChange={e => setColor(e.target.value)} />
                </label>
              </div>
            </div>
            <p className="muted small">MP3, WAV, OGG, M4A u. a., höchstens 8 MB · Bild PNG/JPG/WEBP/GIF, höchstens 3 MB.</p>
          </>
        )}

        {error && <p className="muted error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Speichert …' : sound ? 'Speichern' : 'Erstellen'}</button>
        </div>
      </form>
      {!IS_REMOTE && keyboard && (
        <Keyboard value={name} onChange={v => setName(v.slice(0, 40))} enterLabel="Fertig"
          onEnter={() => setKeyboard(false)} onClose={() => setKeyboard(false)} />
      )}
    </div>
  )
}
