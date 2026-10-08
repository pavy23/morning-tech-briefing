# Morning Tech Briefing 📡

**English** · [한국어](README.ko.md)

Every morning **before 09:00 KST** this project collects the day's top global news in AI · XR · space · robotics and emails ten of them as an HTML briefing with a card layout.

- ⏰ Runs on a **GitHub Actions** cron, so your machine can stay off. Four schedules between 05:23 and 08:23 KST; the first run to start sends and the rest exit
- 🤖 **Claude Sonnet 5.5 with web search** collects up to 20 candidate stories, and each article address is checked against the search results (falls back to **Gemini 3.6 Flash** automatically when Claude fails)
- 🧪 **TypeSafe (Jev) judgments** drop repeats from earlier days, same-day duplicates, generic commentary and off-topic items, then keep 10 (optional, about $0.01 a day)
- 📧 **Resend** delivers the HTML email (free tier: 3,000 a month)
- 🎨 The same card design as the web app
- 💸 **API cost shown automatically**: the email footer and the Actions run summary show this run, month to date and a monthly run rate, with a warning above a threshold (default $50). Expect about $25–35 a month with Sonnet 5.5

The prompts and the email copy are in Korean. See [Changing the topics](#-changing-the-topics--briefingconfigjson) for how to adapt them.

---

## 🚀 Setup (about 15 minutes)

Follow the steps in order. With **Claude Code** you can automate steps 3 to 6 (see the end of this document).

### Step 1 · Get the API keys

**① Anthropic (Claude) API key** — news collection (paid, needs credits)
1. Sign in at https://platform.claude.com
2. (recommended) Under **Settings → Workspaces**, create a workspace for this briefing and set a **monthly spend limit**. The Default workspace cannot have limits
3. Under **Settings → API keys → Create key**, create a key scoped to that workspace (`sk-ant-...`). A personal key that is not scoped to a workspace needs a workspace ID on every request (`ANTHROPIC_WORKSPACE_ID` in step 3)

**② Gemini API key** (optional, recommended) — backup when Claude fails
1. Open https://aistudio.google.com/apikey and sign in with a Google account
2. Click "Create API Key" and copy it (`AIzaSy...`)
3. The backup model `gemini-3.6-flash` needs the **paid tier** (billing enabled). The free tier of the key used here had zero quota for every 3.x model

**③ Resend API key** (email delivery)
1. Sign up at https://resend.com (GitHub login works)
2. https://resend.com/api-keys → "Create API Key" → copy it (`re_...`)
3. **Works without a domain**: the sender address `onboarding@resend.dev` is provided
   - In that case you can only send **to the email you signed up with** (`TO_EMAIL` must be your Resend account email)
   - To send elsewhere, verify a domain (optional, see the end of this document)

### Step 2 · Create a GitHub repository

1. Create a new repository at https://github.com/new (for example `morning-tech-briefing`, **private recommended**)
2. Push this folder to it:

```bash
cd morning-tech-briefing
git init
git add .
git commit -m "Initial commit: Morning Tech Briefing Mailer"
git branch -M main
git remote add origin https://github.com/<your-account>/morning-tech-briefing.git
git push -u origin main
```

### Step 3 · Register GitHub Secrets

In the repository: **Settings → Secrets and variables → Actions → "New repository secret"**

`ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `TO_EMAIL` and `FROM_EMAIL` are required; the rest are optional:

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (step 1 ①) |
| `GEMINI_API_KEY` | (optional, recommended) `AIzaSy...` (step 1 ②). Without it, a day when Claude fails has no backup |
| `RESEND_API_KEY` | `re_...` (step 1 ③) |
| `TO_EMAIL` | Recipient address (required; the code has no default) |
| `FROM_EMAIL` | `Morning Tech Briefing <onboarding@resend.dev>` |
| `TYPESAFE_API_KEY` | (optional) `ts_...` from [TypeSafe](https://typesafe.ai). Enables the Jev judgments and selection (see 🧪 below) |
| `READER_PROFILE` | (optional) Reader profile for the relevance score. One line of JSON, e.g. `{"role":"...","strong_interests":["..."],"weak_interests":["..."]}`. It is personal data, so keep it in a Secret. A generic profile is used when absent |

> **Making the repository public does not expose Secrets.** They are not repository files; GitHub stores them
> encrypted, injects them only into workflow runs and masks them as `***` in logs. A public repository does make
> **Actions logs and artifacts (judgment reports) visible to everyone**, so headlines and links become public.
> The recipient address and the reader profile are never in the code; they are read only from Secrets
> (`TO_EMAIL`, `READER_PROFILE`).

> (optional) Values you can set under the **Variables** tab
> - `MODEL` — collection model. Defaults to `claude-sonnet-5-5`. Use `claude-haiku-5-5` to cut cost, or `gemini-3.6-flash` to go back to Gemini
> - `FALLBACK_MODEL` — backup when the primary model fails. Empty means `gemini-3.6-flash` for a Claude primary and `gemini-3.5-flash-lite` for a Gemini primary; setting it equal to `MODEL` disables the fallback
> - `NEWS_EFFORT` (default `medium`), `NEWS_MAX_SEARCHES` (default 25) — Claude's effort level and its web-search cap per run (each search costs $0.01)
> - `NEWS_TOPUP_SEARCHES` (default 10) — search cap of the top-up request that looks for more stories in categories that came up short; 0 disables it
> - `COST_ALERT_USD` (default 50) — warn in the email and in Actions when the monthly run rate exceeds this many USD
> - `ANTHROPIC_WORKSPACE_ID` — only for a personal key that is not scoped to a workspace (`wrkspc_...`)
>
> ⚠️ `gemini-2.5-flash` and `gemini-2.5-flash-lite` are scheduled to shut down on the Gemini API on **2026-10-16** (per Google's deprecation notices; Google names `gemini-3.6-flash` as the replacement for 2.5 Flash). Move `MODEL` to a supported model before then.

### Step 4 · Test run

1. Open the repository's **Actions** tab
2. Select the "Daily Morning Tech Briefing" workflow on the left
3. Click **"Run workflow"** on the right (check `skip_email` to see the logs without sending)
4. After a minute or two, check the log and the `TO_EMAIL` inbox

✅ Once the email arrives you are done. It will now be **sent automatically every morning** (by the first of the 05:23, 06:23, 07:23 and 08:23 KST schedules to start).

---

## ⚙️ How it works

```
Every day at 05:23 · 06:23 · 07:23 · 08:23 KST (20:23–23:23 UTC, off the hour to avoid scheduling delays)
        │   the first run to start sends; later runs see today's history and exit without API calls
        ▼
GitHub Actions trigger (.github/workflows/daily.yml)
        │
        ▼
src/index.mjs  (topics, categories and colors come from briefing.config.json)
        │
        ├─ fetch-news.mjs   → Claude Sonnet 5.5 + web search collects up to 20 candidates (claude-news.mjs)
        │                     + checks each article address against the search results (hallucinated-batch guard), Gemini as backup
        ├─ judge.mjs        → TypeSafe (Jev) judges repeats, duplicates, generic, off-topic, relevance, category
        ├─ select.mjs       → removes repeats/duplicates/generic/off-topic and fills the category quotas (10)
        ├─ email-template.mjs → renders the card-style HTML (collection model and API cost in the footer)
        ├─ send-email.mjs   → sends through Resend to TO_EMAIL
        └─ cost.mjs         → estimates API cost from usage and appends it to .briefing-state/costs.json
```

### 🔗 Link handling

**Claude (default)** — web search results carry the publisher's real article address and a `page_age` (when the page was last updated). The `URL:` line the model writes for each item is matched against the search results:

1. If it is in the results it is used as is. The search engine just fetched that page, so the reachability check is skipped (many news sites block bots, and checking from Actions would drop healthy articles with a 403)
2. Otherwise the address of a citation attached to that item's summary is used
3. If neither exists the address may be made up, so it is fetched directly, and a failure falls back to the search link below

Measured on 2026-10-08 (Sonnet 5.5, three runs): all 16–18 items had an address confirmed by the search results, and 0–3 of them were digest or listing pages that became search links. After the prompt began asking for the original publisher or the official announcement, all 18 were article links.

**Category top-up** — how many stories one request returns varies from 10 to 18 a day. The 2026-10-08 Actions check got only 12, and both robotics candidates were dropped as repeats, so the briefing had no robotics story. So when a category has fewer stories with a confirmed article address than selection needs (the config `count` + 1), a **short fresh request** looks for more in just those categories (up to `NEWS_TOPUP_SEARCHES` searches, publication up to 72 hours old, with the stories already chosen listed to avoid duplicates). Continuing the first conversation instead re-wrote its search results to the cache and cost $1.70 a run; the fresh request cost $1.16.

**Gemini (backup)** — The URLs Gemini returns are either Google grounding redirects (which expire and 404 later) or addresses the
model made up. So `fetch-news.mjs` does the following **at collection time**:

1. Restores truncated redirect URLs by matching them against the canonical `groundingChunks` URLs
2. Resolves them to the **publisher's real article URL** (a permanent link)
3. When the result is a front page, a section page, a video page or a dead link, the card gets a **Google Search (News tab) link built from 3–4 keywords the model gives for each story**, in the language of the original article, and its button reads "🔎 관련 기사 검색" (search related coverage) instead of "🔗 원문 보기" (open article)

→ Most cards open the article itself, and every link in the email is live. The search link used to be a Google News search for the full Korean headline. A check on 2026-10-05 found that 4 of the 9 such links sent in the previous ten days returned nothing, because the headline is the model's Korean rewrite of an English story, while the same event searched by keywords returned 44 stories. On phones they also ended in "콘텐츠를 찾을 수 없습니다" (content not found); on Android, news.google.com links are registered to open in the Google News app.

Every search link is logged in a `[link]` block with the reason (no source attached / source address could not be resolved / not an article address / direct URL unreachable), the address that was rejected and the keywords used.

### 🛡 Hallucinated-batch guard

When a model succeeds on a retry after a 503, it occasionally answers **from memory without web search** and
invents the news (observed on 2026-09-17: ten non-existent stories such as "Gemini Ultra 2.0 launch imminent"
went out as a normal email). Every URL in such a batch is fabricated, so almost none survive link resolution.
`fetch-news.mjs` therefore **tallies link resolution on every attempt**:

- If fewer than `MIN_GROUNDED_LINKS` links resolve to real articles, the attempt is treated as hallucinated and **collection is retried**. The default scales with the number of stories requested: **30%, at least 3** (10 requested → 3, 20 candidates → 6). On healthy days 12–16 of 20 survive; on hallucinated days 2–3 do
- If the primary model returns **zero search sources** (grounding chunks for Gemini, search results for Claude), web search did not run, and the attempt is retried regardless of the link count (on 2026-09-25 three fabricated URLs happened to be live and slipped past the count alone)
- Across up to 6 attempts the result with the **most real links** wins (if all fail, it still sends, on the grounds that a weak briefing beats a missing one)
- Each attempt logs `items / search sources / real links / search fallbacks`, and each item is tagged `⚠️검색폴백` when it fell back, so the threshold can be tuned from a few days of logs

Tune it with the `MIN_GROUNDED_LINKS` repository variable as an absolute count (0 disables the guard; an empty
value means "use the default"). Check how many links normally survive and set the threshold below half of that.

### 🧪 TypeSafe (Jev) judgments and selection — repeats, duplicates, generic and off-topic are removed; ordering is unchanged for now

The **semantic judgments** code cannot make are asked of Jev, [TypeSafe](https://typesafe.ai)'s System One model.
Jev does not generate text; it returns typed judgments only (a yes/no probability, a graded score, a choice).

| Judgment | How | Used today |
|---|---|---|
| Repeat of an earlier briefing | "Was this event already covered?" against the last 14 days of sent headlines (Noul) | **Applied**: removed at probability ≥ 0.7 |
| Same-day duplicate | "Do these two report the same event?" per candidate pair (Noul) | **Applied**: the later one removed at ≥ 0.7 |
| Generic commentary | "Does it report a concrete event (announcement, deal, launch, incident, report)?" (Noul) | **Applied**: removed at concreteness ≤ 0.3 |
| Off-topic | A "none" option in the category choice; its probability is the signal (Choice) | **Applied**: removed at "none" ≥ 0.7 |
| Reader relevance | 0–3 score against the role and interests in `READER_PROFILE` (Score) | Recorded only (a proposed order is logged) |
| Category | One of the configured categories (Choice) | Recorded only |

**Selection flow**: ask Gemini for twice the target (`candidates` in `briefing.config.json`, default 20) → Jev judges →
remove off-topic, generic, repeats and duplicates → fill the configured category quotas (e.g. AI 3, XR 2, space 2, robotics 3) →
top up in order with what remains. Ordering keeps Gemini's importance order. Relevance ordering will be enabled after the reader has graded it.

Evidence (87-day backtest, 2026-06-22 to 09-19, 852 items):

| Judgment | Flag rate | What was checked |
|---|---|---|
| Repeat | 10.0% | The same event ran up to 6 days (the US ban on Chinese robots, 7/29–8/7). 5 of 9 hand-verified cases detected; half of the 4 misses were genuinely new developments, which the rule counts as not repeats |
| Same-day duplicate | 5 pairs | Includes two days on which the exact same headline appeared twice in one email |
| Generic | 14.3% | Mostly market-size forecasts, trend explainers and columns |
| Off-topic | 0.4% | A memory-chip roadmap, an M&A forecast, an agriculture column |

Repeat probabilities are polarized (75% below 0.2, 8% above 0.8), so 0.7 is a stable threshold and the 0.3–0.7
gray zone (9%) is kept. Concreteness is split the same way (14% at or below 0.3, 64% at or above 0.7), so 0.3 removes
only clear commentary. Repeats plus generic items can remove about a quarter of the candidates, which is why 20 are collected.

Conditions and outputs:

- Judgments run only when `TYPESAFE_API_KEY` is set. If it is missing or the call fails, the pipeline **falls back to
  sending the first `total` items from Gemini**, so the email is never skipped
- The `JEV_SELECT=shadow` repository variable records judgments without changing the email (and collects only the target count)
- 41 requests a day (1 for pairs + 2 per candidate × 20), about 60k input tokens → about $0.003 a day at the published price
- Log layout: `(c01)…` candidate list → `[shadow]` per-item judgments → `[select]` removals with reasons → `📬 발송 목록` (sent list).
  `out/judge-YYYY-MM-DD.json` (judgments plus selection rationale) is uploaded as the `shadow-report-*` artifact for 90 days
- Sent headlines are kept in `.briefing-state/history.json` and carried between runs through the Actions cache
  (never committed). Removed candidates are not recorded
- Thresholds: `DUP_THRESHOLD`, `REPEAT_THRESHOLD` (default 0.7), `GENERIC_THRESHOLD` (default 0.3, at or below is generic),
  `OFFTOPIC_THRESHOLD` (default 0.7, at or above is off-topic)

**Testing**: Actions tab → Run workflow → check `skip_email` → collection, judgments and selection are logged without sending.
History is not updated in this mode.

**Testing everything at once (backtest)**: instead of waiting a day per data point, replay the last 90 days of real
briefings. Actions tab → "Jev Backtest (past briefings)" → Run workflow.
`scripts/extract-history.mjs` pulls the per-day headlines from the Actions logs (retained 90 days) and
`scripts/backtest.mjs` replays them in date order with a rolling 14-day history, then uploads the `jev-backtest-*` artifact with
`summary.md` (repeat, duplicate, generic and off-topic lists, a check against hand-verified cases, top-3 relevance per day, probability histograms),
`grading.csv` (a sheet for manual scoring) and `results.json`. The full summary is also printed in the run log. No email is sent, Gemini is not
called, and the Jev cost is about $0.3 for 90 days. The logs contain only headlines and categories, so treat the results as a lower bound.

**Next steps**: grade the relevance judgments with `grading.csv` from the backtest artifact; if agreement is high enough, enable relevance ordering.
Then validate a "same debate" judgment (capping variations on one topic that are not the same event) with a backtest before adding it.
The questions live in `src/judge.mjs`; the reader profile lives in the `READER_PROFILE` Secret.

---

## 🧪 Local test

To check on your machine before pushing:

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY, RESEND_API_KEY, TO_EMAIL (GEMINI_API_KEY and TYPESAFE_API_KEY are optional)

npm install
npm start
```

The console prints the candidates, judgments and sent list, and the email goes out. `SKIP_EMAIL=1 npm start` runs everything without sending.

---

## 🔧 Customizing

**Send time** — move the four cron lines in `.github/workflows/daily.yml` together
- Current: `23 20`, `23 21`, `23 22`, `23 23` (UTC) = 05:23–08:23 KST. The first run to start sends; the rest exit
- Cron is in UTC (KST − 9 hours), and **on-the-hour schedules lag the most** because GitHub's load peaks there (this repository's 08:00 schedule started 1.8–3.9 hours late, at 09:47–11:51, from 2026-09-01 to 10-08, and the runs for 08-24 to 08-26 never came). Keep the minute off the hour
- Check the actual lag in the Actions log (`[schedule] 예정 … → 시작 … (지연 N분)`, planned → started, delay) and in the run summary

