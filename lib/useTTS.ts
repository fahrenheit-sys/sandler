import { useRef, useCallback } from 'react'

let sharedAudioContext: AudioContext | null = null
// Global abort flag — set to true to cancel all pending speech
let abortFlag = false

export function unlockAudio() {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
  }
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume()
  }
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
    // Set global abort so any chained speak() calls bail out
    abortFlag = true
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop() } catch {}
      sourceNodeRef.current = null
    }
    // Reset after a tick so new speak() calls work
    setTimeout(() => { abortFlag = false }, 50)
  }, [])

  const speak = useCallback(async (text: string, onEnd: () => void): Promise<void> => {
    // Reset abort for new speak chains
    abortFlag = false
    // Stop any current audio
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop() } catch {}
      sourceNodeRef.current = null
    }

    try {
      const ctx = getAudioContext()
      if (ctx.state === 'suspended') await ctx.resume()

      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) throw new Error('TTS failed')

      // Check abort before decoding
      if (abortFlag) return

      const arrayBuffer = await res.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

      // Check abort again after async decode
      if (abortFlag) return

      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)
      sourceNodeRef.current = source

      source.onended = () => {
        sourceNodeRef.current = null
        // Only fire onEnd if not aborted
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
