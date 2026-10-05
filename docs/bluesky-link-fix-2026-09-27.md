# Bluesky source links

Signal 0.45 encoded DID colons with `encodeURIComponent`, creating profile paths such as `did%3Aplc%3A…`. Bluesky's web router rejected those paths with “Invalid DID or handle”. This affected discovery results, conversation links, and publication receipts.

Signal 0.46 uses one validated AT-URI-to-web-URL builder with literal DID separators. Saved discovery sources are normalized when read, and the external-browser boundary also repairs legacy links from older receipts and evidence. The repair does not rewrite historical observations, rerun discovery, or change posting permissions. External opening remains limited to HTTP(S).

Validation:

- Reproduced the failure with the owner's reported URL in a clean headless browser.
- The corrected URL reaches the post's sign-in requirement. This author restricts logged-out visibility, which is separate from the malformed-link bug. The public thread API confirms the post URI and matching source text.
- 74 targeted tests passed, covering discovery, delivery receipts, conversations, legacy observations, malformed routes, did:web escaping, and external protocols.
- TypeScript and targeted lint passed.
- Packaged conversation UI checks passed at 1440x900 and 720x800 with no renderer errors and no external delivery.

Browser evidence: `output/bluesky-link-verification.json` and `output/bluesky-link-before.png` / `output/bluesky-link-after.png`.

Installer: `release/Signal Setup 0.46.0.exe`. Hashes and installation status: `data/operations-validation/release-0.46.json`.
