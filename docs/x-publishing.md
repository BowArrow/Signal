# X publishing

Operations supports original text/link posts to an X account connected to the
selected business. In Connections, configure the X OAuth app and its exact
callback, request publishing access and sign in. Select that destination in
Operations and save a daily cap before Run. A read-only account cannot be selected
for publication. Connecting does not start posting.

The existing PKCE connection requests `tweet.read`, `users.read`, `offline.access`
and, when publishing is selected, `tweet.write`. X API access and usage charges
are controlled by the owner's developer account. Signal does not buy API credits
or enable ads. Uploaded images/video, threads, replies and direct messages are not
implemented by this adapter.

The writer produces a short, independently reviewed post with company affiliation
and a tracked business link. The final text is checked using the official
`twitter-text` parser, including weighted Unicode, combined emoji, URL shortening
and NFC normalization. Tracking parameters are preserved.

Before POST `/2/tweets`, Signal verifies the authenticated user and saves the send
attempt. A confirmed 201 response must contain a valid post ID, which is saved
before the job completes. If the application restarts after saving the receipt,
it recovers the result without another write. An interrupted request, missing
receipt or server error stays uncertain and cannot be resent automatically.
The UI directs the owner to check the profile and close the uncertain delivery.
It does not offer an ineffective retry action for these cases. A 403 can denote
duplicate content and also stays uncertain; other explicit handled rejections
allow correction and retry. An HTTP 429 schedules a bounded later attempt.

## Evidence and limits

Tests use intercepted provider requests, including acceptance during Pause,
scope checks, repeated retries after restart, explicit rejection recovery,
malformed receipts, character weighting and campaign generation. No real X post
was sent. Real OAuth grants, API billing/access and provider publication must
still be verified with the owner's account. A publication receipt is not traffic
or a sale.

Primary references checked September 18, 2026:

- [Create Posts](https://docs.x.com/x-api/posts/create-post): endpoint, JSON text and receipt.
- [OAuth PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code): grants and refresh tokens.
- [Counting characters](https://docs.x.com/fundamentals/counting-characters): official parser and weighted length.
