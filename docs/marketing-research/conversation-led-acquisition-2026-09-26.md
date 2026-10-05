# From public discussion to a useful sales conversation

Research checked September 26, 2026. These sources support a strategy, not a
promise that automation will produce sales. Platform rules were checked live;
the selling principles below are established guidance, not invented new trends.

## What failed

Signal replied to "What's happening? Can someone summarize?" with a product
pitch about quarterly reports. The shared word did not establish a document
problem, a request for software, or interest in Lemonade. A model approved the
misfit anyway. Sending and receiving a publication receipt proved only delivery.
The owner removed the reply.

## Research and implementation

**Qualify the problem before the solution.** Segment's founder describes the
importance of learning directly from real customers and finding an actual need,
including early assumptions that failed. Signal now requires either a request
for software or a concrete work problem before considering an automatic public
reply. Casual questions, generic news discussion and feature-keyword matches
alone do not qualify. Product evidence and platform restrictions still apply.
[Y Combinator interview](https://www.ycombinator.com/blog/peter-reinhardt-on-finding-product-market-fit-at-segment)

**Use discovery rather than a feature pitch.** Consultative selling starts with
the person's situation and balances useful information with relevant questions.
Signal's first response to a work problem gives a practical step or asks one
question that changes the recommendation. The app name and link are omitted from
that first response, while team affiliation remains visible. Explicit software
requests can receive a supported recommendation and link immediately.
[HubSpot's consultative selling guidance](https://blog.hubspot.com/sales/consultative-selling)

**Understand the current workaround and constraints.** April Dunford separates
attention-getting marketing stories from buyer conversations. Her discovery
stage examines alternatives, current behavior and constraints. Signal's shared
conversation guidance asks about the actual work, not hypothetical purchase
intent. It forbids treating every annoyance as a reason to pitch the app.
[April Dunford, Sales-First Storytelling](https://aprildunford.substack.com/p/sales-first-storytelling)

**Demonstrate one useful result.** Intercom's value-based onboarding emphasizes
the job customers need done rather than a tour of every feature. The writing
guidance now favors a small task, a checkable result, and a relevant limitation
when suggesting a trial or demonstration. It does not invent completed demos,
product usage or activation metrics. This change is guidance for copy, not an
implemented in-product onboarding tour.
[Intercom on value-based onboarding](https://www.intercom.com/blog/retain-users-with-value-based-onboarding/)

**Participate within the community's rules.** Bluesky disallows disruptive spam,
misleading identity and undisclosed commercial content. Signal retains
affiliation, low publication limits and repeat-contact suppression; it does not
fake a satisfied customer. Hacker News prohibits generated and AI-edited
comments, so those findings remain research. An owner who participates there
must write their own contribution.
[Bluesky guidelines](https://bsky.social/about/support/community-guidelines),
[Hacker News guidelines](https://news.ycombinator.com/newsguidelines.html)

**Track the conversation, not just the post count.** The new Conversations
section records the original question, sent reply, public URL, observed
responses and review state. It distinguishes the original author from other
respondents. Thread unavailability preserves the historical send receipt but
does not imply the reply is still live. Checks use the public thread API, with
bounded response size, two reply levels and a polling interval.
[Bluesky thread API specification](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/getPostThread.json)

## Practical playbook

1. Identify a concrete task and relevant constraints in the actual post.
2. Exclude casual conversation, promotions, explicit opt-outs and unsupported
   platforms or capabilities. A possible buyer is not a confirmed customer.
3. For a work problem, offer useful help before recommending software.
4. For an explicit software request, explain one relevant supported capability.
5. When the person responds, use the actual reply to choose the next step.
   Silence is not interest. Do not chase them across channels or infer email consent.
6. A task-specific demonstration or trial should have a clear, checkable result.
7. Measure responses, qualified inquiries, trials and verified purchases
   separately. Avoid optimizing for the number of comments sent.

## Verification and remaining limits

Regression tests cover the deleted reply's vague context and absolute privacy
claim, business isolation, missing voice verdicts, helpful replies without a
sales link, direct software recommendations, failed/deleted thread reads, and
response review state. Tests using scripted model output verify enforcement,
not the reliability of a real model's judgment on every future post.

The social tracker detects responses but does not autonomously continue these
threads; the UI links to the live conversation. Email follow-ups retain their
existing separately configured policies. No new channel, ad spending or email
contact permission is granted by this update.
