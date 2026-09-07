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
| `local-server.js` | Plain Node dev server that runs `api/generate.js` locally — no Vercel CLI or account needed. Used by `npm run dev`. |
| `vercel.json` | Vercel config (sets 60s function timeout). |
| `package.json` | Project metadata + `npm run dev` / `npm run deploy` scripts. |
| `.env.example` | Template for env vars. Copy to `.env.local` for local dev. |
| `.env.local` | Local env vars (gitignored — never commit this). |
| `.gitignore` | Keeps secrets out of git. |

## Setup

### 1. Prerequisites

- **Node.js 20.6+** (uses the built-in `--env-file` flag — check with `node --version`)
- A free **Google Gemini API key**: sign in at https://aistudio.google.com/apikey
  and click **Create API key**.

### 2. Clone and configure

```bash
git clone <this-repo-url>
cd qa_test_case_generator
cp .env.example .env.local
```

Open `.env.local` and paste your key after `GEMINI_API_KEY=`. Leave
`ALLOWED_ORIGINS` blank for local dev.

### 3. Run locally

```bash
npm run dev
```

Open http://localhost:3000. Fill the form and click **Generate** — the local
server reads your key from `.env.local` and proxies requests to Gemini, so
the key never reaches the browser.

No Vercel account or CLI is required for local development.

### 4. (Optional) Deploy to Vercel so others can use a hosted link

Skip this if you only need to run the app locally. Deploying gives you one
shared URL so teammates don't need Node or their own Gemini key.

```bash
npm install -g vercel   # one-time
vercel                  # first time: log in, link the project
vercel --prod           # deploy to production
```

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

## Troubleshooting

**`GEMINI_API_KEY is not configured on the server`**
`.env.local` is missing, empty, or you ran `npm run dev` from the wrong
folder. Confirm `GEMINI_API_KEY=...` is set in `.env.local` in the project
root, then restart `npm run dev` (env vars are only read at server startup).

**`Error: Cannot find flag '--env-file'` or similar Node error on `npm run dev`**
Your Node version is too old. `local-server.js` needs Node 20.6+. Check with
`node --version` and upgrade if needed.

**Edits to `app.js`, `index.html`, or `prompt-template.js` don't show up**
`local-server.js` serves static files fresh from disk on every request, so
edits to those files just need a browser hard-refresh (Cmd/Ctrl+Shift+R) —
no server restart needed. You only need to restart `npm run dev` after
editing `api/generate.js` or `local-server.js` itself, since Node has those
loaded in memory.

**Generation finishes ("Done") but shows "0 test case row(s)" / CSV export says "No table to export yet"**
This means the response text never turned into a real HTML `<table>`. Click
**Show Raw Markdown** to see what Gemini actually returned. Common causes
already handled by the app:
- Gemini wrapping the whole answer in a ` ```markdown ` code fence
- Gemini putting a table row's content across multiple physical lines (each
  cell must be one line in GFM markdown)

If you still hit this after those fixes, the raw markdown will show why —
usually a malformed header/separator row from a custom prompt edit.

**CORS error, or `Access-Control-Allow-Origin: null` in the Network tab**
`ALLOWED_ORIGINS` in `.env.local` (or Vercel env vars) is set but doesn't
include the origin you're loading the page from. Leave it blank for local
dev, or set it to the exact URL you're using (e.g.
`https://your-project.vercel.app`).

**Deployed site works for you but not for others**
Check `ALLOWED_ORIGINS` in Vercel's env vars matches your deployed URL
exactly, and that `GEMINI_API_KEY` is set for both **Production** and
**Preview** environments, then redeploy (`vercel --prod`).
