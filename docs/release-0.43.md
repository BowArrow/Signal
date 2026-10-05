# Signal 0.43: separate qualified-reply capacity

The existing one-publication allowance also consumed outreach capacity, and a
second hard-coded ceiling capped initial public replies at three across all
businesses. Increasing article/post frequency alone could not fix that.

An explicit saved publicReplyLimit of 1–10 now budgets qualified first replies
separately from articles and feed posts. The business's reply limit and a shared
ceiling of ten initial replies across businesses both apply. Existing policies
without this field keep their prior combined allowance and three-reply ceiling;
the update does not silently raise outbound contact volume. Email settings and
spending permissions remain independent.

The scheduler, discovery cadence, acquisition route selection, enqueue checks,
readiness display and remaining-capacity view use the same capacity rules.
Pending or uncertain deliveries retain their slots until reconciled. Existing
30-day repeat-contact suppression, source grounding, voice review and platform
thread restrictions remain in effect.

Bluesky discovery now accepts concrete personal work problems without requiring
a canned recommendation phrase. The shared buyer-intent check excludes casual
summarize requests before model work; product-fit review still decides whether a
discovered problem is suitable. A larger limit is not a promise of qualified
prospects, deliveries or sales.

Validation: 794 tests across 34 files passed, including a complete fixture
acquisition/review/delivery flow with an already-used article allowance. Final
progress/readiness changes were checked separately. Type checking, targeted lint
and packaged interface evidence are recorded in
data/operations-validation/release-0.43.json.

Owner activation uses scripts/enable-owner-reply-budget.mjs with an explicitly
approved SIGNAL_PUBLIC_REPLY_LIMIT. It verifies the installed package, requires
Signal to be closed and no pending marketing work, preserves article/email
limits and Run state, and performs no external delivery itself.
