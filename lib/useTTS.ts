import { useRef, useCallback } from 'react'

let abortFlag = false
let sharedAudio: HTMLAudioElement | null = null

export function unlockAudio() {
  abortFlag = false
  if (!sharedAudio) {
    sharedAudio = new Audio()
  }
  sharedAudio.volume = 1
  // Play silent WAV to unlock
  sharedAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'
  sharedAudio.play().catch(() => {})
}

export function useTTS() {
  const blobUrlRef = useRef<string | null>(null)

  const stop = useCallback(() => {
    abortFlag = true
    if (sharedAudio) {
      sharedAudio.pause()
      sharedAudio.onended = null
      sharedAudio.onerror = null
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    setTimeout(() => { abortFlag = false }, 50)
  }, [])

  const speak = useCallback(async (text: string, onEnd: () => void, mode?: string): Promise<void> => {
    abortFlag = false

    // Stop current audio
    if (sharedAudio) {
      sharedAudio.pause()
      sharedAudio.onended = null
      sharedAudio.onerror = null
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, mode }),
      })
      if (!res.ok) throw new Error('TTS failed')
      if (abortFlag) return

      const blob = await res.blob()
      if (abortFlag) return

      const url = URL.createObjectURL(blob)
      blobUrlRef.current = url

      // Always use the shared element — it stays unlocked from the gesture
      if (!sharedAudio) sharedAudio = new Audio()
      sharedAudio.volume = 1
      sharedAudio.src = url

      sharedAudio.onended = () => {
        if (blobUrlRef.current === url) {
          URL.revokeObjectURL(url)
          blobUrlRef.current = null
        }
        if (sharedAudio) {
          sharedAudio.onended = null
          sharedAudio.onerror = null
        }
        if (!abortFlag) onEnd()
      }

      sharedAudio.onerror = (e) => {
        console.error('Audio error:', e)
        if (blobUrlRef.current === url) {
          URL.revokeObjectURL(url)
          blobUrlRef.current = null
        }
        if (!abortFlag) onEnd()
      }

      // Load then play — more reliable than just setting src and playing
      sharedAudio.load()
      const playPromise = sharedAudio.play()
      if (playPromise) {
        playPromise.catch(err => {
          console.error('Play failed:', err)
          if (!abortFlag) onEnd()
        })
      }
    } catch (err) {
      console.error('TTS error:', err)
      if (!abortFlag) onEnd()
    }
  }, [])

  return { speak, stop }
}
