import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const response = await fetch('https://api.deepgram.com/v1/keys', {
      method: 'POST',
      headers: { 'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'sandler-session', scopes: ['usage:write'], time_to_live_in_seconds: 3600 }),
    })
    if (!response.ok) return res.status(200).json({ key: process.env.DEEPGRAM_API_KEY })
    const data = await response.json()
    res.status(200).json({ key: data.key?.key || process.env.DEEPGRAM_API_KEY })
  } catch {
    res.status(200).json({ key: process.env.DEEPGRAM_API_KEY })
  }
}