**Topics, categories, counts, colors** — edit only `briefing.config.json` in the repository root (see below)

**Email design** — category colors are `color`/`bg` in `briefing.config.json`; the card layout is `renderCard` in `src/email-template.mjs`
- The email is **dark theme only**. The `color-scheme`/`supported-color-schemes` meta tags and the `bgcolor`
  attributes prevent automatic light conversion, so **Gmail web and Apple Mail** keep it dark.
- ⚠️ **The Gmail mobile app** follows the device/app theme regardless of the email's code (it cannot be forced).
  For a consistent dark look, set Gmail app → Settings → General settings → Theme → **Dark** on the receiving side.

**Skip weekends** — set the weekday field of all four cron lines in `daily.yml` to `0-4` (for example `"23 20 * * 0-4"`; Sun–Thu UTC = Mon–Fri KST)

### 🗂 Changing the topics — `briefing.config.json`

The collection prompt, the email's badge colors, footer text and title, and the Jev category judgment **all read this one file**.
To fork the project for other topics, edit this file and leave the code alone.

```json
{
  "title": "Morning Tech Briefing",
  "subjectLabel": "테크 브리핑",
  "topicLabel": "AI · XR · 우주 · 로봇",
  "searchScope": "AI, XR(AR/VR/MR), 우주산업, 로봇산업 분야",
  "total": 10,
  "candidates": 20,
  "categories": [
    { "key": "AI", "count": 3, "color": "#00D4FF", "bg": "#0a2730",
      "description": "AI models, companies, policy, chips, safety" },
    { "key": "로봇", "count": 3,
      "description": "Humanoids, industrial and service robots, physical AI" }
  ]
}
```

