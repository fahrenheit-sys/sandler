import Head from 'next/head'
import { useEffect, useState } from 'react'
import SandlerSession from '../components/SandlerSession'

export default function Home() {
  const [autostart, setAutostart] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Read autostart from URL directly — more reliable than useRouter on mobile
    const params = new URLSearchParams(window.location.search)
    setAutostart(params.get('autostart') === 'true')
    setReady(true)
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
