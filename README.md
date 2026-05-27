# Sandler Trainer — Stroke + Return

Real-time AI sales training based on the Sandler Selling System.

**Stack:** Next.js · Deepgram STT · ElevenLabs TTS · Claude AI

---

## Deploy

### Step 1 — Push to GitHub
Create a new repo called `sandler` on github.com (no README), then:

```bash
cd "/Users/avron/Library/CloudStorage/GoogleDrive-avron@rubaywines.com/My Drive/Projects/Sandler"
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/fahrenheit-sys/sandler.git
git push -u origin main
```

### Step 2 — Deploy to Vercel
Import the `sandler` repo at vercel.com → Deploy.

### Step 3 — Environment Variables
Add these in Vercel → sandler project → Settings → Environment Variables:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | sk-ant-... |
| `DEEPGRAM_API_KEY` | your Deepgram key |
| `ELEVENLABS_API_KEY` | your ElevenLabs key |

Redeploy after adding keys.

---

## How it works

1. Tap **Begin Session** — prospect opens with a random question
2. Respond with a **stroke** (warm acknowledgment) + **return** (curious question back)
3. Fully hands-free — Deepgram detects when you stop speaking
4. Say **"end"** to finish — AI speaks 3 alternative stroke+return examples
5. Review the written breakdown on the summary screen
