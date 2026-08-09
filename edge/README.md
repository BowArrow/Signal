# edge — the public half of Signal

Firebase project: **`signal-edge-aionx`**
Console: https://console.firebase.google.com/project/signal-edge-aionx/overview

## Why this exists

Signal is a desktop app. Two things it needs cannot live on a laptop that
sleeps and has no public address:

1. **Click tracking.** A tracked link sitting in a Reddit comment gets clicked
   at 3am from a phone in another timezone. Something has to be listening.
2. **The Stripe webhook.** Stripe posts `checkout.session.completed` to a URL
   and retries on failure. That URL has to exist.

So the edge is deliberately tiny: two endpoints, no business logic, no
decisions. It records facts. The Electron app pulls those facts down into
SQLite, which stays the system of record for everything.

```
  reddit comment
       │  https://signal-edge-aionx.web.app/r/8f2a1c
       ▼
  ┌─────────────┐   302 + cookie     ┌──────────────┐
  │  /r/:linkId │ ─────────────────► │ lemonade site │
  └──────┬──────┘                    └───────┬───────┘
         │ click doc                         │ checkout
         ▼                                   ▼
    ┌──────────┐                    ┌─────────────────┐
    │ Firestore│ ◄───────────────── │ /webhooks/stripe│
    └────┬─────┘                    └─────────────────┘
         │  pull (authenticated, one way)
         ▼
   Signal.app → SQLite → attribution
```

## Status

Scaffold only. Phase 1 wired the project and the config; the functions
themselves land in **Phase 4** alongside the attribution matcher.

## What goes here in Phase 4

| Path | Job |
| --- | --- |
| `functions/src/redirect.ts` | `GET /r/:linkId` → look up the link, log a click doc, set the `sig_ref` cookie, 302 to the destination with UTM params |
| `functions/src/stripe.ts` | `POST /webhooks/stripe` → verify the signature, write a conversion doc. Never trust an unverified body |
| `functions/src/pull.ts` | `GET /pull?since=` → authenticated, returns clicks and conversions for the desktop app to drain |
| `firestore.rules` | Deny all client access. Only the functions and the pull token get in |

## Privacy

A click record stores a salted hash of the IP, never the address itself. That
is someone else's data, and Lemonade is sold on not doing this sort of thing
carelessly.

## Deploying

```bash
cd edge
firebase use signal-edge-aionx
firebase deploy --only hosting,functions
```

Cloud Functions needs the Blaze plan. Nothing here is deployed yet.
