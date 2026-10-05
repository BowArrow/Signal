# Continuous acquisition and channel experiments

The owner's request is to keep searching until available daily outreach capacity
is used, test feasible channels, then concentrate effort where results justify it.
This does not make weak-fit contacts eligible or turn all 19 channels into APIs.

The authors' publisher excerpt describes Bullseye as a repeatable three-step
framework for finding traction; a successful channel can stop working as the
business changes. Signal applies this by exploring feasible routes, measuring
actual outcomes, and retaining an exploration share after focus begins.
[Traction, publisher excerpt](https://penguinrandomhousehighereducation.com/book/?isbn=9781591848363)

Julian Shapiro's channel guide emphasizes audience fit, economics, implementation
effort and deliberate prioritization. It recommends investigating channels over
time, rather than treating every possible channel as an immediately viable test.
Signal's inventory therefore separates automated routes, access requirements,
funded launches and manual experiments. No claims about guaranteed audience
growth are adopted from this source.
[Startup Handbook: Growth Channels](https://www.julian.com/guide/startup/growth-channels)

## Implementation choices

- Successful acquisition tasks can schedule a fresh eligible request after a
  one-minute pause when capacity remains. Failed or blocked tasks retain the
  configured retry interval. Empty candidate sets do not consume model cycles.
- Queries rotate at most once per minute per business. Successful queries may
  repeat after 15 minutes while acquisition has unused capacity; exhausted
  capacity and failed searches use an hourly interval. No concurrent duplicate
  research/model task is started by this change.
- Channel testing is an explicit saved setting. Only selected, verified accounts
  with appropriate publishing access participate. Research sources without a
  supported delivery route are not made into contact channels.
- Available routes are selected before copy generation: direct Bluesky requests,
  website articles and explicitly enabled social experiments. Their destination
  choices now use the existing measured allocation logic in acquisition mode.
- Early allocation rotates destinations. Repeated live, retained, attributed
  payments can justify focus; verified visitor interest supports another test,
  not a declared sales winner. Every fourth cycle explores. Missing attribution
  remains unknown. These are bounded product heuristics, not statistically proven
  thresholds or numerical prescriptions from the book.
- The selected buyer's actual problem still governs the new reply. A previous
  successful campaign cannot overwrite their question. Helpful first replies
  without a product link retain the limitations of their attribution.
- The interface lists all 19 traction channels and distinguishes capabilities
  from completed experiments. Email retains its own permissions, recipients and
  limits. Paid ads, partner recruitment, placements, submissions and offline
  events are not falsely reported as automated activity.

The saved daily publication allowance is preserved. It is a ceiling across
selected destinations, not a per-channel minimum or a sales guarantee.
