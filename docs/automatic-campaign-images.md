# Automatic campaign images

Operations can produce a branded card from reviewed copy, or illustrate a
Bluesky campaign using a saved local ComfyUI workflow and review the pixels
with the configured agent. Both paths save the final image and publish it with
the post. Existing policies remain text-only until changed.

## Branded cards

Select **Branded card · local layout** in Operations after choosing the business's
verified Bluesky account. Save operating settings, then Run. The writer creates
a headline, description and short caption from current product evidence. The
independent editorial review covers all three. Signal lays out that exact
headline and description with the business name and website address, using a
Lemonade, CineGen or neutral color palette. There is no separate art prompt,
image model, ComfyUI call or vision review in this path. The configured text
agent is still required and may incur API costs when using GPT.

The fixed 1200 by 675 layout runs in a hidden, sandboxed Electron window. Supplied
text is escaped, page network access is blocked and the renderer checks text
overflow and footer separation before capture. An unrenderable card needs
attention; it cannot silently publish a text-only replacement. The accessible
description contains the visible business, headline, description and domain.
The saved JPEG, upload validation and publication recovery use the same path as
reviewed illustrations. Pause interrupts rendering and prevents subsequent upload.

This is deterministic typesetting of reviewed copy. A layout check does not prove
that a campaign will convert, and it does not replace product screenshots,
generated illustration or video. Normal Electron rendering may use graphics
acceleration; the isolated rendering checks explicitly disable it.
Implementation follows Electron's [offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)
and [capturePage API](https://www.electronjs.org/docs/latest/api/web-contents#contentscapturepagerect-opts).

## ComfyUI setup and execution

1. In Creative studio, connect an installed ComfyUI runtime and save a ready
   text-to-image workflow for Lemonade or CineGen. The supplied FLUX Schnell and
   Krea image recipes can be used when their required models are installed.
2. In Connections, verify that business's Bluesky account.
3. In Operations, select Bluesky and choose the saved **Campaign images** workflow.
   Save the policy, then Run. Existing policies remain text-only until changed.
4. Follow rendering, visual review, revisions and publication in Delivery history.
   **Preview campaign image** opens the exact prepared image used for publishing.

The agent researches current product facts and produces short public copy plus
art direction for that specific buyer problem. The destination is constrained
to the account selected for the cycle. A separate copy review checks factual
claims. The image prompt is an illustration brief, not evidence of a capability.

The worker renders one image at a time. If a portable ComfyUI installation was
selected in Creative studio, Signal can start it when the campaign needs it.
Otherwise, the configured localhost server must be running. Browser auto-launch
is disabled; the browser is optional for inspection and troubleshooting. Stopping ComfyUI
in Creative studio holds automatic starts until you start it again there.
Signal does not install model weights or change model licenses automatically.

Saved image workflows must use supported built-in text-to-image nodes, a prompt
placeholder, one SaveImage node, one image per batch, and bounded dimensions.
Workflows that load private files, call external APIs, run custom nodes, or save
video are not eligible for this still-image publishing path.

Completed output is downloaded from the original local render, bounded to 20 MB,
checked as PNG/JPEG, decoded, and re-encoded as JPEG. Dimensions are checked before
decoding, metadata is removed, aspect ratio is preserved, and the upload is
limited to 1,000,000 bytes. The final image is stored locally by its content hash.

The configured local/GPT agent receives the actual prepared pixels. It checks
relevance, visual quality, misleading depictions and illegible text, and writes
an accessible description of what is visible. The goal is an editorial
illustration, not a fabricated product screenshot, testimonial or results chart.
Visual rejection can trigger two revised renders with specific feedback. The
reviewer supplies a complete replacement composition, saved before rendering;
Signal does not append warnings to the same defective art direction. Prompts
describe the intended visible scene positively, including blank surfaces where
appropriate, instead of requesting printed data and then forbidding text. After
three unsuitable renders, the campaign needs attention and does not publish.
Model review reduces errors but does not guarantee visual accuracy or usefulness.

Local review requires a working vision-capable model. Settings has a separate
**Local image-review model** field; leaving it blank uses the marketing model.
The installed Windows Ollama 0.32.5 with Gemma 4 E4B described absent people and
branding during actual campaign checks. An
[upstream Windows vision issue](https://github.com/ollama/ollama/issues/16532)
and [proposed projector fix](https://github.com/ollama/ollama/pull/16879) match
this failure. Use a separately validated vision model or GPT for image review.
With GPT selected, the generated
image goes to the configured OpenAI account, uses the request allowance and may
incur API charges. The adapter uses Responses image input and `store:false`.
No account credentials are supplied to the reviewer. Native Ollama composition
and review use a 16K context window and release model memory after completion.
The worker requests ComfyUI memory release only after its queue is idle.
Image work shares Signal's model slot with marketing and sales generation.
Stopping an owned Windows Ollama server also stops its child model runners;
externally started servers are left running.

## Recovery and boundaries

The image requirement and its render identity are saved with the campaign before
work starts. Restart or a lost render acknowledgement retains that identity.
An uncertain submission is checked through ComfyUI history instead of starting
another render. Revisions create new render identities while retaining the same
publication identity. Old renders remain available in Creative studio.

The approved file's bytes must still match its stored hash before upload.
Bluesky's returned blob must match the expected content identifier, type and size.
Publication recovery reads the original post ID and checks its text, timestamp,
image, description and aspect ratio. A matching prior publication can be
confirmed without uploading again. An image upload alone is never a published
campaign, recipient impression or sale.

Pause prevents new uploads and publication attempts. It cannot retract a request
already accepted remotely. Cancelling an unattempted campaign leaves a local
render intact. Saving a changed policy cancels queued work. Retry preserves an
uncertain original render; known failed/cancelled local jobs can be replaced
through an explicit retry. A failed image campaign never silently publishes text
in place of its required image.

This path currently publishes one still image on Bluesky. Website image hosting,
video validation/uploads, other social destinations, cross-application GPU
coordination and real account delivery still require their respective work.
Other applications can consume GPU memory independently of Signal.

## Research and validation

Implementation sources:

- [ComfyUI server routes](https://docs.comfy.org/development/comfyui-server/comms_routes)
  and [server implementation](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py)
  for local queue, prompt, output and memory-release handling.
- [Bluesky image embed schema](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/embed/images.json)
  and [blob upload contract](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/uploadBlob.json)
  for image limits and post records.
- [Ollama vision input](https://docs.ollama.com/capabilities/vision) and
  [OpenAI images and vision](https://developers.openai.com/api/docs/guides/images-vision)
  for sending pixels to the reviewer.
- [Black Forest Labs positive prompting guidance](https://docs.us.bfl.ai/guides/prompting_guide_t2i_negative)
  for describing the desired scene instead of relying on negative instructions.

`tests/operations/images.test.ts` covers generation, pixel review, revisions,
restart, queue ownership, uncertain submissions, altered files/remote embeds,
Pause, cancellation and publication recovery using simulated transports.
`scripts/operation-image-local-smoke.ts` runs real installed local models and
public research with intercepted publication. It never uses owner credentials.
`scripts/operation-images-ui-smoke.mjs` checks the desktop controls and approved
image preview in a separate offline profile.

The 0.14 checkpoint completed real Krea rendering and Qwen 3.6 35B pixel review
for both Lemonade and CineGen, with simulated publication only. The artifacts
are in `data/operation-images-validation/local-lemonade.jpg` and
`local-cinegen.jpg`. Their reviewed descriptions matched the visible scenes.
Lemonade needed three compositions and CineGen one. These are basic illustrations;
branded layouts, product demonstrations and video still need their own workflows.

A separate Qwen 3.5 9B check accurately described both saved images in about
8–10 seconds each (`vision-local-check.json`). Its subsequent full Lemonade
campaign attempt did not queue a valid publication (`local-qwen9.log`), so this
is evidence for image description only, not a validated replacement for the
campaign-writing model. The earlier successful campaign artifacts remain intact.