| Field | Meaning | When omitted |
|---|---|---|
| `title` | Briefing name in the email header, footer and first line of the plain-text version | "Morning Tech Briefing" |
| `subjectLabel` | The "○○○" part of the subject "📡 <date> ○○○" | "브리핑" |
| `topicLabel` | Topic summary used in the footer and in Jev's default reader profile | Category keys joined with " · " |
| `searchScope` | Search scope inserted into the Gemini prompt ("the most important news in …") | `topicLabel` + " 분야" |
| `total` | Stories per day | 10 |
| `candidates` | How many candidates to ask Gemini for when Jev selection is on; quotas scale proportionally | 2 × `total` |
| `categories[].key` | Category name, used verbatim as the prompt's allowed value, the email badge and the Jev choice (required, unique) | — |
| `categories[].count` | Suggested count | Remaining slots split evenly |
| `categories[].color` / `bg` | Badge and button colors (for a dark background) | An 8-color default palette, in order |
| `categories[].description` | Definition Jev uses when re-classifying. English is more reliable | Judged by the name only |

Notes:

- If the model returns a category that is not in the config, it is replaced with the first category and logged.
- Changing `total` also moves the "truncated response" retry threshold (below half).
- Point `BRIEFING_CONFIG=<path>` at a config file in another location.
- Personal interests belong in the `READER_PROFILE` Secret, not here. This file holds only the shareable "briefing definition".
- The prompt and the email copy are in Korean. To receive another language, edit `buildPrompt` in `src/fetch-news.mjs` and the strings in `src/email-template.mjs`.

