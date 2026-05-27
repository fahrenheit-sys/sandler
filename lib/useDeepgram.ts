import { useRef, useCallback } from 'react'

interface DeepgramOptions {
  onTranscript: (text: string, isFinal: boolean) => void
  onUtteranceEnd: (text: string) => void
  onError: (err: string) => void
}

export function useDeepgram({ onTranscript, onUtteranceEnd, onError }: DeepgramOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const accumulatedRef = useRef<string>('')
  const activeRef = useRef(false)

  const start = useCallback(async () => {
    if (activeRef.current) return
    activeRef.current = true
    accumulatedRef.current = ''

    try {
      const tokenRes = await fetch('/api/deepgram-token', { method: 'POST' })
      const { key } = await tokenRes.json()

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 },
      })
      streamRef.current = stream

      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true&interim_results=true&utterance_end_ms=1200&vad_events=true&endpointing=400`,
        ['token', key]
      )
      wsRef.current = ws

      ws.onopen = () => {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
        const mr = new MediaRecorder(stream, { mimeType })
        mediaRecorderRef.current = mr
        mr.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data)
        }
        mr.start(50)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'UtteranceEnd') {
            if (accumulatedRef.current.trim()) {
              onUtteranceEnd(accumulatedRef.current.trim())
              accumulatedRef.current = ''
            }
            return
          }
          const transcript = data?.channel?.alternatives?.[0]?.transcript
          if (!transcript) return
          if (data.is_final) {
            accumulatedRef.current = (accumulatedRef.current + ' ' + transcript).trim()
            onTranscript(accumulatedRef.current, true)
          } else {
            onTranscript((accumulatedRef.current + ' ' + transcript).trim(), false)
          }
        } catch {}
      }

      ws.onerror = () => onError('Microphone connection error')
      ws.onclose = () => { activeRef.current = false }
    } catch (err: unknown) {
      activeRef.current = false
      onError(err instanceof Error ? err.message : 'Microphone access denied')
    }
  }, [onTranscript, onUtteranceEnd, onError])

  const stop = useCallback(() => {
    activeRef.current = false
    accumulatedRef.current = ''
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'CloseStream' }))
      wsRef.current.close(1000)
    }
    wsRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const pause = useCallback(() => {
    // Pause sending audio but keep stream open
    mediaRecorderRef.current?.pause()
  }, [])

  const resume = useCallback(() => {
    accumulatedRef.current = ''
    mediaRecorderRef.current?.resume()
  }, [])

  return { start, stop, pause, resume }
}
