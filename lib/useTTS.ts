import { useRef, useCallback } from 'react'

let sharedAudioContext: AudioContext | null = null
let abortFlag = false

export function unlockAudio() {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume()
  }
  // Play silent buffer — fully unlocks iOS audio engine
  const buffer = sharedAudioContext.createBuffer(1, 1, 22050)
  const source = sharedAudioContext.createBufferSource()
  source.buffer = buffer
  source.connect(sharedAudioContext.destination)
  source.start(0)
  abortFlag = false
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
    abortFlag = true
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop() } catch {}
      sourceNodeRef.current = null
    }
    setTimeout(() => { abortFlag = false }, 50)
  }, [])

  const speak = useCallback(async (text: string, onEnd: () => void): Promise<void> => {
    abortFlag = false
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop() } catch {}
      sourceNodeRef.current = null
    }

    try {
      const ctx = getAudioContext()
      // Always try to resume — iOS may have suspended it
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }

      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) throw new Error('TTS failed')
      if (abortFlag) return

      const arrayBuffer = await res.arrayBuffer()
      if (abortFlag) return

      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      if (abortFlag) return

      // Resume again after async gap — iOS can re-suspend
      if (ctx.state === 'suspended') await ctx.resume()

      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)
      sourceNodeRef.current = source
      source.onended = () => {
        sourceNodeRef.current = null
        if (!abortFlag) onEnd()
      }
      source.start(0)
    } catch (err) {
      console.error('TTS error:', err)
      if (!abortFlag) onEnd()
    }
  }, [])

  return { speak, stop }
}
