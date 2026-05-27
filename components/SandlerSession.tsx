import { useState, useRef, useEffect, useCallback } from 'react'
import { useDeepgram } from '../lib/useDeepgram'
import { useTTS, unlockAudio } from '../lib/useTTS'

const VERSION = 'v1.5'

type Screen = 'start' | 'countdown' | 'session' | 'summary' | 'demo'
type Turn = 'prospect' | 'listening' | 'thinking' | 'speaking' | 'ending'

interface Msg { role: 'user' | 'assistant'; content: string }
interface TxLine { speaker: 'prospect' | 'you'; text: string }
interface Alt { prospect_line: string; salesperson_said: string; stroke: string; return: string; why: string }
interface Summary { overall_assessment: string; alternatives: Alt[] }
interface DemoResult { stroke: string; return: string; combined: string; why_stroke: string; why_return: string; what_to_listen_for: string; info?: string }

export default function SandlerSession({ autostart = false }: { autostart?: boolean }) {
  const [screen, setScreen] = useState<Screen>('start')
  const [countdown, setCountdown] = useState(3)
  const [turn, setTurnState] = useState<Turn>('prospect')
  const [transcript, setTranscript] = useState<TxLine[]>([])
  const [interim, setInterim] = useState('')
  const [duration, setDuration] = useState(0)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [demoQ, setDemoQ] = useState('')
  const [demoResult, setDemoResult] = useState<DemoResult | null>(null)
  const [demoLoading, setDemoLoading] = useState(false)
  const [demoHistory, setDemoHistory] = useState<{ question: string; result: DemoResult }[]>([])

  // Refs
  const msgsRef = useRef<Msg[]>([])
  const txRef = useRef<TxLine[]>([])
  const turnRef = useRef<Turn>('prospect')
  const seedRef = useRef(String.fromCharCode(65 + Math.floor(Math.random() * 26)))
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Stable refs for STT functions (declared before hooks that use them)
  const stopSTTRef = useRef<() => void>(() => {})
  const pauseSTTRef = useRef<() => void>(() => {})
  const resumeSTTRef = useRef<() => void>(() => {})
  const startSTTRef = useRef<() => Promise<void>>(async () => {})

  const setTurn = (t: Turn) => { turnRef.current = t; setTurnState(t) }

  const { speak, stop: stopTTS } = useTTS()

  // ── NAVIGATION ──
  const goHome = useCallback(() => {
    stopTTS()
    stopSTTRef.current()
    if (timerRef.current) clearInterval(timerRef.current)
    if (cdRef.current) clearInterval(cdRef.current)
    setScreen('start')
    setTranscript([])
    setSummary(null)
    setDemoResult(null)
    setDemoQ('')
    setTurn('prospect')
    msgsRef.current = []
    txRef.current = []
    seedRef.current = String.fromCharCode(65 + Math.floor(Math.random() * 26))
  }, [stopTTS])

  // ── SESSION START ──
  const startSession = useCallback(async () => {
    setScreen('session')
    setDuration(0)
    setTranscript([])
    msgsRef.current = []
    txRef.current = []

    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'opening', seed: seedRef.current }),
    })
    const { text: opening } = await res.json()

    msgsRef.current = [{ role: 'assistant', content: opening }]
    txRef.current = [{ speaker: 'prospect', text: opening }]
    setTranscript([{ speaker: 'prospect', text: opening }])
    setTurn('speaking')

    unlockAudio()
    await speak(opening, async () => {
      await startSTTRef.current()
      setTurn('listening')
    })

    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
  }, [speak])

  // ── REVIEW ──
  const doReview = useCallback(async () => {
    setTurn('ending')
    stopSTTRef.current()
    stopTTS()
    setSummaryLoading(true)
    setScreen('summary')

    const flat = txRef.current.map(t => `${t.speaker === 'you' ? 'SALESPERSON' : 'PROSPECT'}: ${t.text}`).join('\n')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'summary', transcript: flat }),
      })
      const { result } = await res.json()
      const parsed = JSON.parse(result)
      setSummary(parsed)
      if (parsed.overall_assessment) {
        await speak(`Here's your coaching summary. ${parsed.overall_assessment} Let me walk you through three alternative approaches.`, () => {
          const speakAlt = async (i: number) => {
            if (i >= parsed.alternatives.length) return
            const alt = parsed.alternatives[i]
            await speak(`Alternative ${i + 1}. When the prospect said: "${alt.prospect_line}" — stroke: "${alt.stroke}" — return: "${alt.return}". ${alt.why}`, () => speakAlt(i + 1))
          }
          speakAlt(0)
        })
      }
    } catch { setSummary(null) }
    setSummaryLoading(false)
  }, [speak, stopTTS])

  // ── USER SPEECH ──
  const handleSpeech = useCallback(async (text: string) => {
    if (!text.trim()) { setTurn('listening'); return }
    const lower = text.toLowerCase().trim().replace(/[.,!?]$/, '')

    if (lower === 'end session' || lower === 'end' || lower === 'stop') {
      goHome(); return
    }
    if (lower === 'review' || lower.includes('review session')) {
      doReview(); return
    }

    const userMsg: Msg = { role: 'user', content: text }
    const updated = [...msgsRef.current, userMsg]
    msgsRef.current = updated
    txRef.current = [...txRef.current, { speaker: 'you', text }]
    setTranscript([...txRef.current])
    setInterim('')
    setTurn('thinking')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chat', messages: updated, seed: seedRef.current }),
      })
      const { text: reply } = await res.json()
      const aiMsg: Msg = { role: 'assistant', content: reply }
      msgsRef.current = [...updated, aiMsg]
      txRef.current = [...txRef.current, { speaker: 'prospect', text: reply }]
      setTranscript([...txRef.current])
      setTurn('speaking')
      pauseSTTRef.current()
      unlockAudio()
      await speak(reply, () => {
        setTimeout(() => { setTurn('listening'); resumeSTTRef.current() }, 400)
      })
    } catch {
      setTurn('listening')
      setTimeout(() => resumeSTTRef.current(), 400)
    }
  }, [speak, goHome, doReview])

  // ── DEEPGRAM ──
  const { start: startSTT, stop: stopSTT, pause: pauseSTT, resume: resumeSTT } = useDeepgram({
    onTranscript: useCallback((text: string) => { if (turnRef.current === 'listening') setInterim(text) }, []),
    onUtteranceEnd: useCallback((text: string) => { if (turnRef.current === 'listening') handleSpeech(text) }, [handleSpeech]),
    onError: useCallback((err: string) => { console.error(err); setTurn('listening') }, []),
  })

  // Wire STT refs — always current
  stopSTTRef.current = stopSTT
  pauseSTTRef.current = pauseSTT
  resumeSTTRef.current = resumeSTT
  startSTTRef.current = startSTT

  // ── AUTOSTART ──
  useEffect(() => {
    if (!autostart) return
    setScreen('countdown')
    setCountdown(3)
    let count = 3
    cdRef.current = setInterval(() => {
      count -= 1
      setCountdown(count)
      if (count <= 0) {
        if (cdRef.current) clearInterval(cdRef.current)
        unlockAudio()
        startSession()
      }
    }, 1000)
    return () => { if (cdRef.current) clearInterval(cdRef.current) }
  }, [autostart, startSession])

  // ── CLEANUP ──
  useEffect(() => {
    return () => { stopTTS(); stopSTTRef.current(); if (timerRef.current) clearInterval(timerRef.current) }
  }, [stopTTS])

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // ─────────────── SCREENS ───────────────

  if (screen === 'start') {
    return (
      <div style={s.screen}>
        <div style={s.startInner}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#999', marginBottom: 12, textTransform: 'uppercase' as const }}>Sandler Trainer · {VERSION}</div>
          <h1 style={{ fontSize: 36, fontWeight: 700, color: '#000', letterSpacing: '-0.02em', marginBottom: 6 }}>Stroke + Return</h1>
          <p style={{ fontSize: 15, color: '#666', marginBottom: 36, fontWeight: 400 }}>Fahrenheit One · Sales Training</p>

          <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
            <button onClick={() => { unlockAudio(); startSession() }} style={s.modeCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#000', letterSpacing: '0.04em' }}>YOU ANSWER</div>
                <div style={{ fontSize: 10, color: '#999', background: '#f0f0f0', padding: '2px 8px', borderRadius: 20 }}>Mode 1</div>
              </div>
              <div style={{ fontSize: 13, color: '#555', lineHeight: 1.55 }}>A prospect asks a Fahrenheit One question. You respond with stroke + return. Get coached on your technique.</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#000', marginTop: 12 }}>Start session →</div>
            </button>

            <button onClick={() => { setDemoResult(null); setDemoQ(''); setScreen('demo') }} style={{ ...s.modeCard, background: '#000', borderColor: '#000' }}>
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

  if (screen === 'countdown') {
    return (
      <div style={{ ...s.screen, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#999', marginBottom: 32, textTransform: 'uppercase' as const }}>Sandler Trainer · {VERSION}</div>
        <div style={{ fontSize: 96, fontWeight: 100, color: '#000', lineHeight: 1, marginBottom: 24 }}>{countdown}</div>
        <div style={{ fontSize: 14, color: '#999' }}>Starting session…</div>
      </div>
    )
  }

  if (screen === 'demo') {
    const handleDemo = async () => {
      if (!demoQ.trim()) return
      setDemoLoading(true)
      setDemoResult(null)
      try {
        const res = await fetch('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'demo', question: demoQ }),
        })
        const { result } = await res.json()
        const parsed = JSON.parse(result)
        setDemoResult(parsed)
        setDemoHistory(h => [{ question: demoQ, result: parsed }, ...h.slice(0, 9)])
        speak(parsed.combined, () => {})
      } catch { setDemoResult(null) }
      setDemoLoading(false)
    }

    return (
      <div style={s.screen}>
        <div style={s.header}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#000' }}>Watch & Learn</span>
          <span style={{ fontSize: 11, color: '#ccc' }}>{VERSION}</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' as const, padding: '16px 20px 0' }}>
          <p style={{ fontSize: 13, color: '#999', lineHeight: 1.6, marginBottom: 16 }}>
            Type a prospect question. The AI shows the perfect stroke + answer + return and speaks it aloud.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 16 }}>
            {[
              'How much does a membership cost?',
              'Can I cancel anytime?',
              'What makes you different from other gyms?',
              'Is this a Jewish-only club?',
              'Why join something not opening until 2027?',
              'I already pay for Pilates — why switch?',
            ].map(q => (
              <button key={q} onClick={() => setDemoQ(q)} style={{ fontSize: 11, color: '#555', background: '#f5f5f7', border: 'none', padding: '6px 12px', borderRadius: 20, cursor: 'pointer', textAlign: 'left' as const, lineHeight: 1.4 }}>
                {q}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <input
              value={demoQ}
              onChange={e => setDemoQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !demoLoading && demoQ.trim() && (unlockAudio(), handleDemo())}
              placeholder="Type a prospect question…"
              style={{ flex: 1, padding: '14px 16px', borderRadius: 12, border: '1.5px solid #e0e0e0', fontSize: 14, color: '#000', outline: 'none', background: '#fff' }}
            />
            <button onClick={() => { unlockAudio(); handleDemo() }} disabled={demoLoading || !demoQ.trim()}
              style={{ padding: '14px 20px', background: '#000', color: '#fff', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: demoLoading || !demoQ.trim() ? 0.4 : 1 }}>
              {demoLoading ? '…' : 'Go'}
            </button>
          </div>

          {demoResult && (
            <div style={{ animation: 'fade-in 0.3s ease', marginBottom: 16 }}>
              <div style={{ background: '#f5f5f7', borderRadius: 14, padding: '20px', marginBottom: 12 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#999', marginBottom: 8, textTransform: 'uppercase' as const }}>Prospect said</div>
                <div style={{ fontSize: 14, color: '#333', fontStyle: 'italic', marginBottom: 16 }}>"{demoQ}"</div>

                <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#999', marginBottom: 8, textTransform: 'uppercase' as const }}>Perfect Response</div>
                <div style={{ fontSize: 15, color: '#000', lineHeight: 1.65, fontWeight: 500, marginBottom: 16, padding: '14px', background: '#fff', borderRadius: 10, borderLeft: '3px solid #000' }}>
                  "{demoResult.combined}"
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                  <div style={{ background: '#fff', borderRadius: 10, padding: '12px' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: '#000', marginBottom: 6 }}>① STROKE</div>
                    <div style={{ fontSize: 12, color: '#333', lineHeight: 1.5, marginBottom: 6, fontStyle: 'italic' }}>"{demoResult.stroke}"</div>
                    <div style={{ fontSize: 11, color: '#888', lineHeight: 1.4 }}>{demoResult.why_stroke}</div>
                  </div>
                  {demoResult.info && (
                    <div style={{ background: '#fff', borderRadius: 10, padding: '12px' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: '#555', marginBottom: 6 }}>② ANSWER</div>
                      <div style={{ fontSize: 12, color: '#333', lineHeight: 1.5, fontStyle: 'italic' }}>"{demoResult.info}"</div>
                    </div>
                  )}
                  <div style={{ background: '#fff', borderRadius: 10, padding: '12px' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: '#000', marginBottom: 6 }}>③ RETURN</div>
                    <div style={{ fontSize: 12, color: '#333', lineHeight: 1.5, marginBottom: 6, fontStyle: 'italic' }}>"{demoResult.return}"</div>
                    <div style={{ fontSize: 11, color: '#888', lineHeight: 1.4 }}>{demoResult.why_return}</div>
                  </div>
                  <div style={{ background: '#fff', borderRadius: 10, padding: '12px' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: '#000', marginBottom: 6 }}>LISTEN FOR</div>
                    <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>{demoResult.what_to_listen_for}</div>
                  </div>
                </div>
              </div>
              <button onClick={() => { unlockAudio(); speak(demoResult!.combined, () => {}) }} style={{ ...s.secondaryBtn, width: '100%', marginBottom: 8 }}>
                ▶ Play Again
              </button>
            </div>
          )}

          {demoHistory.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: '0.15em', color: '#ccc', marginBottom: 10, textTransform: 'uppercase' as const }}>Previous</div>
              {demoHistory.slice(1).map((h, i) => (
                <button key={i} onClick={() => { unlockAudio(); setDemoQ(h.question); setDemoResult(h.result); speak(h.result.combined, () => {}) }}
                  style={{ width: '100%', textAlign: 'left' as const, background: '#f5f5f7', border: 'none', borderRadius: 10, padding: '12px', marginBottom: 8, cursor: 'pointer' }}>
                  <div style={{ fontSize: 12, color: '#333', lineHeight: 1.4 }}>"{h.question}"</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{h.result.stroke.substring(0, 50)}…</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px 24px', borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
          <button onClick={goHome} style={{ ...s.primaryBtn, width: '100%' }}>← Home</button>
        </div>
      </div>
    )
  }

  if (screen === 'summary') {
    return (
      <div style={s.screen}>
        <div style={{ padding: '52px 20px 0', flex: 1, overflowY: 'auto' as const }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', color: '#999', marginBottom: 8, textTransform: 'uppercase' as const }}>Session Debrief · {VERSION}</div>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: '#000', letterSpacing: '-0.01em', marginBottom: 24 }}>Your Coaching</h2>

          {summaryLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '40px 0' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#000', animation: 'blink 0.9s ease-in-out infinite' }} />
              <span style={{ color: '#999', fontSize: 14 }}>Analysing your session…</span>
            </div>
          ) : summary ? (
            <>
              <div style={{ fontSize: 15, color: '#333', lineHeight: 1.7, marginBottom: 32, padding: '16px 18px', background: '#f5f5f7', borderRadius: 12 }}>
                {summary.overall_assessment}
              </div>

              <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#999', marginBottom: 16, textTransform: 'uppercase' as const }}>3 Alternative Approaches</div>

              {(summary.alternatives || []).slice(0, 3).map((alt, i) => (
                <div key={i} style={s.altCard}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#000', letterSpacing: '0.05em', marginBottom: 12 }}>ALTERNATIVE {i + 1}</div>
                  <div style={s.altRow}><span style={s.altLabel}>Prospect</span><span style={s.altVal}>"{alt.prospect_line}"</span></div>
                  <div style={s.altRow}><span style={s.altLabel}>You said</span><span style={{ ...s.altVal, color: '#999' }}>"{alt.salesperson_said}"</span></div>
                  <div style={{ borderTop: '1px solid #e5e5e5', margin: '10px 0' }} />
                  <div style={s.altRow}><span style={{ ...s.altLabel, fontWeight: 600, color: '#000' }}>Stroke</span><span style={{ ...s.altVal, color: '#000' }}>"{alt.stroke}"</span></div>
                  <div style={s.altRow}><span style={{ ...s.altLabel, fontWeight: 600, color: '#000' }}>Return</span><span style={{ ...s.altVal, color: '#000' }}>"{alt.return}"</span></div>
                  <div style={{ fontSize: 13, color: '#666', marginTop: 8, lineHeight: 1.5 }}>{alt.why}</div>
                </div>
              ))}

              <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#999', marginTop: 28, marginBottom: 12, textTransform: 'uppercase' as const }}>Transcript</div>
              {txRef.current.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingBottom: 10, borderBottom: '1px solid #f0f0f0', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, minWidth: 32, color: t.speaker === 'you' ? '#000' : '#bbb', textTransform: 'uppercase' as const, fontWeight: 600, paddingTop: 2 }}>
                    {t.speaker === 'you' ? 'YOU' : 'PRO'}
                  </span>
                  <span style={{ fontSize: 13, color: t.speaker === 'you' ? '#000' : '#777', lineHeight: 1.5 }}>{t.text}</span>
                </div>
              ))}
              <div style={{ height: 24 }} />
            </>
          ) : (
            <div style={{ color: '#999', fontSize: 14 }}>Session too short to analyse.</div>
          )}
        </div>

        <div style={{ padding: '16px 20px 28px', borderTop: '1px solid #f0f0f0' }}>
          <button onClick={goHome} style={{ ...s.primaryBtn, width: '100%' }}>← Home</button>
        </div>
      </div>
    )
  }

  // ── SESSION ──
  const isListening = turn === 'listening'
  const isSpeaking = turn === 'speaking'
  const isThinking = turn === 'thinking'
  const orbColor = isListening ? '#000' : isSpeaking ? '#333' : '#888'
  const orbAnim = isThinking ? 'breathe 1.5s ease-in-out infinite' : isSpeaking ? 'speak-anim 0.6s ease-in-out infinite' : 'none'

  return (
    <div style={s.screen}>
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#000' }}>Sandler</span>
          <span style={{ fontSize: 13, color: '#bbb' }}>{fmt(duration)}</span>
        </div>
        <span style={{ fontSize: 11, color: '#ddd' }}>{VERSION}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 14, padding: '28px 0 16px', flexShrink: 0 }}>
        <div style={{ position: 'relative' as const, width: 140, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {[108, 128].map((size, i) => (
            <div key={i} style={{ position: 'absolute' as const, width: size, height: size, borderRadius: '50%', border: '1px solid #000', opacity: isListening ? (i === 0 ? 0.12 : 0.06) : 0, animation: isListening ? `pulse-ring 1.4s ease-in-out ${i * 0.2}s infinite` : 'none', transition: 'opacity 0.4s' }} />
          ))}
          <div style={{ width: 70, height: 70, borderRadius: '50%', background: orbColor, boxShadow: isListening ? '0 0 24px rgba(0,0,0,0.12)' : 'none', animation: orbAnim, transition: 'background 0.4s, box-shadow 0.4s' }} />
        </div>

        <div style={{ fontSize: 14, color: '#999' }}>
          {turn === 'prospect' ? 'Preparing…' : isSpeaking ? 'Prospect speaking…' : isThinking ? 'Thinking…' : turn === 'ending' ? 'Ending…' : 'Your turn'}
        </div>

        {isListening && interim && (
          <div style={{ maxWidth: 300, textAlign: 'center' as const, fontSize: 14, color: '#666', fontStyle: 'italic', background: '#f5f5f7', padding: '10px 16px', borderRadius: 10, lineHeight: 1.5 }}>
            {interim}
          </div>
        )}
      </div>

      {isListening && (
        <div style={{ margin: '0 20px 12px', padding: '12px 16px', background: '#f5f5f7', borderRadius: 10, fontSize: 13, color: '#555', lineHeight: 1.6, flexShrink: 0 }}>
          <strong style={{ color: '#000' }}>Stroke</strong> — acknowledge warmly &nbsp;·&nbsp; <strong style={{ color: '#000' }}>Answer</strong> — give real info &nbsp;·&nbsp; <strong style={{ color: '#000' }}>Return</strong> — ask a curious question
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' as const, padding: '0 20px', display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
        {transcript.slice(-8).map((t, i, arr) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingBottom: 10, borderBottom: '1px solid #f5f5f5', opacity: arr.length > 4 && i < 2 ? 0.4 : 1, animation: i === arr.length - 1 ? 'fade-in 0.3s ease' : 'none' }}>
            <span style={{ fontSize: 10, minWidth: 28, color: t.speaker === 'you' ? '#000' : '#bbb', textTransform: 'uppercase' as const, fontWeight: 600, paddingTop: 3 }}>
              {t.speaker === 'you' ? 'YOU' : 'PRO'}
            </span>
            <span style={{ fontSize: 14, lineHeight: 1.55, color: t.speaker === 'you' ? '#000' : '#888' }}>{t.text}</span>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 20px 24px', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={goHome} disabled={turn === 'ending'} style={{ ...s.secondaryBtn, opacity: turn === 'ending' ? 0.4 : 1 }}>End Session</button>
          <button onClick={doReview} disabled={turn === 'ending'} style={{ ...s.primaryBtn, opacity: turn === 'ending' ? 0.4 : 1 }}>Review</button>
        </div>
        <p style={{ textAlign: 'center' as const, fontSize: 11, color: '#ccc', letterSpacing: '0.02em' }}>
          {transcript.length} exchanges · say "end session" or "review"
        </p>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  screen: { height: '100dvh', background: '#fff', display: 'flex', flexDirection: 'column', paddingBottom: 'env(safe-area-inset-bottom)' },
  startInner: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 24px' },
  modeCard: { width: '100%', textAlign: 'left' as const, padding: '20px', background: '#fff', border: '1.5px solid #e8e8e8', borderRadius: 16, cursor: 'pointer', transition: 'all 0.15s ease' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '52px 20px 16px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 },
  primaryBtn: { flex: 1, padding: '16px', background: '#000', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 600, color: '#fff', cursor: 'pointer', transition: 'opacity 0.2s', letterSpacing: '-0.01em' },
  secondaryBtn: { flex: 1, padding: '16px', background: '#f5f5f7', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 600, color: '#000', cursor: 'pointer', transition: 'opacity 0.2s', letterSpacing: '-0.01em' },
  altCard: { background: '#f5f5f7', borderRadius: 12, padding: '16px', marginBottom: 12 },
  altRow: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 },
  altLabel: { fontSize: 11, color: '#999', minWidth: 56, paddingTop: 2, fontWeight: 500 },
  altVal: { fontSize: 13, color: '#333', lineHeight: 1.5, flex: 1 },
  infoBlock: { display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 40, width: '100%', maxWidth: 360 },
  infoRow: { display: 'flex', gap: 14, alignItems: 'flex-start' },
  infoNum: { width: 24, height: 24, borderRadius: '50%', background: '#000', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
}
