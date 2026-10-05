# LinkedIn member publishing

In Connections, configure a LinkedIn app with OpenID Connect and Share on LinkedIn,
then connect the business's member account with publishing permission selected.
OAuth must grant `w_member_social`; verifying a read-only or manually entered token
does not establish that permission. In Operations, select the verified member
connection, set the objective and limits, then Run. Company Page publishing and
LinkedIn images/video are not implemented in this adapter.

The writer produces a practical professional post using current product facts.
It identifies the business affiliation, avoids invented personal experience, and
adds a tracked product link. The final text must fit 3,000 characters after tracking
parameters are added. The independent factual reviewer still gates queueing.
Campaign source, medium and ID remain available for configured Stripe attribution;
publication alone never establishes a conversion.

The adapter checks the authenticated member through `/v2/userinfo`, saves a send
record before `POST /v2/ugcPosts`, and requires HTTP 201 with a valid `x-restli-id`
receipt. It persists that receipt before finishing the local job, allowing a restart
to recover confirmed acceptance without another post. The endpoint, protocol header,
member author and public visibility follow the documented Share on LinkedIn flow.

LinkedIn does not provide the client-selected durable record key used by Signal's
Bluesky adapter. Lost, malformed, duplicate, conflict or server-error responses
therefore retain uncertainty and never cause another POST for that job, including
after manual retry or restart. Check the member profile and use **Stop retrying**
to close an unconfirmed delivery. This does not delete a remote post. Explicit
400/401/403/404/429 rejections clear the send record; a corrected connection or later
rate-limit retry can then attempt the job again. Pause blocks new writes, but a post
already accepted by LinkedIn is still recorded accurately.

Validation covers provider acceptance, publishing permission, lost responses,
server errors, missing receipts, duplicates, explicit rejections, restart recovery,
Pause, member identity and the final tracked-text limit. Requests use intercepted
transports; no actual LinkedIn post has been sent. Desktop checks cover writable
and read-only account presentation, offline Run restrictions and business isolation.
Real member permissions, subject-to-author mapping and live publishing must still
be verified with an authorized connected account before calling this channel live.

Primary references:

- [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)
- [OpenID Connect and userinfo](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)
- [UGC limits, errors and receipts](https://learn.microsoft.com/en-us/linkedin/compliance/integrations/shares/ugc-post-api)

The member-ID use of the OIDC subject follows the app-scoped member identity in
these APIs; live compatibility is an explicit remaining check. Read access to member
posts is not assumed from `w_member_social`, so an unknown post cannot be searched
and reported as confirmed automatically.
