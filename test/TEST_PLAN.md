# Avatar Test Plan

## 1. Backend Unit Tests

- [x] Environment variables present and valid
- [x] Supabase connection — table reachable
- [x] Supabase insert/delete roundtrip
- [x] Public API: GET /api/config returns owner_name and faq_queries
- [x] Public API: GET /api/conversation/{id} returns empty list for unknown id
- [x] Static serving: visitor page at /
- [x] Static serving: admin page at /admin/
- [x] Static serving: icons.svg
- [x] Static serving: favicon.svg
- [x] Admin auth: wrong password returns 401
- [x] Admin auth: correct password returns 200 + session cookie
- [x] Admin auth: check without cookie returns 401
- [x] Admin auth: check with valid cookie returns 200
- [x] Admin auth: logout clears session
- [x] Admin protection: conversations list requires auth
- [x] Admin protection: thread fetch requires auth
- [x] Admin protection: reply requires auth
- [x] Chat: missing fields returns 422
- [x] Chat: Qn instant answer works (Q1)
- [x] Chat: message truncation (25k chars accepted without error)

## 2. Frontend Build

- [x] TypeScript type-checks with no errors
- [x] Vite build produces dist/ with visitor and admin pages
- [x] dist/index.html (visitor chat)
- [x] dist/admin/index.html (admin dashboard)
- [x] All assets bundled (CSS, JS, images, icons)

## 3. Docker Build

- [x] Dockerfile builds successfully
- [x] Container starts and serves on port 8000 (mapped to 8010 locally)
- [x] Visitor page loads from container
- [x] Admin page loads from container
- [x] API config endpoint works from container

Note: the LLM path cannot be exercised from the corporate network — Zscaler
intercepts TLS inside the container too, so OpenRouter calls fail with
CERTIFICATE_VERIFY_FAILED. Everything in §4 was therefore run against the
deployed fly.io instance, which is the more honest target anyway.

## 4. End-to-End

Automated as `test/e2e.spec.ts` (16 Playwright tests, run against production):
`BASE_URL=https://avatar-tekstogtal.fly.dev npx playwright test`. Last run: 16/16 passed.

- [x] Visitor can send a message and receive a streamed reply
- [x] Qn shortcut works (no LLM call — asserted under 10s)
- [x] ?q=N deep link works and clears the parameter
- [x] Keep chat toggle persists conversation across reload
- [x] Reset chat creates new conversation
- [x] Admin login from /admin (and rejects a wrong password)
- [x] Admin sees conversations in inbox, unread markers correct
- [x] Admin can open a thread and see messages (clears unread)
- [x] Admin can reply — message appears in thread
- [x] Push notification fires when visitor requests contact
      (verified live: `tools fired: ['push_tool']`, `needs_attention: True`)
- [x] Human message appears in visitor's chat (polling, no reload)
- [x] Avatar does NOT auto-react to the human's message (SPEC Q&A #4)
- [x] Dark/light mode toggle works on both pages
- [x] Mobile responsive layout works (390x844, no horizontal overflow)
- [x] Twin replies in Danish to a Danish question

## 5. Deployment

- [x] fly.io app created and deployed (`avatar-tekstogtal`, region `arn`, 2 machines)
- [x] Smoke test: visitor chat loads from production URL
- [x] Smoke test: admin login works from production URL
- [x] Custom domain avatar.tekstogtal.dk configured — CNAME + `_fly-ownership`
      TXT added in Cloudflare (DNS-only, grey cloud); see DEPLOY.md
- [x] TLS certificate provisioned — Let's Encrypt issued; both
      `https://avatar.tekstogtal.dk` and `https://avatar-tekstogtal.fly.dev` return 200

## 6. Defects found and fixed during testing

