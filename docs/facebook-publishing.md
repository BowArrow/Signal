# Facebook Page delivery

Operations supports Page text/link posts using the connected Page access token.
This does not post to personal profiles, create ads, upload videos, or send messages.

Check the connection before selecting it in Operations. Signal reads the numeric
Page ID, category and `can_post` capability and retains those across shared business
links. Each send rechecks the current token's Page against that ID. Page capability
is a prerequisite, not a substitute for `pages_manage_posts`, Page tasks or any
required Meta app review. The actual write may still be rejected by Meta.

The Facebook writer uses the current inspected business website, independent copy
review, company affiliation, and a tracked business URL. Signal limits campaign
copy to 5,000 characters. This is Signal's product limit, not a claim about Meta's
maximum post length. Image/video publishing needs a separate media adapter.

Before `POST /{page-id}/feed`, the delivery journal stores the Page and send start.
A valid returned `{page-id}_{post-id}` becomes the retained publication receipt.
After restart, a saved receipt is reused without another POST. An interrupted,
duplicate, server-error or malformed response remains uncertain and is not resent.
The owner can inspect the Page and close the unresolved attempt in Operations.
Explicit authentication, permission, parameter and rate-limit rejections are
distinguished from uncertain outcomes; provider error bodies are not exposed.

Primary implementation reference: [Meta's official generated Page SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py)
defines the `can_post` field and the feed creation endpoint with `message` and
`published` parameters. The [Pages posts guide](https://developers.facebook.com/docs/pages-api/posts/)
and [Graph API error guide](https://developers.facebook.com/docs/graph-api/guides/error-handling/)
are the provider documentation; the documentation host returned HTTP 429 during
this implementation's research, so it was not treated as successfully read.

September 18 validation: queue tests exercise Page identity, writing, receipt
recovery, pause during acceptance, uncertain response handling, provider rejection,
and the writer/reviewer path. They use intercepted transports and do not establish
live publication. The owner's saved AIonX Page token currently returns HTTP 401;
both business links now show attention. A fresh Page token is needed for the live
permission check. No real Facebook post was created.
