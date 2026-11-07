import { useEffect, useRef } from 'react'
import { API } from './jukebox'

// Spielt Nippelsounds auf dem Surface ab – mehrere dürfen sich überlagern.
export default function SoundEngine({ jb }) {
  const playing = useRef(new Set())
  const volumeRef = useRef(jb.soundVolume)
  volumeRef.current = jb.soundVolume

  useEffect(() => jb.onSoundEvent(msg => {
    if (msg.type === 'sound-stop') {
      playing.current.forEach(audio => audio.pause())
      playing.current.clear()
      return
    }
    const audio = new Audio(`${API}/soundfiles/${msg.file}`)
    audio.volume = volumeRef.current / 100
    playing.current.add(audio)
    audio.onended = () => playing.current.delete(audio)
    audio.play().catch(error => {
      playing.current.delete(audio)
      console.warn('Sound konnte nicht abgespielt werden', error)
    })
  }), [])

  // Lautstärke gilt auch für Sounds, die gerade laufen
  useEffect(() => {
    playing.current.forEach(audio => { audio.volume = jb.soundVolume / 100 })
  }, [jb.soundVolume])

  return null
}
