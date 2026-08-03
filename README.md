# F3 The Remnant

Static Cloudflare Pages clone based on `f3cherokee.com`, retitled for `f3theremnant.com`.

## Deploy

```bash
npm install
npm run deploy
```

Cloudflare auth is required locally:

```bash
wrangler login
```

## Dynamic Areas

- `/api/schedule`: currently serves `data/schedule.json`. Replace this with a live source when The Remnant has an authoritative schedule feed.
- `/api/aos`: currently serves `data/aos.json`. Fill this with real AO data or connect to the same source as the schedule.
- `/api/fng`: accepts the existing form payload and forwards it to `FNG_WEBHOOK_URL` when configured as a Cloudflare Pages environment variable. Without that secret, it returns `503`.

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

## Asset Note

`assets/logo.webp` and `favicon.png` came from the source clone and likely still contain F3 Cherokee branding. Replace them before launch.
