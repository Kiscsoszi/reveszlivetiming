# Kiss Livetiming

Norbert Kiss–focused live timing board for the Goodyear FIA ETRC public feed.

## Data source

Official embed: `https://livetiming.azurewebsites.net/events/16/results?config=w3`

This app opens the same public WebSocket:

- `wss://livetiming.azurewebsites.net`
- subscribe payload: `{ eventId, eventPid: [0, 4], clientLocalTime }`

A small Node proxy keeps the browser on one origin and reshapes the feed around **KISS / #1**.

## Run

```bash
npm install
npm start
```

Open [http://localhost:3456](http://localhost:3456).

## Env

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3456` | HTTP port (Railway sets this) |
| `EVENT_ID` | `16` | Live timing event id |
| `UPSTREAM_WS` | `wss://livetiming.azurewebsites.net` | Feed host |
| `DRIVER_MATCH` | `KISS` | Name match |
| `DRIVER_NUMBER` | `1` | Fallback start number |

## Deploy (Railway)

1. Push this repo to GitHub.
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → pick `kiss-live`.
3. Railway detects Node → start: `npm start` / `node server/index.js`.
4. **Settings → Networking → Generate Domain** → get a public URL (e.g. `https://kiss-live-production.up.railway.app`).
5. Open that URL on phones — WebSocket upgrades to `wss://…/live` automatically.

Optional env vars in Railway → Variables (usually leave defaults).

Note: `data/race-results.json` is written on disk. Redeploys can wipe it unless you add a Railway Volume at `/app/data`. Seeded R1/R2 in the repo are fine until the next auto-recorded race.
