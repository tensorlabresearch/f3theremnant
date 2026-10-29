# F3 The Remnant

Static Cloudflare Pages site for `f3theremnant.com`.

## Deploy

```bash
npm install
npx wrangler pages project create f3theremnant --production-branch main
npm run deploy
```

Cloudflare auth is required locally:

```bash
wrangler login
```

## Dynamic Areas

- `/api/schedule`: the next seven days, joined from `map/event/all` (street
  addresses) and `event-instance/calendar-home-schedule` (dated instances and
  the Q from Slack signups). Falls back to `data/schedule.json`.
- `/api/backblasts`: the backblast library, read from the same F3 Nation rows
  the Slack bot writes. Falls back to `data/backblasts.json`.
- `/api/aos`: the region's AO list from `map/location/aos-in-region`. Falls back
  to `data/aos.json`.
- `/api/events`: CSAUP and special events, parsed from the public Google
  Calendar iCal feed. Falls back to `data/events.json`.
- `/api/fng`: accepts the existing form payload and forwards it to
  `FNG_WEBHOOK_URL` when configured as a Cloudflare Pages environment variable.
  Without that secret, it returns `503`.

## Backblasts

Backblasts are not re-entered or forwarded by a webhook. The F3 Nation Slack bot
writes each backblast to the Nation database when a Q submits it, and the site
reads that record:

1. `event-instance` lists dated rows in a window. A non-null `paxCount` is the
   signal that a backblast exists.
2. `event-instance/id/{id}` returns the text for one row, which is where the
   moleskin lives.

So there is one source of truth, nothing to sync, and no Slack workflow needed on
the free plan. Two quirks matter when touching `functions/api/backblasts.js`:

- Do not pass `sorting`. With it the API returns future recurring projections
  (all `paxCount` null) instead of dated rows.
- `pageSize` is capped at 100; anything larger is a 400.

The bot writes a fixed header block (`Date:`, `AO:`, `Q:`, `PAX:`, `FNGs:`,
`COUNT:`) followed by the moleskin. The parser stops at the first line that is
not a known header key, so a body line that happens to read `PAX: ...` stays in
the body.

## Secrets

`F3_API_KEY` is a Pages secret, not a `wrangler.toml` var. Set it with:

```bash
npx wrangler pages secret put F3_API_KEY --project-name f3theremnant
```

`F3_REGION_ORG_ID` and `F3_API_CLIENT` are optional overrides; the region
defaults to The Remnant (`52724`).

## Domain Setup

Primary domain: `f3theremnant.com`

Alias domain: `f3remnant.com`

In Cloudflare Pages, add both custom domains to the same Pages project. Then add a redirect rule on `f3remnant.com`:

```text
https://f3remnant.com/* -> https://f3theremnant.com/$1
Status: 301
Preserve query string: yes
```

Also redirect `www.f3remnant.com/*` and `www.f3theremnant.com/*` to the apex primary if you want one canonical address.
