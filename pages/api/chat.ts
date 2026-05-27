import type { NextApiRequest, NextApiResponse } from 'next'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const F1_KNOWLEDGE = `
FAHRENHEIT ONE — KEY FACTS FOR SIMULATION

Location: Hakoah White City campus, Eastern Suburbs Sydney
Opening: April 2027
Hours: 5:30am–10:00pm (not 24/7)
Size: 1,500sqm gym floor
Classes: 191 planned weekly classes
Parking: ~280 spaces, EV charging, extended free or discounted for members

MEMBERSHIP TYPES:
1. Signature (hero membership) — full ecosystem access including:
   - All gym floors (cardio, strength, functional)
   - All group classes (Les Mills, yoga, barre, Pilates)
   - Reformer Pilates studio (included, not extra)
   - Immersive spin studio (30 bikes, LED, stadium layout)
   - eGym (NSW's first installation)
   - MyCoach.ai
   - Swimming pool
   - Pickleball
   - Wellness & recovery areas
   - Run club

2. Base — premium gym + classes, no recovery/wellness/pool/eGym/MyCoach.ai

3. Wellness — daytime only (9am–5pm), wellness/recovery + eGym + yoga/Pilates/barre, no main gym floor

4. Teen — age 14+, Level 3 only (eGym, yoga, Pilates, barre, Les Mills), Mon–Fri 2–5pm + weekends

5. Hakoah One — limited foundational membership, pre-opening period only

PRICING: Premium tier, over $300/month range. Exact pricing not yet published.

KEY DIFFERENTIATORS:
- NSW's first eGym installation
- Reformer Pilates INCLUDED (not a surcharge like competitors)
- 191 weekly classes
- Tribe system (6AM Crew, Lunch Legends, Weekend Warriors etc.)
- Phone-free wellness/recovery areas
- Campus lifestyle (gardens, café, playground, sports, events)
- Not anonymous — staff know members by name
- Technology: eGym + MyCoach.ai for guided progression

HAKOAH RELATIONSHIP:
- Fahrenheit One is independent — separate membership from Hakoah
- Hakoah membership does NOT include Fahrenheit One
- Campus includes swimming, tennis, soccer, hospitality, events
- Open to all backgrounds, strong ties to Sydney Jewish community

WHAT IT IS NOT:
- Not a hardcore/ego lifting gym
- Not a 24/7 anonymous gym
- Not a cheap/budget gym
- Not just a boutique studio
- Not a spa

ATMOSPHERE:
- Level 2: energetic, motivating, cardio/strength
- Level 3: calmer, guided, shoes-off, wellness-oriented
- Recovery: phone-free, restorative
`

const PROSPECT_PERSONAS = [
  {
    name: 'price-focused',
    desc: `You are a price-sensitive prospect in the Eastern Suburbs who has just heard that Fahrenheit One membership is over $300/month. You think that sounds expensive compared to other gyms you've seen. You ask about cost, value, contracts, what's actually included for that price, and whether there are cheaper options. You have a Fitness First membership currently at $80/month and keep comparing.`,
  },
  {
    name: 'feature-curious',
    desc: `You are a 38-year-old professional who does Pilates at a separate studio ($180/month) and goes to a regular gym ($90/month). You're spending $270/month across two memberships and feeling the fragmentation. You're curious whether Fahrenheit One genuinely replaces both. You ask specific questions about the reformer Pilates, class quality, and whether the spin studio is actually good.`,
  },
  {
    name: 'commitment-averse',
    desc: `You are a prospect who had a bad experience being locked into a 12-month gym contract at another gym that closed. You're very hesitant about committing. You ask about cancellation policies, minimum terms, what happens if you travel or get injured, and whether you can try before committing. You open with a question about contracts and flexibility.`,
  },
  {
    name: 'value-seeker',
    desc: `You are a health-conscious professional who already spends a lot on wellness — personal trainer, yoga studio, occasional massage. You want to understand if Fahrenheit One would simplify your life and genuinely consolidate your wellness spending. You're not put off by the price if the value is there. You ask smart questions about what makes it different from a regular premium gym and why the ecosystem matters.`,
  },
  {
    name: 'location-curious',
    desc: `You live in the Eastern Suburbs and are interested but have never heard of Hakoah White City. You ask about the location, parking, what the campus is actually like, whether it's a Jewish-only club, and what the vibe is. You're slightly uncertain about the Hakoah connection and want reassurance it's open and welcoming to everyone.`,
  },
  {
    name: 'opening-sceptic',
    desc: `You heard Fahrenheit One is opening in April 2027 — over a year away. You're sceptical about committing or even engaging seriously with something that far out. You ask whether you can join now, what founding membership means, what happens if it gets delayed, and whether there's any benefit to engaging early.`,
  },
]

function getPersona(seed: string) {
  const index = seed.charCodeAt(0) % PROSPECT_PERSONAS.length
  return PROSPECT_PERSONAS[index]
}

