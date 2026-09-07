# QA Test Case Generator

Web app that generates QA test cases from a spec (spec/PRD, Figma, API doc,
etc.) using **Google Gemini**, then exports the result as CSV.

Deployed as a static site + one Vercel Edge Function that proxies to the
Gemini API. **Your API key lives only on Vercel's server** — the browser
never sees it and end-users never need one.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and form fields. |
| `styles.css` | All visual styling. Edit `:root` variables at the top for theming. |
| `prompt-template.js` | The QA prompt sent to Gemini. **Edit this to tweak columns, coverage requirements, or rules.** |
| `app.js` | Front-end logic: form → API call → markdown render → CSV export. Parses Gemini SSE. |
| `api/generate.js` | **Vercel Edge Function.** Reads `GEMINI_API_KEY` from env, calls Gemini, streams the response back. |
| `vercel.json` | Vercel config (sets 60s function timeout). |
| `package.json` | Project metadata + `npm run deploy` script. Run `vercel dev` directly for local dev. |
| `.env.example` | Template for env vars. Copy to `.env.local` for local dev. |
| `.env.local` | Local env vars (gitignored). |
| `.gitignore` | Keeps secrets out of git. |

## Setup

### 1. Get a Gemini API key

Sign in at https://aistudio.google.com/apikey and click **Create API key**.
It's free with generous quotas.

### 2. Install the Vercel CLI (one-time)

```bash
npm install -g vercel
```

### 3. Add your key locally

Open `.env.local` (already exists) and paste your key after `GEMINI_API_KEY=`.

### 4. Run locally

```bash
cd ~/Documents/workspace/qa_test_case_generator
vercel dev
```

Open the URL it prints (usually http://localhost:3000). Fill the form and
click Generate — the local Edge Function uses your key from `.env.local`.

### 5. Deploy to Vercel (free)

```bash
vercel          # first time: log in, link the project
vercel --prod   # deploy to production
```

**Set the API key in Vercel:**
Go to your project on vercel.com → **Settings → Environment Variables** and
add:

- `GEMINI_API_KEY` = your key (Production + Preview)
- `ALLOWED_ORIGINS` = `https://your-project.vercel.app` (recommended, locks
  the API to your own site)

After adding env vars, redeploy so they take effect: `vercel --prod`.

Your site is live at `https://your-project.vercel.app`.

## Model choices

| Model | Speed | Quality | Cost |
| --- | --- | --- | --- |
| `gemini-2.5-flash` (default) | Fast | High | Cheap |
| `gemini-2.5-pro` | Slower | Highest | Higher |
| `gemini-2.0-flash` | Fastest | Good | Cheapest |

If a model name fails, check https://ai.google.dev/gemini-api/docs/models for
current model IDs.

## How users use it

1. Fill in Feature name (required), Platform, User Roles.
2. Paste any relevant spec / user-flow / Figma / API-spec links.
3. Paste private-doc excerpts into **Extra Context** (Gemini can't open
   Notion, Confluence, Jira, or private Figma pages).
4. Add any must-include scenarios.
5. Click **Generate Test Cases** — the table streams in.
6. Click **Download CSV** to import into TestRail / Zephyr / Excel.

Or click **Show Prompt Only** to copy the assembled prompt into a different
LLM (ChatGPT, Claude, etc.) and paste the response back for rendering.

## Common modifications

### Change the QA prompt / column template
Edit `prompt-template.js`. The whole prompt is one template literal — change
column names, coverage items, rules, or anything else.

### Change colors / fonts
Edit the `:root` CSS variables at the top of `styles.css`.

### Add a new form field
1. Add the input in `index.html`.
2. Add it to `getFormData()` in `app.js`.
3. Reference it in `buildPrompt()` in `prompt-template.js`.

### Change model list
Edit the `<select id="model">` in `index.html`.

### Increase response length
Edit `MAX_OUTPUT_TOKENS` in `api/generate.js` (default 16000).

### Switch back to Anthropic / OpenAI
Rewrite `api/generate.js` to call a different provider, and update the SSE
parser in `app.js` (`streamFromEndpoint`) to match that provider's response
shape. Model dropdown in `index.html` needs matching model IDs.

## Security & cost notes

- Your key never appears in the browser or git — only in Vercel env vars
  and your local `.env.local` (which is gitignored).
- **Anyone who can reach the deployed URL can burn your quota.** To limit
  abuse:
  - Set `ALLOWED_ORIGINS` so only your site can call `/api/generate`.
  - Deploy to a private URL and share only within your team.
  - Add Vercel's password protection (Pro plan).
  - Add basic rate limiting inside `api/generate.js` (per-IP counter via
    Vercel KV or Upstash).
- Gemini free tier has generous quotas but with per-minute rate limits —
  check your usage at https://aistudio.google.com/.

## Gemini-specific notes

- Gemini's safety filters can block outputs about security testing (SQL
  injection, IDOR, etc.). The Edge Function sets all four safety categories
  to `BLOCK_ONLY_HIGH` to allow these test-case scenarios. If cases still get
  blocked, remove the security coverage item from `prompt-template.js` or
  further loosen the settings in `api/generate.js`.
- The Vercel Edge Function has a 60-second timeout. If Gemini takes longer
  the stream cuts off — switch to `gemini-2.5-flash` or shorter prompts.

## Known limits

- Gemini cannot open private URLs (Notion, Confluence, Figma drafts,
  internal Jira). Paste content into **Extra Context**.
- Very long outputs may hit the `max_tokens` cap. Either raise the cap or
  generate cases in chunks (one scenario at a time).
