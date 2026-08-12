# Avatar

A web app where visitors chat with a Digital Twin of the site owner, and the
owner can join any conversation live from an admin dashboard.

**Status: built, deployed and live.** Do NOT rebuild it from `SPEC.md` — that
document is now a *behavioural reference*, not a build order. It describes what
the product does and why (its numbered Q&A entries are cited from code comments
and tests); it is not a to-do list.

## Where things are

| | |
|---|---|
| `backend/` | FastAPI + Supabase + OpenAI Agents SDK (via OpenRouter). uv project. |
| `frontend/` | Vanilla TypeScript + Vite. Visitor chat at `/`, admin at `/admin`. |
| `knowledge/` | The owner's profile, style and FAQ — read into the system prompt at runtime. |
| `design-system/` | The original design system from the upstream template. See "Appearance" below. |
| `test/` | `TEST_PLAN.md` (checkboxes) and `e2e.spec.ts` (Playwright, runs against a deployed URL). |
| `scripts/` | Start/stop, `deploy.sh`, `fly.toml`, `generate-avatars.mjs`. |

## Environment gotchas

These cost real time to rediscover. They are properties of the machine and the
network, not bugs to fix:

- **A corporate TLS-inspecting proxy may MITM HTTPS *inside Docker containers
  too***, not just on the host. Where that is the case, OpenRouter and Supabase
  calls fail locally with `CERTIFICATE_VERIFY_FAILED`, so **the LLM path and the
  database cannot be exercised locally at all** — run those tests against the
  deployed app instead. `truststore.inject_into_ssl()` (already called at app
  startup) fixes host-side Python; any ad-hoc script hitting the network needs it too.
- **`curl` may still work where Python's `httpx` does not.** Handy for ad-hoc
  Supabase reads/deletes via the PostgREST REST API when the Python client can't connect.
- **`flyctl` is not on PATH** on the owner's machine — it lives at `~/.fly/bin/flyctl.exe`.
- **Deploy with `--local-only`.** Both fly.io remote builders fail behind the
  proxy (depot: gRPC `handshake failed: EOF`; classic: npipe parse error).
  Docker Desktop must be running.
- `flyctl status` showing one machine `stopped` is **correct, not a fault**:
  `auto_stop_machines = "stop"` with `min_machines_running = 1`.
- `UV_LINK_MODE=copy` is required (OneDrive hardlink incompatibility).
- Supabase `conversation_id` is UUID-typed — pass valid UUIDs.
- Em-dashes in `bash -d` payloads break JSON encoding on Windows; write the JSON
  with Node (`utf8`) and post with `--data-binary @file`. Note Node on Windows
  resolves `/tmp/x` to `C:\tmp\x`.

## Before touching fly.io secrets

Setting secrets (`flyctl secrets set` / `secrets import`) requires the owner to
**explicitly authorize that specific action, naming the secrets involved**. A
general "proceed" earlier in a session does not cover it. Never echo credential
values into terminal output, commits, or logs — read them from `.env` (gitignored
and `.dockerignore`d) and pipe them straight to `flyctl`.

Note that `scripts/deploy.sh` stages secrets from `.env` as part of its run. To
deploy code *without* a secrets write, bypass it:
`flyctl deploy --local-only -c scripts/fly.toml`.

## Appearance

The shipped UI **intentionally diverges from `design-system/`**, which is
dark-first navy with a cyan HUD treatment. This instance is embedded in a light,
serif Quarto site, so it was re-themed to match its host: white surfaces, Georgia
prose, system-sans chrome, Bootstrap-blue links, no webfonts.

**Yellow is reserved exclusively for the human-in-the-loop** (the owner's bubble
and avatar ring) — it is the one accent, and the signal that a real person has
joined. Don't spend it on anything else; focus rings are blue for this reason.

Dark mode is still fully supported and available via the toggle. `design-system/`
is retained as the upstream reference and as documentation of the dark theme;
treat its dark/navy default and its Google Fonts (Newsreader, Hanken Grotesk,
JetBrains Mono) as **superseded**, not as instructions.

No themed CSS token has a `:root` fallback, so `<html>` must always carry a
`data-theme` attribute — never remove it.

## Testing

`test/TEST_PLAN.md` is the record — keep its checkboxes honest. E2E runs against
a deployed URL, not localhost:

```
BASE_URL=https://<your-app>.fly.dev npx playwright test
```

Per the test plan's own rules: delete screenshots and any test conversation rows
from Supabase when finished.

## Provenance

Derived from the Avatar project by Ed Donner
(https://github.com/ed-donner/avatar), used under the MIT License. Kept as the
`upstream` git remote. See `LICENSE` and the Credits section of `README.md`;
attribution is a license term, not a courtesy.