---

## 📧 (optional) Sending from your own domain

To send from `noreply@yourdomain.com` instead of `onboarding@resend.dev`:

1. https://resend.com/domains → "Add Domain"
2. Add the DNS records it lists (SPF, DKIM) at your domain registrar
3. Once verified, change the `FROM_EMAIL` Secret to `Morning Tech Briefing <noreply@yourdomain.com>`

With a verified domain you can send **to any recipient**, and the email lands in spam less often.

---

## 🖼 (reference) Sender avatar

The round logo next to the sender name in Gmail is the **BIMI** standard, which needs all of the following:

- Your own domain (**not possible** with the shared `onboarding@resend.dev`)
- SPF + DKIM + **enforced DMARC (`p=quarantine` or stricter)**
- A hosted square SVG logo
- **Gmail additionally requires a VMC certificate** ($1,000+ a year)

→ **Uploading an image to Resend does not do it.** For a personal briefing the cost is hard to justify; leaving
the avatar empty is recommended (it has no effect on functionality).

---

## 💰 Cost — about $25–35 a month with Claude Sonnet 5.5

| Item | Cost |
|------|------|
| GitHub Actions | Free (free for public repos; 2,000 minutes a month for private ones). A sending run takes 2–3 minutes; the remaining schedules on a day already sent exit in seconds |
| Resend | Free (3,000 a month; this uses 30) |
| Claude API — `claude-sonnet-5-5` (default) | Measured 2026-10-08: **$0.83–0.89 a run** without a top-up = 24–25 web searches ($0.24–0.25) + about $0.6 of tokens (190k–210k cache writes, 300k–410k cache reads, about 8k output); **$1.16** with a category top-up → **about $25–35 a month** |
| Claude API — `claude-haiku-5-5` (optional) | Same day, same settings: $0.29–0.47 a run → about $9–14 a month |
| Gemini API (backup) | Used only when Claude fails. `gemini-3.6-flash`: about 1k input + 10k output tokens a run (thinking included) → about $0.04 (introductory price; about $0.08 from 2027). Grounded searches are free up to 5,000 a month |
| TypeSafe (Jev) | Optional. 41 requests and about 220k input tokens a day → **about $0.01 a day, $0.3 a month** (input $0.042/M, output free). One 87-day backtest is about $0.3 |

