import type { NextApiRequest, NextApiResponse } from 'next'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PROSPECT_PERSONAS = [
  { name: 'price-focused', desc: 'You are a price-sensitive prospect shopping around for the cheapest gym. You ask about costs, contracts, hidden fees, and compare everything to cheaper options. You are sceptical about value.' },
  { name: 'feature-curious', desc: 'You are a prospect obsessed with facilities and equipment. You ask detailed questions about what equipment, classes, and amenities are available. You want to know every feature before committing.' },
  { name: 'commitment-averse', desc: 'You are a prospect nervous about long-term contracts. You ask about flexibility, cancellation policies, and trial periods. You have been burned by gym contracts before.' },
  { name: 'value-seeker', desc: 'You are a prospect who wants to understand the full value proposition. You ask about results, success stories, and what makes this gym worth paying for over a cheaper alternative.' },
]

// Pick a random persona per session based on a seed
function getPersona(seed: string) {
  const index = seed.charCodeAt(0) % PROSPECT_PERSONAS.length
  return PROSPECT_PERSONAS[index]
}

const OPENING_QUESTIONS = [
  "Hi, I was looking at joining a gym. How much does a membership cost?",
  "Hey, what kind of equipment do you have here? I want to make sure you've got what I need before I think about joining.",
  "I'm interested in joining but I've been locked into bad contracts before. What are your cancellation terms?",
  "I've seen cheaper gyms around. What makes you worth paying more for?",
]

function getOpening(seed: string) {
  const index = seed.charCodeAt(0) % OPENING_QUESTIONS.length
  return OPENING_QUESTIONS[index]
}

const PROSPECT_SYSTEM = (personaDesc: string) => `You are a realistic gym membership prospect in a sales training simulation. ${personaDesc}

RULES:
- Stay completely in character as the prospect at all times
- Ask natural follow-up questions based on what the salesperson says
- React authentically — if they give a good Sandler stroke+return, warm up slightly
- If they answer your question directly without a proper stroke or curious return question, push back or repeat the concern
- If they give a vague answer, press harder
- Keep responses SHORT — 1-3 sentences, like a real prospect
- Do NOT break character or reference Sandler
- If the user says "end" or "stop", respond naturally as if wrapping up: "Ok, thanks for your time."

You are being used to train a salesperson in the Sandler Selling System. React authentically to how well they use strokes and return questions.`

const SUMMARY_SYSTEM = `You are a Sandler Sales Method coach. Analyse the sales conversation transcript provided and give feedback on the salesperson's use of the Sandler technique of Stroke + Return.

A STROKE is a softening compliment or acknowledgment before responding to a prospect's question/objection (e.g. "Great question", "I completely understand", "That's really important to clarify").

A RETURN is a curious, non-defensive question that redirects back to the prospect's situation or pain instead of answering directly (e.g. "Why do you ask?", "What's making that particularly important to you right now?", "Have you had a bad experience with that before?").

Analyse the transcript and respond with ONLY valid JSON — no markdown, no preamble:

{
  "overall_assessment": "<2 sentence summary of how well they used Sandler>",
  "alternatives": [
    {
      "prospect_line": "<what the prospect said>",
      "salesperson_said": "<what the salesperson actually said>",
      "stroke": "<a better stroke they could have used>",
      "return": "<a better return question they could have used>",
      "why": "<1 sentence on why this would have been more effective>"
    },
    { ... },
    { ... }
  ]
}`

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { action, messages, transcript, seed } = req.body as {
    action: 'chat' | 'opening' | 'summary'
    messages?: { role: 'user' | 'assistant'; content: string }[]
    transcript?: string
    seed?: string
  }

  try {
    if (action === 'opening') {
      const s = seed || 'a'
      const opening = getOpening(s)
      return res.status(200).json({ text: opening, persona: getPersona(s).name })
    }

    if (action === 'summary') {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: 'You are a Sandler Sales coach. Return ONLY valid JSON — no markdown, no backticks.',
        messages: [{ role: 'user', content: `${SUMMARY_SYSTEM}\n\nTRANSCRIPT:\n${transcript}` }],
      })
      const raw = response.content[0].type === 'text' ? response.content[0].text : '{}'
      return res.status(200).json({ result: raw.replace(/```json|```/g, '').trim() })
    }

    // Regular chat
    const s = seed || 'a'
    const persona = getPersona(s)
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: PROSPECT_SYSTEM(persona.desc),
      messages: messages || [],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    res.status(200).json({ text })
  } catch (err) {
    console.error('API error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
}
