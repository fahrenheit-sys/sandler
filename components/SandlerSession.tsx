import { useState, useRef, useEffect, useCallback } from 'react'
import { useDeepgram } from '../lib/useDeepgram'
import { useTTS } from '../lib/useTTS'

type SessionState = 'start' | 'session' | 'summary'
type TurnState = 'prospect' | 'listening' | 'thinking' | 'speaking' | 'ending'

interface Message { role: 'user' | 'assistant'; content: string }
interface TranscriptLine { speaker: 'prospect' | 'you'; text: string }

interface Alternative {
  prospect_line: string
  salesperson_said: string
  stroke: string
  return: string
  why: string
}

interface SummaryData {
  overall_assessment: string
  alternatives: Alternative[]
}

const ACCENT = '#c9a84c'
const ACCENT_DIM = '#c9a84c33'

export default function SandlerSession() {
  const [screen, setScreen] = useState<SessionState>('start')
  const [turnState, setTurnState] = useState<TurnState>('prospect')
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [interimText, setInterimText] = useState('')
  const [statusText, setStatusText] = useState('')
  const [duration, setDuration] = useState(0)
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [persona, setPersona] = useState('')
  const [started, setStarted] = useState(false)

  const messagesRef = useRef<Message[]>([])
  const transcriptRef = useRef<TranscriptLine[]>([])
  const turnStateRef = useRef<TurnState>('prospect')
  const seedRef = useRef(String.fromCharCode(65 + Math.floor(Math.random() * 26)))
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { speak, stop: stopTTS } = useTTS()

  const setTurn = (t: TurnState) => {
    turnStateRef.current = t
    setTurnState(t)
  }

  // Handle user speech — check for "end" keyword
  const handleUserSpeech = useCallback(async (text: string) => {
    if (!text.trim()) { setTurn('listening'); return }

    // Detect end command
    const lower = text.toLowerCase().trim()
    if (lower.includes('end') || lower.includes('stop') || lower === 'end.' || lower === 'stop.') {
      setTurn('ending')
      setStatusText('Wrapping up…')
      stopTTS()

      // Get a brief closing line from prospect then summarise
      const closingRes = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chat', seed: seedRef.current, messages: [...messagesRef.current, { role: 'user', content: 'end' }] }),
      })
      const { text: closing } = await closingRes.json()

      await speak(closing, async () => {
        setStatusText('Analysing your session…')
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

          // Speak the overall assessment
          if (parsed.overall_assessment) {
            await speak(`Here's your coaching summary. ${parsed.overall_assessment} Let me walk you through three alternative approaches you could have used.`, () => {
              // Speak each alternative
              const speakAlternatives = async (index: number) => {
                if (index >= parsed.alternatives.length) return
                const alt = parsed.alternatives[index]
                const text = `Alternative ${index + 1}. When the prospect said: "${alt.prospect_line}" — a stronger stroke would have been: "${alt.stroke}" — followed by the return: "${alt.return}". ${alt.why}`
                await speak(text, () => speakAlternatives(index + 1))
              }
              speakAlternatives(0)
            })
          }
        } catch {
          setSummary(null)
        }
        setSummaryLoading(false)
      })
      return
    }

    // Normal turn — add to transcript and send to AI
    const userMsg: Message = { role: 'user', content: text }
    const updated = [...messagesRef.current, userMsg]
    messagesRef.current = updated
    transcriptRef.current = [...transcriptRef.current, { speaker: 'you', text }]
    setTranscript([...transcriptRef.current])
    setInterimText('')

    setTurn('thinking')
    setStatusText('Prospect thinking…')

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
      setStatusText('Prospect speaking…')

      // Pause mic while prospect speaks so we don't pick up TTS
      pauseSTT()

      await speak(reply, () => {
        setTurn('listening')
        setStatusText('Your turn — speak naturally')
        resumeSTT()
      })
    } catch {
      setTurn('listening')
      setStatusText('Error — speak again')
      resumeSTT()
    }
  }, [speak, stopTTS])

  const handleTranscript = useCallback((text: string, _isFinal: boolean) => {
    if (turnStateRef.current === 'listening') setInterimText(text)
  }, [])

  const handleUtteranceEnd = useCallback((text: string) => {
    if (turnStateRef.current !== 'listening') return
    handleUserSpeech(text)
  }, [handleUserSpeech])

  const handleSTTError = useCallback((err: string) => {
    setStatusText(err)
    setTurn('listening')
  }, [])

  const { start: startSTT, stop: stopSTT, pause: pauseSTT, resume: resumeSTT } = useDeepgram({
    onTranscript: handleTranscript,
    onUtteranceEnd: handleUtteranceEnd,
    onError: handleSTTError,
  })

  const startSession = useCallback(async () => {
    setStarted(true)
    setScreen('session')
    setDuration(0)

    // Get opening question
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'opening', seed: seedRef.current }),
    })
    const { text: opening, persona: p } = await res.json()
    setPersona(p)

    messagesRef.current = [{ role: 'assistant', content: opening }]
    transcriptRef.current = [{ speaker: 'prospect', text: opening }]
    setTranscript([{ speaker: 'prospect', text: opening }])

    setTurn('speaking')
    setStatusText('Prospect speaking…')

    await speak(opening, async () => {
      // Start always-on listening
      await startSTT()
      setTurn('listening')
      setStatusText('Your turn — speak naturally')
    })

    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
  }, [speak, startSTT])

  useEffect(() => {
    return () => {
      stopTTS()
      stopSTT()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // ── START SCREEN ──
  if (screen === 'start') {
    return (
      <div style={s.screen}>
        <div style={s.startInner}>
          <div style={{ fontSize: 11, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)', marginBottom: 16 }}>◈ SANDLER</div>
          <h1 style={{ fontSize: 36, fontWeight: 200, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.9)', marginBottom: 8 }}>STROKE + RETURN</h1>
          <p style={{ fontSize: 11, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.25)', marginBottom: 48, textTransform: 'uppercase' }}>Sandler Sales Trainer · Gym Membership</p>

          <div style={s.infoBlock}>
            <div style={s.infoRow}>
              <span style={{ color: ACCENT }}>◆</span>
              <span>A random prospect will open with a question about price, features, or commitment</span>
            </div>
            <div style={s.infoRow}>
              <span style={{ color: ACCENT }}>◆</span>
              <span>Respond with a <strong style={{ color: 'rgba(255,255,255,0.8)' }}>stroke</strong> then a <strong style={{ color: 'rgba(255,255,255,0.8)' }}>return question</strong></span>
            </div>
            <div style={s.infoRow}>
              <span style={{ color: ACCENT }}>◆</span>
              <span>Fully hands-free once started — just speak naturally</span>
            </div>
            <div style={s.infoRow}>
              <span style={{ color: ACCENT }}>◆</span>
              <span>Say <strong style={{ color: 'rgba(255,255,255,0.8)' }}>"end"</strong> to finish — you'll get verbal coaching on 3 better alternatives</span>
            </div>
          </div>

          <button onClick={startSession} style={s.startBtn}>
            Begin Session →
          </button>
        </div>
      </div>
    )
  }

  // ── SUMMARY SCREEN ──
  if (screen === 'summary') {
    return (
      <div style={s.screen}>
        <div style={{ padding: '32px 20px', flex: 1, overflowY: 'auto' as const }}>
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: ACCENT, marginBottom: 24 }}>◈ SANDLER · SESSION DEBRIEF</div>

          {summaryLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '40px 0' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: ACCENT, animation: 'blink 0.9s ease-in-out infinite' }} />
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Analysing your Sandler technique…</span>
            </div>
          ) : summary ? (
            <>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.7, marginBottom: 32, padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: `2px solid ${ACCENT}` }}>
                {summary.overall_assessment}
              </div>

              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.2)', marginBottom: 16 }}>3 ALTERNATIVE APPROACHES</div>

              {(summary.alternatives || []).slice(0, 3).map((alt, i) => (
                <div key={i} style={s.altCard}>
                  <div style={{ fontSize: 9, color: ACCENT, letterSpacing: '0.15em', marginBottom: 10 }}>ALTERNATIVE {i + 1}</div>

                  <div style={s.altRow}>
                    <span style={s.altLabel}>PROSPECT</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>"{alt.prospect_line}"</span>
                  </div>
                  <div style={s.altRow}>
                    <span style={s.altLabel}>YOU SAID</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>"{alt.salesperson_said}"</span>
                  </div>
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '10px 0' }} />
                  <div style={s.altRow}>
                    <span style={{ ...s.altLabel, color: '#00d4aa' }}>STROKE</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>"{alt.stroke}"</span>
                  </div>
                  <div style={s.altRow}>
                    <span style={{ ...s.altLabel, color: '#00d4aa' }}>RETURN</span>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>"{alt.return}"</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 8, lineHeight: 1.5 }}>{alt.why}</div>
                </div>
              ))}

              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.2)', marginTop: 24, marginBottom: 12 }}>TRANSCRIPT</div>
              {transcriptRef.current.map((t, i) => (
                <div key={i} style={s.txLine}>
                  <span style={{ fontSize: 9, minWidth: 28, color: t.speaker === 'you' ? ACCENT : 'rgba(255,255,255,0.25)', textTransform: 'uppercase' as const }}>
                    {t.speaker === 'you' ? 'YOU' : 'PRO'}
                  </span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{t.text}</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Session too short to analyse.</div>
          )}
        </div>

        <div style={{ padding: '16px 20px 24px' }}>
          <button onClick={() => { stopTTS(); setScreen('start'); setTranscript([]); setSummary(null); setStarted(false); seedRef.current = String.fromCharCode(65 + Math.floor(Math.random() * 26)) }}
            style={{ ...s.startBtn, fontSize: 11 }}>
            New Session →
          </button>
        </div>
      </div>
    )
  }

  // ── SESSION SCREEN ──
  const orbAnim = turnState === 'thinking' ? 'breathe 1.5s ease-in-out infinite'
    : turnState === 'speaking' ? 'speak-anim 0.6s ease-in-out infinite'
    : 'none'

  const ringOpacity = turnState === 'listening' ? 0.5 : 0

  return (
    <div style={s.screen}>
      {/* Header */}
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.15em', color: ACCENT, padding: '4px 10px', border: `1px solid ${ACCENT}44`, borderRadius: 4, background: `${ACCENT}11` }}>
            ◈ SANDLER
          </div>
          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, fontFamily: 'monospace' }}>{fmt(duration)}</span>
        </div>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.15)', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>
          Say "end" to finish
        </span>
      </div>

      {/* Orb */}
      <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 14, padding: '28px 0 18px', flexShrink: 0 }}>
        <div style={{ position: 'relative' as const, width: 140, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {[110, 128].map((size, i) => (
            <div key={i} style={{ position: 'absolute' as const, width: size, height: size, borderRadius: '50%', border: `1px solid ${ACCENT}`, opacity: ringOpacity * (i === 0 ? 1 : 0.5), animation: ringOpacity > 0 ? `pulse-ring 1.2s ease-in-out ${i * 0.2}s infinite` : 'none', transition: 'opacity 0.4s' }} />
          ))}
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: `radial-gradient(circle at 35% 35%, ${ACCENT}, #5a3800)`, boxShadow: `0 0 ${turnState === 'idle' ? 15 : 35}px ${ACCENT}${turnState === 'listening' ? '55' : '33'}`, animation: orbAnim, transition: 'box-shadow 0.4s' }} />
        </div>

        <div style={{ fontSize: 11, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' as const }}>
          {turnState === 'prospect' ? 'Preparing…'
            : turnState === 'speaking' ? 'Prospect speaking…'
            : turnState === 'thinking' ? 'Prospect thinking…'
            : turnState === 'ending' ? 'Ending session…'
            : 'Your turn'}
        </div>

        {turnState === 'listening' && interimText && (
          <div style={{ maxWidth: 280, textAlign: 'center' as const, fontSize: 13, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic', background: 'rgba(255,255,255,0.04)', padding: '8px 14px', borderRadius: 8, lineHeight: 1.5 }}>
            {interimText}
          </div>
        )}
      </div>

      {/* Sandler hint */}
      {turnState === 'listening' && (
        <div style={{ margin: '0 20px 12px', padding: '10px 14px', background: `${ACCENT}0a`, border: `1px solid ${ACCENT}22`, borderRadius: 8, fontSize: 11, color: `${ACCENT}cc`, lineHeight: 1.6, flexShrink: 0 }}>
          <strong>Stroke</strong> → acknowledge their question warmly &nbsp;·&nbsp; <strong>Return</strong> → ask a curious question back
        </div>
      )}

      {/* Transcript */}
      <div style={{ flex: 1, overflowY: 'auto' as const, padding: '0 20px', display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
        {transcript.slice(-8).map((t, i, arr) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: arr.length > 4 && i < 2 ? 0.3 : 1, animation: i === arr.length - 1 ? 'fade-in 0.3s ease' : 'none' }}>
            <span style={{ fontSize: 9, letterSpacing: '0.1em', minWidth: 28, color: t.speaker === 'you' ? ACCENT : 'rgba(255,255,255,0.25)', textTransform: 'uppercase' as const, paddingTop: 2 }}>
              {t.speaker === 'you' ? 'YOU' : 'PRO'}
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.55, color: t.speaker === 'you' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)' }}>
              {t.text}
            </span>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 20px 20px', flexShrink: 0 }}>
        <p style={{ textAlign: 'center' as const, fontSize: 10, color: 'rgba(255,255,255,0.12)', letterSpacing: '0.06em' }}>
          {transcript.length} exchanges · always listening · say "end" to finish
        </p>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  screen: { height: '100dvh', background: '#0a0a0a', display: 'flex', flexDirection: 'column', paddingBottom: 'env(safe-area-inset-bottom)' },
  startInner: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 28px', textAlign: 'center' },
  infoBlock: { display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 40, textAlign: 'left', width: '100%', maxWidth: 340 },
  infoRow: { display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.55 },
  startBtn: { width: '100%', maxWidth: 320, padding: '16px', background: 'transparent', border: `1px solid ${ACCENT}55`, color: ACCENT, borderRadius: 10, fontSize: 13, letterSpacing: '0.15em', cursor: 'pointer', transition: 'all 0.2s' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 },
  altCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px', marginBottom: 12 },
  altRow: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 },
  altLabel: { fontSize: 8, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.2)', minWidth: 52, paddingTop: 2, textTransform: 'uppercase' as const },
  txLine: { display: 'flex', gap: 10, alignItems: 'flex-start', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.04)', marginBottom: 2 },
}
