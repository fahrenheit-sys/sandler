import Head from 'next/head'
import SandlerSession from '../components/SandlerSession'

export default function Home() {
  return (
    <>
      <Head>
        <title>Sandler Trainer — Stroke + Return</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="description" content="Sandler Sales Method trainer. Real-time voice. Gym membership simulation." />
      </Head>
      <SandlerSession />
    </>
  )
}
