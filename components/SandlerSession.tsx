import { useState, useRef, useEffect, useCallback } from 'react'
import { useDeepgram } from '../lib/useDeepgram'
import { useTTS, unlockAudio } from '../lib/useTTS'

const VERSION = 'v1.4'

type SessionState = 'start' | 'tap-to-begin' | 'session' | 'summary' | 'demo'
type TurnState = 'prospect' | 'listening' | 'thinking' | 'speaking' | 'ending'

interface Message { role: 'user' | 'assistant'; content: string }
interface TranscriptLine { speaker: 'prospect' | 'you'; text: string }
interface Alternative { prospect_line: string; salesperson_said: string; stroke: string; return: string; why: string }
interface SummaryData { overall_assessment: string; alternatives: Alternative[] }
interface DemoResult {
  stroke: string
  return: string
  combined: string
  why_stroke: string
  why_return: string
  what_to_listen_for: string
}

export default function SandlerSession({ autostart = false }: { autostart?: boolean }) {
  const [screen, setScreen] = useState<SessionState>('start')
  const [countdown, setCountdown] = useState(3)
  const [turnState, setTurnState] = useState<TurnState>('prospect')
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [interimText, setInterimText] = useState('')
  const [duration, setDuration] = useState(0)
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [demoQuestion, setDemoQuestion] = useState('')
  const [demoResult, setDemoResult] = useState<DemoResult | null>(null)
  const [demoLoading, setDemoLoading] = useState(false)
  const [demoHistory, setDemoHistory] = useState<{ question: string; result: DemoResult }[]>([])

  const messagesRef = useRef<Message[]>([])
  const transcriptRef = useRef<TranscriptLine[]>([])
  const turnStateRef = useRef<TurnState>('prospect')
  const seedRef = useRef(String.fromCharCode(65 + Math.floor(Math.random() * 26)))
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pauseSTTRef = useRef<() => void>(() => {})
  const resumeSTTRef = useRef<() => void>(() => {})

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
      pauseSTTRef.current()
      await speak(reply, () => {
        setTimeout(() => { setTurn('listening'); resumeSTTRef.current() }, 400)
      })
    } catch {
      setTurn('listening')
      setTimeout(() => resumeSTTRef.current(), 400)
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

  // Keep refs in sync so handleUserSpeech can call them before declaration order matters
  pauseSTTRef.current = pauseSTT
  resumeSTTRef.current = resumeSTT

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // ── START ──
  if (screen === 'start') {
    return (
      <div style={s.screen}>
        <div style={s.startInner}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#999', marginBottom: 12, textTransform: 'uppercase' as const }}>Sandler Trainer · {VERSION}</div>
          <h1 style={{ fontSize: 36, fontWeight: 700, color: '#000', letterSpacing: '-0.02em', marginBottom: 6 }}>Stroke + Return</h1>
          <p style={{ fontSize: 15, color: '#666', marginBottom: 36, fontWeight: 400 }}>Fahrenheit One · Sales Training</p>

          <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column' as const, gap: 12, marginBottom: 16 }}>
            <button onClick={() => { unlockAudio(); startSession() }} style={s.modeCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#000', letterSpacing: '0.04em' }}>YOU ANSWER</div>
                <div style={{ fontSize: 10, color: '#999', background: '#f0f0f0', padding: '2px 8px', borderRadius: 20 }}>Mode 1</div>
              </div>
              <div style={{ fontSize: 13, color: '#555', lineHeight: 1.55 }}>A prospect asks a Fahrenheit One question. You respond with stroke + return. Get coached on your technique.</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#000', marginTop: 12 }}>Start session →</div>
            </button>

            <button onClick={() => { setDemoResult(null); setDemoQuestion(''); setScreen('demo') }} style={{ ...s.modeCard, background: '#000', borderColor: '#000' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>WATCH & LEARN</div>
                <div style={{ fontSize: 10, color: '#888', background: '#222', padding: '2px 8px', borderRadius: 20 }}>Mode 2</div>
              </div>
              <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.55 }}>Type any prospect question. The AI shows the perfect stroke + return and explains why it works.</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginTop: 12 }}>Try it →</div>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── DEMO (Watch & Learn) ──
  if (screen === 'demo') {
    const handleDemo = async () => {
      if (!demoQuestion.trim()) return
      setDemoLoading(true)
      setDemoResult(null)
      try {
        const res = await fetch('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'demo', question: demoQuestion }),
        })
        const { result } = await res.json()
        const parsed = JSON.parse(result)
        setDemoResult(parsed)
        setDemoHistory(h => [{ question: demoQuestion, result: parsed }, ...h.slice(0, 9)])
        // Speak the combined response
        unlockAudio()
        speak(parsed.combined, () => {})
      } catch { setDemoResult(null) }
      setDemoLoading(false)
    }

    return (
      <div style={s.screen}>
        <div style={s.header}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#000' }}>Watch & Learn</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#ccc' }}>{VERSION}</span>
            <button onClick={() => { stopTTS(); setScreen('start') }} style={{ fontSize: 13, color: '#999', background: 'none', border: 'none', cursor: 'pointer' }}>← Back</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' as const, padding: '20px 20px 0' }}>
          <p style={{ fontSize: 13, color: '#999', lineHeight: 1.6, marginBottom: 20 }}>
            Type a prospect question below. The AI will show you the perfect Sandler stroke + return, speak it aloud, and explain why it works.
          </p>

          {/* Quick suggestion chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 20 }}>
            {[
              'How much does a membership cost?',
              'Can I cancel anytime?',
              'What makes you different from other gyms?',
              'Is this connected to the Jewish community?',
              'Why would I join something not opening until 2027?',
              'I already pay for a Pilates studio — why would I switch?',
            ].map(q => (
              <button key={q} onClick={() => setDemoQuestion(q)} style={{ fontSize: 11, color: '#555', background: '#f5f5f7', border: 'none', padding: '6px 12px', borderRadius: 20, cursor: 'pointer', textAlign: 'left' as const, lineHeight: 1.4 }}>
                {q}
              </button>
            ))}
          </div>

          {/* Input */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
            <input
              value={demoQuestion}
              onChange={e => setDemoQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleDemo()}
              placeholder="Type a prospect question…"
              style={{ flex: 1, padding: '14px 16px', borderRadius: 12, border: '1.5px solid #e0e0e0', fontSize: 14, color: '#000', outline: 'none', background: '#fff' }}
            />
            <button onClick={handleDemo} disabled={demoLoading || !demoQuestion.trim()} style={{ padding: '14px 20px', background: '#000', color: '#fff', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: demoLoading || !demoQuestion.trim() ? 0.4 : 1 }}>
              {demoLoading ? '…' : 'Go'}
            </button>
          </div>

          {/* Result */}
          {demoResult && (
            <div style={{ animation: 'fade-in 0.3s ease' }}>
              <div style={{ background: '#f5f5f7', borderRadius: 14, padding: '20px', marginBottom: 16 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#999', marginBottom: 12, textTransform: 'uppercase' as const }}>Prospect said</div>
                <div style={{ fontSize: 14, color: '#333', fontStyle: 'italic', marginBottom: 16 }}>&ldquo;{demoQuestion}&rdquo;</div>

                <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#999', marginBottom: 8, textTransform: 'uppercase' as const }}>Perfect Response</div>
                <div style={{ fontSize: 15, color: '#000', lineHeight: 1.65, fontWeight: 500, marginBottom: 16, padding: '14px', background: '#fff', borderRadius: 10, borderLeft: '3px solid #000' }}>
                  &ldquo;{demoResult.combined}&rdquo;
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                  <div style={{ background: '#fff', borderRadius: 10, padding: '12px' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: '#000', marginBottom: 6 }}>STROKE</div>
                    <div style={{ fontSize: 12, color: '#333', lineHeight: 1.5, marginBottom: 8, fontStyle: 'italic' }}>&ldquo;{demoResult.stroke}&rdquo;</div>
                    <div style={{ fontSize: 11, color: '#888', lineHeight: 1.4 }}>{demoResult.why_stroke}</div>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 10, padding: '12px' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: '#000', marginBottom: 6 }}>RETURN</div>
                    <div style={{ fontSize: 12, color: '#333', lineHeight: 1.5, marginBottom: 8, fontStyle: 'italic' }}>&ldquo;{demoResult.return}&rdquo;</div>
                    <div style={{ fontSize: 11, color: '#888', lineHeight: 1.4 }}>{demoResult.why_return}</div>
                  </div>
                </div>

                <div style={{ background: '#fff', borderRadius: 10, padding: '12px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: '#000', marginBottom: 6 }}>LISTEN FOR</div>
                  <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>{demoResult.what_to_listen_for}</div>
                </div>
              </div>

              <button onClick={() => { speak(demoResult!.combined, () => {}) }} style={{ ...s.secondaryBtn, width: '100%', marginBottom: 24 }}>
                ▶ Play Again
              </button>
            </div>
          )}

          {/* History */}
          {demoHistory.length > 1 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#ccc', marginBottom: 12, textTransform: 'uppercase' as const }}>Previous</div>
              {demoHistory.slice(1).map((h, i) => (
                <button key={i} onClick={() => { setDemoQuestion(h.question); setDemoResult(h.result); speak(h.result.combined, () => {}) }} style={{ width: '100%', textAlign: 'left' as const, background: '#f5f5f7', border: 'none', borderRadius: 10, padding: '12px', marginBottom: 8, cursor: 'pointer' }}>
                  <div style={{ fontSize: 12, color: '#333', lineHeight: 1.4 }}>&ldquo;{h.question}&rdquo;</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{h.result.stroke.substring(0, 40)}…</div>
                </button>
              ))}
            </div>
          )}
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
  modeCard: { width: '100%', textAlign: 'left' as const, padding: '20px', background: '#fff', border: '1.5px solid #e8e8e8', borderRadius: 16, cursor: 'pointer', transition: 'all 0.15s ease' },
  secondaryBtn: { flex: 1, padding: '16px', background: '#f5f5f7', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 600, color: '#000', cursor: 'pointer', transition: 'opacity 0.2s', letterSpacing: '-0.01em' },
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
