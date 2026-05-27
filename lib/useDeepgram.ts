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
  const listeningRef = useRef(false)

  // Close just the WebSocket and MediaRecorder but KEEP the microphone stream open
  const closeConnection = useCallback(() => {
    listeningRef.current = false
    accumulatedRef.current = ''
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stop()
    }
    mediaRecorderRef.current = null
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'CloseStream' }))
      wsRef.current.close(1000)
    }
    wsRef.current = null
  }, [])

  // Open a fresh WebSocket + MediaRecorder using existing stream
  const openConnection = useCallback(async (stream: MediaStream) => {
    accumulatedRef.current = ''
    listeningRef.current = true

    const tokenRes = await fetch('/api/deepgram-token', { method: 'POST' })
    const { key } = await tokenRes.json()

    const ws = new WebSocket(
      `wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true&interim_results=true&utterance_end_ms=2500&vad_events=true&endpointing=800`,
      ['token', key]
    )
    wsRef.current = ws

    ws.onopen = () => {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const mr = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mr
      mr.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN && listeningRef.current) {
          ws.send(e.data)
        }
      }
      mr.start(50)
    }

    ws.onmessage = (event) => {
      if (!listeningRef.current) return
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'UtteranceEnd') {
          if (accumulatedRef.current.trim()) {
            const text = accumulatedRef.current.trim()
            accumulatedRef.current = ''
            onUtteranceEnd(text)
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

    ws.onerror = () => onError('Connection error')
    ws.onclose = () => { listeningRef.current = false }
  }, [onTranscript, onUtteranceEnd, onError])

  const start = useCallback(async () => {
    try {
      // Get microphone once and keep it for the whole session
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000 },
        })
      }
      await openConnection(streamRef.current)
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Microphone access denied')
    }
  }, [openConnection, onError])

  // pause = close the WS connection (mic stays open)
  const pause = useCallback(() => {
    closeConnection()
  }, [closeConnection])

  // resume = open a fresh WS connection using existing mic stream
  const resume = useCallback(async () => {
    if (!streamRef.current) return
    try {
      await openConnection(streamRef.current)
    } catch (err) {
      console.error('Resume error:', err)
    }
  }, [openConnection])

  // stop = close everything including mic
  const stop = useCallback(() => {
    closeConnection()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [closeConnection])

  return { start, stop, pause, resume }
}
