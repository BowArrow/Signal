# My marketer

Signal opens on **My marketer**. This is the starting point for someone who does not know which marketing tool to use next.

Choose your business, then save a focus: first paying customers, more product trials, or more consistent sales. The audience field is optional. Goals persist separately for each business and enter the agent's context; saving a goal does not change operating permissions, start work, or increase spending limits.

| On the home screen | What it helps you do |
| --- | --- |
| Your next step | See a recommendation derived from saved activity, its reason, and a button to the relevant business and section. Customer handoffs take priority. |
| What Signal is doing | Distinguish paused, offline, ready and unconfirmed runtime states. Inspect the latest cycle and open its controls. |
| Talk to your marketer | Ask for an explanation, discuss an audience or ask for a draft. Questions and replies are saved through the existing agent queue. |
| Where I need you | Open customer handoffs, uncertain deliveries, prospect suggestions and draft copy for review. |
| The path to a sale | Understand the different jobs of reaching people, helping them try the product and learning from purchases. |
| What we actually know | Read scoped publication, traffic and payment records with dates. Missing reports remain unknown; old reports ask for a refresh. |
| How our channels help | Understand the purpose and limitation of each selected destination, plus the last saved channel decision when available. |

The initial recommendation is computed from application state, so it remains available without a model. Conversation replies require the configured agent and a running Signal process. Failed or queued replies remain visible; the interface does not substitute a canned response and present it as agent output.

Coaching tasks can read sources, inspect the product, save drafts and record engineering suggestions. The executor blocks publishing, sending, paid media generation, campaign launches and automation changes from these tasks. Existing operating policies remain separate. The screen does not promise that every external action elsewhere in Signal needs a new approval; already-authorized operations retain their own behavior.

Review links preserve the selected business and open the requested section in Operations, Sales or Marketing. Analytics, Revenue and Connections also receive the business context. Returning to My marketer restores the selected business. On a fresh launch, Signal opens My marketer rather than a previously visited advanced tool.

## Validation

`tests/growth/marketing-guide.test.ts` covers persistent product-scoped goals, durable coaching replies, tool boundaries, human handoff priority, stale runtime evidence and goal-dependent guidance. Existing marketing and operation-progress tests cover the shared paths.

`node scripts/guide-ui-smoke.mjs` exercises a hidden Electron window against an isolated offline database. It checks startup, saved goals after reload, business isolation, contextual navigation, keyboard focus, unknown measurements and layouts at 1440, 900, 720 and 390 pixels. Screenshots and a receipt are written under `data/operations-validation/guide/`. This validates the interface and integration, not live model quality or sales effectiveness.
