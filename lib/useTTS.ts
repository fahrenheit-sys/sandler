import { useRef, useCallback } from 'react'

let sharedAudioContext: AudioContext | null = null

export function unlockAudio() {
  // Must be called directly from a user gesture (tap/click)
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume()
  }
  // Play a silent buffer to fully unlock iOS audio
  const buffer = sharedAudioContext.createBuffer(1, 1, 22050)
  const source = sharedAudioContext.createBufferSource()
  source.buffer = buffer
  source.connect(sharedAudioContext.destination)
  source.start(0)
}

function getAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  return sharedAudioContext
}

export function useTTS() {
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null)

  const stop = useCallback(() => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop() } catch {}
      sourceNodeRef.current = null
    }
  }, [])

  const speak = useCallback(async (text: string, onEnd: () => void): Promise<void> => {
    stop()
    try {
      const ctx = getAudioContext()
      if (ctx.state === 'suspended') await ctx.resume()

      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) throw new Error('TTS failed')

      const arrayBuffer = await res.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)
      sourceNodeRef.current = source
      source.onended = () => { sourceNodeRef.current = null; onEnd() }
      source.start(0)
    } catch (err) {
      console.error('TTS error:', err)
      onEnd()
    }
  }, [stop])

  return { speak, stop }
}