Prices per million tokens as of 2026-10-08 ([Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)): Sonnet 5.5 input $2, output $10, cache read $0.10, cache write $2.50; Haiku 5.5 input $0.10, output $0.50 ($0.50 and $2.50 for prompts over 100k tokens); web search $10 per 1,000 searches. Search results are also billed as input tokens, and they accumulate as the search loop repeats within one response, so requests enable automatic caching (`cache_control`) to pay the cache-read rate on the part that is re-read.

### 📈 API cost monitoring

- Every run multiplies the usage in the API responses (tokens, web searches) by the prices above and appends the estimate to `.briefing-state/costs.json` (kept in the Actions cache)
- **Email footer**: `API 비용(추정) 이번 실행 $0.84 · 10월 누적 $… · 월 환산 $… (최근 발송 7회 평균 × 30, 경고 기준 $50.00)` — estimated API cost: this run, month to date, monthly run rate (average of the last 7 sends × 30), alert threshold
- **Actions run summary**: a table per stage (collection, judgment) with model, tokens, searches and cost
- When the run rate exceeds `COST_ALERT_USD` (default 50), the email shows **a yellow warning at the top** and Actions shows a warning → consider setting `MODEL` to `claude-haiku-5-5` or lowering `NEWS_MAX_SEARCHES`
- Month to date includes manual test runs (`skip_email`); the run rate uses only runs that sent an email
- These are estimates. The exact bill is in the Claude Console Usage and Cost pages (Google AI Studio for Gemini). For Haiku 5.5 the per-iteration prompt size of the search loop is not reported, so a combined input over 100k tokens is priced at the higher rate (an upper bound)