const OPENING_QUESTIONS = [
  "Hi, I heard Fahrenheit One is a new gym opening in the Eastern Suburbs — how much is a membership?",
  "I'm currently paying for a Pilates studio and a regular gym separately. Is Fahrenheit One actually going to replace both?",
  "Look, I've been burned by gym contracts before. Before we go any further — what are your cancellation terms?",
  "I spend a lot on wellness already. What makes Fahrenheit One genuinely different from just a premium gym?",
  "I live nearby but I've never heard of Hakoah White City. Is this place actually open to everyone or is it a private club?",
  "I heard you're not even opening until 2027 — why would I be thinking about this now?",
]

function getOpening(seed: string) {
  const index = seed.charCodeAt(0) % OPENING_QUESTIONS.length
  return OPENING_QUESTIONS[index]
}

const PROSPECT_SYSTEM = (personaDesc: string) => `You are a realistic prospect enquiring about a Fahrenheit One gym membership. You are being used to train a salesperson in the Sandler Selling System.

YOUR PERSONA: ${personaDesc}

FAHRENHEIT ONE FACTS (use these to ask realistic, specific questions):
${F1_KNOWLEDGE}

BEHAVIOUR RULES:
- Stay completely in character as the prospect
- Ask natural, specific follow-up questions about Fahrenheit One
- React authentically — if they give a good Sandler stroke+return, warm up slightly
- If they answer your question directly without a stroke or curious return, press harder or repeat concern
- Keep responses SHORT — 1-3 sentences like a real prospect
- Reference real details (price, location, Hakoah, eGym, 2027 opening, etc.) naturally
- Do NOT break character or reference Sandler
- If the user says "end" or "stop", respond naturally: "Ok, thanks for your time."`

const SUMMARY_SYSTEM = `You are a Sandler Sales Method coach specialising in premium fitness and wellness sales. Analyse this Fahrenheit One membership sales conversation and give feedback on the salesperson's use of Stroke + Return.

A STROKE is a softening compliment before responding (e.g. "Great question", "That's really important", "I completely understand").

A RETURN is a curious question that redirects to the prospect's situation instead of answering directly (e.g. "Why do you ask?", "What's making price the main focus right now?", "Have you had a bad experience with a gym contract before?").

Return ONLY valid JSON — no markdown, no preamble:

{
  "overall_assessment": "<2 sentence summary of how well they used Sandler>",
  "alternatives": [
    {
      "prospect_line": "<what the prospect said>",
      "salesperson_said": "<what the salesperson actually said>",
      "stroke": "<a better stroke they could have used>",
      "return": "<a better return question — specific to Fahrenheit One context>",
      "why": "<1 sentence on why this would have been more effective>"
    },
    { "prospect_line": "", "salesperson_said": "", "stroke": "", "return": "", "why": "" },
    { "prospect_line": "", "salesperson_said": "", "stroke": "", "return": "", "why": "" }
  ]
}`

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const { action, messages, transcript, seed } = req.body as {
    action: 'chat' | 'opening' | 'summary' | 'demo'
    messages?: { role: 'user' | 'assistant'; content: string }[]
    transcript?: string
    seed?: string
  }

  try {
    if (action === 'opening') {
      const s = seed || 'a'
      return res.status(200).json({ text: getOpening(s), persona: getPersona(s).name })
    }

    if (action === 'summary') {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: 'You are a Sandler Sales coach for Fahrenheit One gym. Return ONLY valid JSON — no markdown, no backticks.',
        messages: [{ role: 'user', content: `${SUMMARY_SYSTEM}\n\nTRANSCRIPT:\n${transcript}` }],
      })
      const raw = response.content[0].type === 'text' ? response.content[0].text : '{}'
      return res.status(200).json({ result: raw.replace(/```json|```/g, '').trim() })
    }

    if (action === 'demo') {
      const { question } = req.body as { question: string }
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: `You are a master Sandler Sales trainer demonstrating perfect Stroke + Return technique for Fahrenheit One gym membership sales.

FAHRENHEIT ONE FACTS:
${F1_KNOWLEDGE}

When given a prospect question, respond with ONLY valid JSON — no markdown, no preamble:
{
  "stroke": "<the exact stroke words to say — warm, natural acknowledgment>",
  "return": "<the exact return question to ask — curious, non-defensive, redirects to their situation>",
  "combined": "<stroke + return as one natural flowing sentence the salesperson would say out loud>",
  "why_stroke": "<one sentence on why this stroke works>",
  "why_return": "<one sentence on why this return question is effective>",
  "what_to_listen_for": "<what answer from the prospect would tell you most about their real pain or motivation>"
}`,
        messages: [{ role: 'user', content: `Prospect said: "${question}"` }],
      })
      const raw = response.content[0].type === 'text' ? response.content[0].text : '{}'
      return res.status(200).json({ result: raw.replace(/```json|```/g, '').trim() })
    }


    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: PROSPECT_SYSTEM(getPersona(seed || 'a').desc),
      messages: messages || [],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    res.status(200).json({ text })
  } catch (err) {
    console.error('API error:', err)
    res.status(500).json({ error: 'Internal error' })
  }
}
// Note: demo mode handler is included in the main handler below via action: 'demo'
