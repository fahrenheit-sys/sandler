import Head from 'next/head'
import { useEffect, useState } from 'react'
import SandlerSession from '../components/SandlerSession'
import { unlockAudio } from '../lib/useTTS'

export default function Home() {
  const [autostart, setAutostart] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const isAutostart = params.get('autostart') === 'true'
    setAutostart(isAutostart)
    setReady(true)

    if (isAutostart) {
      // Unlock iOS audio on the first user interaction with the page
      // Siri opening Safari counts as a gesture context on iOS 16+
      // We also attach to the first touch as a fallback
      const unlock = () => {
        unlockAudio()
        document.removeEventListener('touchstart', unlock)
        document.removeEventListener('click', unlock)
      }
      // Try immediately (works if Siri launch counts as gesture)
      try { unlockAudio() } catch {}
      // Also attach to first touch as fallback
      document.addEventListener('touchstart', unlock, { once: true })
      document.addEventListener('click', unlock, { once: true })
    }
  }, [])

  if (!ready) return null

  return (
    <>
      <Head>
        <title>Sandler Trainer — Stroke + Return</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="description" content="Sandler Sales Method trainer. Real-time voice. Gym membership simulation." />
      </Head>
      <SandlerSession autostart={autostart} />
    </>
  )
}
