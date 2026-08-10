Read a community's own rules and turn them into a structured policy. You are
reading, not deciding. Every value you return has to be traceable to something
in the text below.

This drives whether an automated system is allowed to post there, so a wrong
reading gets a real person banned from a community he cares about. When the
text does not say, say it does not say. Do not fill gaps with what is
customary elsewhere on the platform.

## Community

{{community}}

## Rules, exactly as the moderators wrote them

{{rules}}

## Sidebar / description

{{sidebar}}

## Decide

**selfPromo** — one of:

- `allowed` — promotion is explicitly welcome with no stated conditions
- `allowed_with_disclosure` — permitted if you disclose your affiliation
- `discouraged` — tolerated but restricted: ratio limits, "contribute first",
  "no spam", or similar. **This is the right answer when the rules are vague
  or silent about promotion.** Silence is not permission.
- `designated_thread_only` — only in a weekly/monthly thread or on a named day
- `forbidden` — explicitly prohibited, no exceptions offered

**selfPromoRatioMaxPct** — a number only if the rules state a ratio (e.g. "1 in
10 posts" is 10). Null if they do not. Do not import the platform-wide folklore
figure; if this community did not say it, it is null.

**flairRequired** — true only if flair is stated as required for posts or
comments. **flairValue** — the specific flair if one is named, else null.

**minAccountAgeDays** / **minKarma** — only if numerically stated. Else null.

**evidence** — the exact sentences you based `selfPromo` on, quoted verbatim
from the text above. If you quote nothing, your confidence must be below 0.4.

**confidence** — 0.00 to 1.00. How sure are you that an experienced moderator
would agree with this reading? Be honest. Low confidence is useful; a wrong
high-confidence reading is not. If the rules never mention promotion at all,
confidence should be around 0.3 and selfPromo should be `discouraged`.

**notes** — anything a human should know before posting here that the fields
above cannot carry. One or two sentences. Null if there is nothing.

## Output

Return only JSON, no prose, no code fence:

{"selfPromo": "...", "selfPromoRatioMaxPct": null, "flairRequired": false, "flairValue": null, "minAccountAgeDays": null, "minKarma": null, "evidence": ["..."], "confidence": 0.00, "notes": null}
