import { useState, useRef, useEffect, useCallback } from 'react'
import { useDeepgram } from '../lib/useDeepgram'
import { useTTS, unlockAudio } from '../lib/useTTS'

const VERSION = 'v1.3'

type SessionState = 'start' | 'tap-to-begin' | 'session' | 'summary'
type TurnState = 'prospect' | 'listening' | 'thinking' | 'speaking' | 'ending'

interface Message { role: 'user' | 'assistant'; content: string }
interface TranscriptLine { speaker: 'prospect' | 'you'; text: string }
interface Alternative { prospect_line: string; salesperson_said: string; stroke: string; return: string; why: string }
interface SummaryData { overall_assessment: string; alternatives: Alternative[] }

export default function SandlerSession({ autostart = false }: { autostart?: boolean }) {
  const [screen, setScreen] = useState<SessionState>('start')
  const [countdown, setCountdown] = useState(3)
  const [turnState, setTurnState] = useState<TurnState>('prospect')
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [interimText, setInterimText] = useState('')
  const [duration, setDuration] = useState(0)
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)

  const messagesRef = useRef<Message[]>([])
  const transcriptRef = useRef<TranscriptLine[]>([])
  const turnStateRef = useRef<TurnState>('prospect')
  const seedRef = useRef(String.fromCharCode(65 + Math.floor(Math.random() * 26)))
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { speak, stop: stopTTS } = useTTS()

  const setTurn = (t: TurnState) => { turnStateRef.current = t; setTurnState(t) }

  const startSession = useCallback(async () => {
    setScreen('session')
    setDuration(0)

    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'opening', seed: seedRef.current }),
    })
    const { text: opening } = await res.json()

    messagesRef.current = [{ role: 'assistant', content: opening }]
    transcriptRef.current = [{ speaker: 'prospect', text: opening }]
    setTranscript([{ speaker: 'prospect', text: opening }])
    setTurn('speaking')

    await speak(opening, async () => {
      await startSTT()
      setTurn('listening')
    })

    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
  }, [speak])

  // Autostart — show tap-to-begin screen with countdown
  useEffect(() => {
    if (!autostart) return
    setScreen('tap-to-begin')
    setCountdown(3)
  }, [autostart])

  useEffect(() => {
    return () => {
      stopTTS()
      stopSTT()
      if (timerRef.current) clearInterval(timerRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

  const handleTapToBegin = useCallback(() => {
    // This tap is the user gesture — unlock iOS audio here
    unlockAudio()
    let count = 3
    setCountdown(count)
    countdownRef.current = setInterval(() => {
      count -= 1
      setCountdown(count)
      if (count <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current)
        startSession()
      }
    }, 1000)
  }, [startSession])

  const handleEndSession = useCallback(() => {
    stopTTS()
    stopSTT()
    if (timerRef.current) clearInterval(timerRef.current)
    setScreen('start')
    setTranscript([])
    setSummary(null)
    setTurn('prospect')
    messagesRef.current = []
    transcriptRef.current = []
    seedRef.current = String.fromCharCode(65 + Math.floor(Math.random() * 26))
  }, [stopTTS])

  const handleReview = useCallback(async () => {
    setTurn('ending')
    stopSTT()
    stopTTS()
    setSummaryLoading(true)
    setScreen('summary')
    const flat = transcriptRef.current.map(t => `${t.speaker === 'you' ? 'SALESPERSON' : 'PROSPECT'}: ${t.text}`).join('\n')
    const summaryRes = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'summary', transcript: flat }),
    })
    const { result } = await summaryRes.json()
    try {
      const parsed = JSON.parse(result)
      setSummary(parsed)
      if (parsed.overall_assessment) {
        await speak(`Here's your coaching summary. ${parsed.overall_assessment} Let me walk you through three alternative approaches.`, () => {
          const speakAlt = async (i: number) => {
            if (i >= parsed.alternatives.length) return
            const alt = parsed.alternatives[i]
            await speak(`Alternative ${i + 1}. When the prospect said: "${alt.prospect_line}" — a stronger stroke: "${alt.stroke}" — followed by: "${alt.return}". ${alt.why}`, () => speakAlt(i + 1))
          }
          speakAlt(0)
        })
      }
    } catch { setSummary(null) }
    setSummaryLoading(false)
  }, [stopSTT, stopTTS, speak])

  const handleUserSpeech = useCallback(async (text: string) => {
    if (!text.trim()) { setTurn('listening'); return }

    const lower = text.toLowerCase().trim().replace(/[.,!?]$/, '')

    if (lower === 'end session' || lower === 'end' || lower === 'stop' || lower.endsWith(' end') || lower.endsWith(' stop')) {
      handleEndSession()
      return
    }

    if (lower === 'review' || lower.includes('review session') || lower.includes('get review')) {
      handleReview()
      return
    }

    const userMsg: Message = { role: 'user', content: text }
    const updated = [...messagesRef.current, userMsg]
    messagesRef.current = updated
    transcriptRef.current = [...transcriptRef.current, { speaker: 'you', text }]
    setTranscript([...transcriptRef.current])
    setInterimText('')
    setTurn('thinking')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chat', messages: updated, seed: seedRef.current }),
      })
      const { text: reply } = await res.json()
      const aiMsg: Message = { role: 'assistant', content: reply }
      messagesRef.current = [...updated, aiMsg]
      transcriptRef.current = [...transcriptRef.current, { speaker: 'prospect', text: reply }]
      setTranscript([...transcriptRef.current])
      setTurn('speaking')
      pauseSTT()
      await speak(reply, () => {
        setTimeout(() => { setTurn('listening'); resumeSTT() }, 400)
      })
    } catch {
      setTurn('listening')
      setTimeout(() => resumeSTT(), 400)
    }
  }, [speak, stopTTS])

  const handleTranscript = useCallback((text: string, _isFinal: boolean) => {
    if (turnStateRef.current === 'listening') setInterimText(text)
  }, [])

  const handleUtteranceEnd = useCallback((text: string) => {
    if (turnStateRef.current !== 'listening') return
    handleUserSpeech(text)
  }, [handleUserSpeech])

  const { start: startSTT, stop: stopSTT, pause: pauseSTT, resume: resumeSTT } = useDeepgram({
    onTranscript: handleTranscript,
    onUtteranceEnd: handleUtteranceEnd,
    onError: (err) => { console.error(err); setTurn('listening') },
  })

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // ── START ──
  if (screen === 'start') {
    return (
      <div style={s.screen}>
        <div style={s.startInner}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#999', marginBottom: 12, textTransform: 'uppercase' as const }}>Sandler Trainer · {VERSION}</div>
          <h1 style={{ fontSize: 40, fontWeight: 700, color: '#000', letterSpacing: '-0.02em', marginBottom: 6 }}>Stroke + Return</h1>
          <p style={{ fontSize: 15, color: '#666', marginBottom: 48, fontWeight: 400 }}>Gym membership sales simulation</p>

          <div style={s.infoBlock}>
            {[
              ['A random prospect opens with a question about price, features, or commitment.', '1'],
              ['Respond with a stroke — warm acknowledgment — then a return question.', '2'],
              ['Hands-free once started. Say "end" or tap the button to finish.', '3'],
              ['Receive verbal coaching on 3 better alternatives.', '4'],
            ].map(([text, num]) => (
              <div key={num} style={s.infoRow}>
                <div style={s.infoNum}>{num}</div>
                <div style={{ fontSize: 14, color: '#444', lineHeight: 1.5 }}>{text}</div>
              </div>
            ))}
          </div>

          <button onClick={() => { unlockAudio(); startSession() }} style={{ ...s.primaryBtn, width: '100%', maxWidth: 360 }}>
            Begin Session
          </button>
        </div>
      </div>
    )
  }

  // ── TAP TO BEGIN (autostart) ──
  if (screen === 'tap-to-begin') {
    return (
      <div style={s.screen}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 32, padding: 40 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#999', textTransform: 'uppercase' as const }}>Sandler Trainer · {VERSION}</div>
          <h2 style={{ fontSize: 28, fontWeight: 600, color: '#000', letterSpacing: '-0.01em', textAlign: 'center' as const }}>Ready to train?</h2>
          <button
            onClick={handleTapToBegin}
            style={{ ...s.primaryBtn, fontSize: 20, padding: '24px 48px', borderRadius: 20 }}
          >
            Tap to Begin
          </button>
          <p style={{ fontSize: 13, color: '#999', textAlign: 'center' as const, maxWidth: 260, lineHeight: 1.5 }}>
            One tap unlocks audio on iPhone, then it's fully hands-free
          </p>
        </div>
      </div>
    )
  }

  // ── SUMMARY ──
  if (screen === 'summary') {
    return (
      <div style={{ ...s.screen, background: '#fff' }}>
        <div style={{ padding: '52px 24px 0', flex: 1, overflowY: 'auto' as const }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#999', marginBottom: 8, textTransform: 'uppercase' as const }}>Session Debrief · {VERSION}</div>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: '#000', letterSpacing: '-0.01em', marginBottom: 24 }}>Your Coaching</h2>

          {summaryLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '40px 0' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#000', animation: 'blink 0.9s ease-in-out infinite' }} />
              <span style={{ color: '#999', fontSize: 14 }}>Analysing your session…</span>
            </div>
          ) : summary ? (
            <>
              <div style={{ fontSize: 15, color: '#333', lineHeight: 1.7, marginBottom: 36, padding: '16px 18px', background: '#f5f5f7', borderRadius: 12 }}>
                {summary.overall_assessment}
              </div>

              <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#999', marginBottom: 16, textTransform: 'uppercase' as const }}>3 Alternative Approaches</div>

              {(summary.alternatives || []).slice(0, 3).map((alt, i) => (
                <div key={i} style={s.altCard}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#000', letterSpacing: '0.05em', marginBottom: 12 }}>ALTERNATIVE {i + 1}</div>
                  <div style={s.altRow}><span style={s.altLabel}>Prospect</span><span style={s.altValue}>"{alt.prospect_line}"</span></div>
                  <div style={s.altRow}><span style={s.altLabel}>You said</span><span style={{ ...s.altValue, color: '#999' }}>"{alt.salesperson_said}"</span></div>
                  <div style={{ borderTop: '1px solid #e5e5e5', margin: '10px 0' }} />
                  <div style={s.altRow}><span style={{ ...s.altLabel, color: '#000', fontWeight: 600 }}>Stroke</span><span style={{ ...s.altValue, color: '#000' }}>"{alt.stroke}"</span></div>
                  <div style={s.altRow}><span style={{ ...s.altLabel, color: '#000', fontWeight: 600 }}>Return</span><span style={{ ...s.altValue, color: '#000' }}>"{alt.return}"</span></div>
                  <div style={{ fontSize: 13, color: '#666', marginTop: 8, lineHeight: 1.5 }}>{alt.why}</div>
                </div>
              ))}

              <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#999', marginTop: 28, marginBottom: 12, textTransform: 'uppercase' as const }}>Transcript</div>
              {transcriptRef.current.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingBottom: 10, borderBottom: '1px solid #f0f0f0', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, minWidth: 32, color: t.speaker === 'you' ? '#000' : '#999', textTransform: 'uppercase' as const, fontWeight: 600, paddingTop: 2 }}>
                    {t.speaker === 'you' ? 'YOU' : 'PRO'}
                  </span>
                  <span style={{ fontSize: 13, color: t.speaker === 'you' ? '#000' : '#666', lineHeight: 1.5 }}>{t.text}</span>
                </div>
              ))}
              <div style={{ height: 40 }} />
            </>
          ) : (
            <div style={{ color: '#999', fontSize: 14 }}>Session too short to analyse.</div>
          )}
        </div>

        <div style={{ padding: '16px 24px 32px', borderTop: '1px solid #f0f0f0' }}>
          <button onClick={() => {
            stopTTS()
            setScreen('start')
            setTranscript([])
            setSummary(null)
            seedRef.current = String.fromCharCode(65 + Math.floor(Math.random() * 26))
          }} style={{ ...s.primaryBtn, width: '100%' }}>
            New Session
          </button>
        </div>
      </div>
    )
  }

  // ── SESSION ──
  const isListening = turnState === 'listening'
  const isSpeaking = turnState === 'speaking'
  const isThinking = turnState === 'thinking'

  const orbColor = isListening ? '#000' : isSpeaking ? '#333' : '#666'
  const orbAnim = isThinking ? 'breathe 1.5s ease-in-out infinite' : isSpeaking ? 'speak-anim 0.6s ease-in-out infinite' : 'none'

  return (
    <div style={{ ...s.screen, background: '#fff' }}>
      {/* Header */}
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#000' }}>Sandler</span>
          <span style={{ fontSize: 13, color: '#999' }}>{fmt(duration)}</span>
        </div>
        <span style={{ fontSize: 11, color: '#ccc', letterSpacing: '0.05em' }}>{VERSION}</span>
      </div>

      {/* Orb */}
      <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 16, padding: '32px 0 20px', flexShrink: 0 }}>
        <div style={{ position: 'relative' as const, width: 140, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {[110, 130].map((size, i) => (
            <div key={i} style={{ position: 'absolute' as const, width: size, height: size, borderRadius: '50%', border: '1px solid #000', opacity: isListening ? (i === 0 ? 0.15 : 0.07) : 0, animation: isListening ? `pulse-ring 1.4s ease-in-out ${i * 0.2}s infinite` : 'none', transition: 'opacity 0.4s' }} />
          ))}
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: orbColor, boxShadow: isListening ? '0 0 30px rgba(0,0,0,0.15)' : 'none', animation: orbAnim, transition: 'background 0.4s, box-shadow 0.4s' }} />
        </div>

        <div style={{ fontSize: 14, color: '#999', fontWeight: 400 }}>
          {turnState === 'prospect' ? 'Preparing…'
            : isSpeaking ? 'Prospect speaking…'
            : isThinking ? 'Thinking…'
            : turnState === 'ending' ? 'Ending session…'
            : 'Your turn'}
        </div>

        {isListening && interimText && (
          <div style={{ maxWidth: 300, textAlign: 'center' as const, fontSize: 14, color: '#666', fontStyle: 'italic', background: '#f5f5f7', padding: '10px 16px', borderRadius: 10, lineHeight: 1.5 }}>
            {interimText}
          </div>
        )}
      </div>

      {/* Sandler hint */}
      {isListening && (
        <div style={{ margin: '0 20px 14px', padding: '12px 16px', background: '#f5f5f7', borderRadius: 10, fontSize: 13, color: '#555', lineHeight: 1.6, flexShrink: 0 }}>
          <strong style={{ color: '#000' }}>Stroke</strong> — acknowledge warmly &nbsp;·&nbsp; <strong style={{ color: '#000' }}>Return</strong> — ask a curious question back
        </div>
      )}

      {/* Transcript */}
      <div style={{ flex: 1, overflowY: 'auto' as const, padding: '0 20px', display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
        {transcript.slice(-8).map((t, i, arr) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingBottom: 10, borderBottom: '1px solid #f0f0f0', opacity: arr.length > 4 && i < 2 ? 0.4 : 1, animation: i === arr.length - 1 ? 'fade-in 0.3s ease' : 'none' }}>
            <span style={{ fontSize: 10, minWidth: 28, color: t.speaker === 'you' ? '#000' : '#bbb', textTransform: 'uppercase' as const, fontWeight: 600, paddingTop: 3 }}>
              {t.speaker === 'you' ? 'YOU' : 'PRO'}
            </span>
            <span style={{ fontSize: 14, lineHeight: 1.55, color: t.speaker === 'you' ? '#000' : '#888' }}>
              {t.text}
            </span>
          </div>
        ))}
      </div>

      {/* Buttons */}
      <div style={{ padding: '14px 20px 28px', flexShrink: 0, display: 'flex', gap: 10 }}>
        <button
          onClick={handleEndSession}
          disabled={turnState === 'ending'}
          style={{ ...s.secondaryBtn, opacity: turnState === 'ending' ? 0.4 : 1 }}
        >
          End Session
        </button>
        <button
          onClick={handleReview}
          disabled={turnState === 'ending'}
          style={{ ...s.primaryBtn, flex: 1, opacity: turnState === 'ending' ? 0.4 : 1 }}
        >
          Review
        </button>
      </div>
      <p style={{ textAlign: 'center' as const, fontSize: 12, color: '#ccc', paddingBottom: 16, flexShrink: 0, letterSpacing: '0.02em' }}>
        {transcript.length} exchanges · say "end session" or "review"
      </p>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  screen: { height: '100dvh', background: '#fff', display: 'flex', flexDirection: 'column', paddingBottom: 'env(safe-area-inset-bottom)' },
  startInner: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 28px' },
  infoBlock: { display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 40, width: '100%', maxWidth: 360 },
  infoRow: { display: 'flex', gap: 14, alignItems: 'flex-start' },
  infoNum: { width: 24, height: 24, borderRadius: '50%', background: '#000', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  primaryBtn: { flex: 1, padding: '16px', background: '#000', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 600, color: '#fff', cursor: 'pointer', transition: 'opacity 0.2s', letterSpacing: '-0.01em' },
  secondaryBtn: { flex: 1, padding: '16px', background: '#f5f5f7', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 600, color: '#000', cursor: 'pointer', transition: 'opacity 0.2s', letterSpacing: '-0.01em' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '56px 20px 16px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 },
  altCard: { background: '#f5f5f7', borderRadius: 12, padding: '16px', marginBottom: 12 },
  altRow: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 },
  altLabel: { fontSize: 11, color: '#999', minWidth: 56, paddingTop: 2, fontWeight: 500 },
  altValue: { fontSize: 13, color: '#333', lineHeight: 1.5, flex: 1 },
}