### Could a general LLM do this instead of Jev?

Yes. All six judgments can be asked of an LLM such as Gemini with JSON output. The difference is not capability but
cost, latency, output shape and operational risk. Measured in this repository (2026-09-19):

| Item | Jev (jev-1.13) | Gemini 2.5 Flash | Gemini 2.5 Flash-Lite |
|---|---|---|---|
| Price | input $0.042/M, output free | input $0.30/M, output $2.50/M | input $0.05/M, output $0.20/M (retiring 2026-10-16) |
| Daily run (41 requests) | about $0.003 | about $0.03 ($0 on the free tier) | about $0.005 ($0 on the free tier) |
| Daily wall time | about 1 s | tens of seconds | a few seconds |
| One 87-day backtest | $0.3, 2 minutes | about $2.5–3; over 2 hours on the free tier because of the per-minute limit | about $0.4 |
| Output | typed probabilities only | JSON can be truncated or fail to parse (this repository has hit that) | same |
| Reproducibility | ±0.02 between two runs | can drift even at temperature 0 | same |
| Vendor risk | new service, launched 2026-09-15 | already in the pipeline, one key | same |

- On **daily running cost** there is no winner; with free-tier Gemini both are near zero.
- **Where Jev wins**: probability outputs allow policies such as "remove at ≥ 0.7, keep 0.3–0.7", and evaluation is
  10× cheaper and 50× faster, which made it practical to backtest several times before switching the selection on.
- **Where an LLM wins**: subtle calls such as "new development or the same event", and vendor risk. The judgment code
  lives in a single file, `src/judge.mjs`, so the same questions can be moved to an LLM if needed.

