import type { NextApiRequest, NextApiResponse } from 'next'

export const config = { api: { responseLimit: false } }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { text } = req.body as { text: string }
  if (!text) return res.status(400).json({ error: 'Missing text' })

  const voiceId = process.env.ELEVENLABS_VOICE_PROSPECT || '21m00Tcm4TlvDq8ikWAM'

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY!, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true },
      }),
    })
    if (!response.ok) return res.status(500).json({ error: 'TTS failed' })
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Transfer-Encoding', 'chunked')
    res.setHeader('Cache-Control', 'no-cache')
    const reader = response.body!.getReader()
    const pump = async () => {
      const { done, value } = await reader.read()
      if (done) { res.end(); return }
      res.write(Buffer.from(value))
      await pump()
    }
    await pump()
  } catch (err) {
    console.error('TTS error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
}