| # | Defect | Fix |
|---|--------|-----|
| 1 | Streamed replies were always empty. The handler watched for `chunk.choices`, but the Agents SDK normalises OpenRouter's chat-completion chunks into Responses-API events, so no text was ever collected. | Match `ResponseTextDeltaEvent` in `backend/app/agent.py`. |
| 2 | OpenRouter rejected every request with 402. Without `max_tokens` it reserves the model's full context and refuses if the balance can't cover the worst case. | Set `max_tokens=16000` plus `reasoning=Reasoning(effort="low")` — the budget must also cover reasoning tokens, which are spent before any visible text. (Lowered to 4000 in #14.) |
| 3 | "Keep chat" restored a thread with the visitor's own messages missing. The frontend tested `role === 'visitor'`, but the database stores `'user'`, so visitor messages fell through to the avatar branch. | Correct the role check in `frontend/src/main.ts`. |
| 4 | `push_tool` never flagged the thread — `needs_attention` was hardcoded `False`, so admin had no "needs you" signal (violating SPEC Q&A #5). | Thread `tools_used` through `chat.py` and set `needs_attention="push_tool" in tools_used`. |
| 5 | Every icon rendered as a solid black blob. The sprite is stroke-drawn, but its `<defs>` was empty — the mockups had inlined the stroke styling, which didn't travel to the externally-referenced `icons.svg`. | Move the rule into `icons.svg`, and set `fill`/`stroke` on `.icon` as a bundler-proof fallback. |
| 6 | Avatar images were 900x900 PNGs (2.5 MB total) displayed at 40-72px, so they visibly popped in after the surrounding UI. | Downscale to 180px: 2.5 MB -> 134 KB (95% smaller), retina-safe at every rendered size. |

### Re-skin pass (matching tekstogtal.dk)

| # | Defect | Fix |
|---|--------|-----|
| 7 | The three avatar images were of the wrong person — `knowledge/pic.jpg` was still the template owner's photo, so a stranger's face represented the site owner. SPEC's "Owner-specific regeneration" step had been missed. | Regenerate all three from the owner's own photo via `scripts/generate-avatars.mjs` (committed this time, so the next owner isn't stuck). |
| 8 | Admin error text rendered with no colour: `var(--negative)` is referenced twice in `admin.css` but defined in no stylesheet. | Use `--danger`, which is the token that actually exists. |
| 9 | The yellow focus ring diluted the human-in-the-loop spark — yellow was doing two jobs, so "the human is here" stopped being the only yellow on screen. | Focus rings move to blue; yellow is reserved for the human's bubble and avatar ring. |
| 10 | On a 390px phone the composer placeholder clipped mid-word, and the `<=480px` rule hid the entire hint row — so mobile lost the only remaining place the `Qn` shortcut was taught. | Width-aware `setComposerPlaceholder()` (owner's first name below 560px); the media query now hides only `.kbd-hint`/`.sep`, keeping the Qn tip. |
| 11 | The intro suggestion chips showed the FAQ's routing shorthand ("who is Lasse / what do you do") — machine input, and clicking one submitted that text verbatim to the model. Caught only by screenshotting the real container instead of a stub. | `get_faq_queries()` returns the first sentence of the real `question`. |

Two accessibility corrections were also made while re-theming, found by computing
contrast rather than trusting the design pass: `--text-faint` `#888888` ->
`#767676` (3.54 -> 4.54) and `--role-avatar` `#1b95a6` -> `#0f7180`
(3.56 -> 5.68). Both carry timestamps, labels and the twin's name, and both now
clear WCAG AA.

### Maintenance, 2026-09-25 (found on the live site)

| # | Defect | Fix |
|---|--------|-----|
| 12 | Every chat request returned 500, including `Qn` answers: Supabase had paused the free-tier project after a week without traffic, and messages are stored before the LLM is called. | Restored in the dashboard; `.github/workflows/supabase-keepalive.yml` now queries it every third day, and a failed run is the alert. |
| 13 | Error events sent `str(exception)` to the browser in `content`, a field the frontend never read (it reads `error`) — visitors saw a generic toast while the raw OpenRouter error, account user ID included, sat in the SSE stream. | `_error_event()` in `chat.py` sends a fixed message in `error` and logs the exception server-side. |
| 14 | With the balance at ~$0.035, every request got a 402: `max_tokens=16000` reserved more than the balance, which still covered several ordinary replies. | Credit topped up; `max_tokens` lowered to 4000 (a 1,155-character reply verified untruncated). |
| 15 | Danish questions often got English answers. The FAQ is English and the prompt said to return answers "as written"; after a `faq_tool` call the English FAQ text is the last thing the model reads. | `MODEL` secret nano -> `gpt-5.4-mini`; the language rule is restated after the conversation and appended to every `faq_tool` result. Verified 5/5 Danish. One known miss: "What is tekstogtal.dk?" (English) is answered in Danish. |

- [ ] 19 `claude-test` conversations from these checks still to delete via `/admin`

## 7. Cleanup

- [x] Screenshots deleted (`test/screenshots/`)
- [x] Supabase test rows deleted — all 64 rows across 29 conversations from the
      e2e runs and screenshot seeding; `messages` verified empty afterwards
- [x] Throwaway harness and source photo removed (`shot-tmp.mjs`, `lasse-source.jpg`)
- [x] Local container stopped and removed

---

Last updated: 2026-08-12