Price sources: TypeSafe pricing summary ([Developers Digest](https://www.developersdigest.tech/blog/typesafe-jev-system-one-models-release-guide-2026)),
Gemini 2026 pricing summaries ([CloudZero](https://www.cloudzero.com/blog/gemini-pricing/), [Morph](https://www.morphllm.com/gemini-api-pricing)).
Free-tier limits vary by model and date; check the Google AI Studio pricing page.

**Model choice** (`MODEL` variable) — measured on 2026-10-08, same day, same prompt

| Model | Candidates (AI·XR·space·robotics) | Article addresses | Time | Cost per run |
|---|---|---|---|---|
| `claude-sonnet-5-5` (**default**) | 16–18 (6·3·3·4–6) | all confirmed by search results, 13–18 article links | 61–66 s | $0.83–0.89 |
| `claude-haiku-5-5` | 19 (6·4·4·5) | all 19 confirmed by search results | 142 s | $0.29–0.47 |
| `gemini-3.6-flash` (backup) | 20 | 19/20 real article links (no publication dates) | 50 s | about $0.05 |

- Claude includes only stories whose publication time it confirmed in the search results, so some days it returns fewer than 20. Gemini gives no dates, so filtering old stories falls to Jev (the same morning's run lost 5 of 20 as repeats)
- Claude uses the basic web search tool (`web_search_20250305`). Dynamic filtering (`web_search_20260209`), which filters results with code, uses fewer tokens, but in four Sonnet 5.5 runs the search code kept failing, spent the search cap and returned only 10–12 stories. `NEWS_SEARCH_TOOL` switches it
- `NEWS_EFFORT=high` doubled the cost ($1.35) under the same settings without more candidates
- `gemini-2.5-flash` and `gemini-2.5-flash-lite` **shut down on the Gemini API on 2026-10-16**

> **Gemini 3.x and JSON.** 3.x models silently skip Google Search when the prompt asks for JSON output
> ([cookbook#1274](https://github.com/google-gemini/cookbook/issues/1274); measured here: seven attempts, no
> `groundingMetadata`, 1–4 real links out of 20). For models matching `gemini-3*` the collector therefore asks
> for a numbered list of labelled lines instead of JSON and attaches each item's source from
> `groundingSupports` in code, so the model never writes a URL itself. `NEWS_FORMAT=json|list` overrides the
> automatic choice.
>
> Note: thinking tokens count against `maxOutputTokens`. 2.5-flash uses about 2,700 of them, 3.6-flash about
> 7,000–9,000, so the limit in `src/fetch-news.mjs` is **32768**. A much lower value truncates the output and
> yields only a few stories.

---

## 🛠 Troubleshooting

**No email arrives**
- Check the run log for errors in the Actions tab
- With `onboarding@resend.dev`, confirm the recipient is the email you signed up to Resend with
- Check the Gmail spam folder

**The email arrives late / the workflow does not run on time**
- GitHub's scheduled runs lag on the hour (this repository's 08:00 schedule started at 09:47–11:51 from 2026-09-01 to 10-08, and 08-24 to 08-26 never ran). That is why there are four schedules between 05:23 and 08:23 KST and the first to start sends
- Check the lag in the log line `[schedule] 예정 … → 시작 … (지연 N분)`. If even the first schedule is late every day, move the cron lines earlier
- If it matters, run it manually with `workflow_dispatch` (a manual run sends even if today's email already went out)

**"Anthropic 인증 정보가 없습니다" (no Anthropic credentials) / Claude 401 or 403**
- `ANTHROPIC_API_KEY` is missing or wrong. With `GEMINI_API_KEY` present, the run switches to Gemini immediately without retrying and the email still goes out (log: `설정 오류 … 백업 모델 gemini-3.6-flash로 전환`; email footer: `수집 모델: Gemini 3.6 Flash`)
- `This API key is not scoped to a workspace` → use a key scoped to a workspace, or add `ANTHROPIC_WORKSPACE_ID` (`wrkspc_...`) under Variables

**Claude 529 overloaded / 429**
- Transient. The run retries after 20 s and 40 s and switches to the Gemini backup after the third failure

**A cost warning at the top of the email ("API 비용 월 환산 … 초과")**
- The average of recent sends × 30 exceeded `COST_ALERT_USD` (default $50). Set `MODEL` to `claude-haiku-5-5` or lower `NEWS_MAX_SEARCHES`; change the threshold itself with `COST_ALERT_USD`

**Claude returns only a dozen or so candidates, or a category is empty**
- It includes only stories whose date and address it confirmed by search (10–18 when measured). Short categories get a top-up request; the log line `보충: … 요청 → N건 추가` (top-up requested → N added) shows it. If categories are still often short, raise `NEWS_TOPUP_SEARCHES` (default 10) or `NEWS_MAX_SEARCHES` (default 25); each search costs $0.01

**"GEMINI_API_KEY 환경변수가 없습니다" (with a Gemini primary model) / "TO_EMAIL 환경변수가 없습니다"** (environment variable missing)
- A Secret from step 3 is missing or misspelled. Names are case-sensitive

**"Gemini API 429" (quota / rate limit)**
- The free tier limits requests per minute (e.g. `limit: 20`). **One automatic send a day never hits it**, but several test runs in a short time can → wait a minute or two and retry
- If 429s persist after switching to `gemini-3.5-flash`, that key has no free grounded quota for the model → set `MODEL` back to `gemini-2.5-flash`

**"Gemini API 503"**
- Transient overload. `fetch-news.mjs` waits **20 s, then 40 s** between transient failures (429/5xx) of the primary model and, after the third one, switches to the **backup model (`gemini-3.5-flash-lite`)** so the send is not lost. The backup is asked for only `total` stories (not the full candidate pool) because lighter models truncate long outputs, and it must pass the same grounding guard. If the backup itself fails (wrong model ID, no quota), the remaining attempts go back to the primary. Six attempts in total
- If it still fails the overload lasted a while → re-run the job from the Actions tab
- The backup model is set with the `FALLBACK_MODEL` variable (equal to `MODEL` disables the fallback)

**Only one or two stories arrive**
- The JSON was truncated by a low `maxOutputTokens`. Check that it is at least 16384 in `src/fetch-news.mjs`

**Every story is generic commentary or a non-existent announcement (e.g. "○○ 2.0 launch imminent")**
- A batch the model made up without Google Search grounding. A log line like `실제 기사 링크 0/20` (real links 0/20) followed by
  `그라운딩 누락(환각 배치) 의심 → 재시도` (suspected hallucinated batch → retry) means the guard fired
- If it still failed after 6 attempts and sent anyway, the log ends with a `재시도 후에도 실제 기사 링크 N개뿐` warning → re-run manually
- If real news keeps triggering retries every day, lower `MIN_GROUNDED_LINKS` (see how many real links a normal day has)

**The email often shows "🔎 관련 기사 검색" instead of "🔗 원문 보기"**
- Those stories had no article address that could be confirmed. Check the `[link]` block in the Actions log: if one reason and one site keep repeating (for example `기사 주소 아님 | youtube.com/watch`), adjust `isLikelyArticle()` in `src/fetch-news.mjs`
- Measured 2026-09-26 to 10-05: 0–6 of the 20 candidates a day, 0–3 of the 10 stories sent

**The `[select]` line often shows "미사용 0건" (0 unused)**
- Not enough candidates survive after removing repeats and generic items. Raise `candidates` in `briefing.config.json` to 25–30

**`[judge] 판정 실패` (judgment failed) appears**
- A TypeSafe outage or key problem. That day the first 10 collected items were sent automatically, so the email is fine. If it recurs, check the key

**JSON parse errors**
- The code recovers truncated JSON in most cases. If it keeps failing, raise `maxOutputTokens` or change the model

---

## 🤖 Automated setup with Claude Code

Run Claude Code in this folder and ask:

> "Push this project to a new private GitHub repository, register the Secrets (ANTHROPIC_API_KEY, GEMINI_API_KEY, RESEND_API_KEY, TO_EMAIL, FROM_EMAIL) with the gh CLI, then run the workflow once manually to test it."

Claude Code runs `git`, `gh secret set` and `gh workflow run` in order and completes steps 2 to 4 in one go. (You type the key values yourself.)

---

## 📂 Structure

```
morning-tech-briefing/
├── .github/workflows/
│   ├── daily.yml                 # four morning crons (the first to start sends), history and cost cache, judgment report artifact
│   └── backtest.yml              # replays the last 90 days through the Jev judgments (manual)
├── briefing.config.json          # topics, categories, counts, colors (edit this to change topics)
├── src/
│   ├── index.mjs                 # entry point: collect → judge → select → send → record history
│   ├── config.mjs                # loads and validates briefing.config.json
│   ├── fetch-news.mjs            # collection (per-model routing, retries, backup switch) + link resolution + hallucinated-batch guard
│   ├── claude-news.mjs           # Claude + web search collection, checks article addresses against the results
│   ├── cost.mjs                  # API cost estimate, ledger (.briefing-state/costs.json), monthly run rate
│   ├── schedule.mjs              # skips duplicate scheduled sends, computes the schedule lag
│   ├── judge.mjs                 # TypeSafe (Jev) judgments (repeat, duplicate, generic, off-topic, relevance, category)
│   ├── select.mjs                # removal, quotas and final selection from the judgments
│   ├── history.mjs               # sent-headline history (.briefing-state/, kept in the Actions cache)
│   ├── email-template.mjs        # HTML email
│   └── send-email.mjs            # Resend delivery
├── scripts/
│   ├── extract-history.mjs       # pulls past sent headlines from Actions logs
│   └── backtest.mjs              # replays judgments with a rolling history; writes summary and grading sheet
├── .claude/skills/typesafe-ai/   # TypeSafe skill for Claude Code (not used at runtime)
├── package.json / package-lock.json
├── .env.example
├── README.md                     # English (this document)
└── README.ko.md                  # 한국어
```

## 📄 License

MIT
