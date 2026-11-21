# Alex TikTok creator account setup

Updated October 22, 2026. This replaces the earlier Lemonade-branded account recommendation.

Alex's channel promise is **life, slightly easier**: relatable everyday frustrations, dry humor and useful discoveries. Lemonade is the first product campaign. His identity and audience can support other relevant offers over time.

| Field | Setup |
|---|---|
| Account type | Personal, public; use creator tools in TikTok Studio |
| Handle | `@alexslightlybetter` (created; observed in the account browser title) |
| Backups | `@slightlybetterwithalex`, `@alexmakesitsimple` |
| Display name | Alex \| Slightly Better |
| Bio | Life, slightly easier. Useful finds, dry humor. Fictional AI creator. |
| Profile image | [Alex at home](../output/alex-creator/alex-profile-v2-room.png), natural seated portrait with window light and a lived-in workspace; saved, not uploaded |
| Recurring filming space | Walnut desk beside a window, bookshelf and plants, olive sofa and cream throw; room reference saved in the shared account configuration |
| Visual identity | Espresso, cream and occasional yellow; the outfit is personal style |
| Website | Creator-branded useful-finds page once built and linking is available |
| First product | Lemonade, with its own campaign links and measurement |

Use the real operator's details for account ownership, age, verification, payment and tax information. Alex is the fictional presenter. Enable two-step verification and make the profile public. If the account already exists, inspect its actual settings before changing them.

TikTok identifies Personal accounts as suitable for creators and recommends Business when promoting your business is the primary purpose. The current plan is audience-led creator content with occasional disclosed product features. Reassess if it becomes mainly a storefront. TikTok lists profile website links for Personal accounts at 1,000 followers; check availability in the app. Neither link access nor monetization access has been verified. [Account types](https://support.tiktok.com/en/using-tiktok/growing-your-audience/switching-to-a-creator-or-business-account)

## What people follow Alex for

Audience: adults juggling work, digital clutter and everyday routines. Alex notices the annoying detail and offers a friendly observation or a small useful fix. His delivery is warm, approachable and informative. Visual direction uses relaxed brows, gentle eye contact and natural mouth movement; avoid smirking, eyebrow punchlines and a fixed grin. The approved voice stays consistent, with a subtle room-sound treatment being reviewed for the home filming space.

Recurring series:
- **Why is this a thing?** Everyday annoyances and recognizable work/life sketches.
- **One small fix.** Useful routines, digital organization and simple shortcuts.
- **Worth the space?** Thoughtful software, desk/home finds and occasional style.

Start with ten relatable entertainment posts, three useful standalone posts and one commercial post per fourteen posts. This is a starting experiment, not a platform rule. The three existing Lemonade scripts are alternative commercial slots, not the opening three posts.

Pin an introduction to Alex and his fictional AI identity, a relatable sketch, and a useful standalone tip. Organic posts can end on a payoff or relevant question; a purchase CTA is optional.

## Content modeling

Research current formats across the three pillars. Record source URLs, dates, direct metrics and creator baselines. Watch the videos before deconstructing their hooks, timing and payoffs. Keep paid inspiration separate from organic breakout evidence.

Create an original Alex situation, script and visual execution. Choose entertainment, practical value or commercial intent before scripting. Product integration must serve an existing audience problem. Use an original-test label when current breakout evidence is unavailable.

Track watch time, completion, shares, saves, returning viewers, follows per 1,000 views and comment themes. Track clicks, trials, sales and revenue separately for each commercial campaign.

## Products over time

Lemonade fits digital-clutter and work-life stories. Later affiliate offers or owned products should solve problems already present in the audience's comments and content. PLR requires useful content and verified resale rights.

Plan a creator-branded useful-finds hub with separate disclosed links and tracking for each offer. No hub or domain has been created. Lemonade's website remains its own checkout destination.

Alex narrates real demonstrations captured by the operator. Do not invent personal purchases, product use or results as genuine testimonials. Relatability comes from recognizable situations and delivery.

Commercial posts need the appropriate disclosure: own-product promotion uses Promotional content; incentivized third-party work uses Paid partnership. State the actual commission, sponsorship or gifted relationship clearly. [Commercial disclosures](https://support.tiktok.com/en/business-and-creator/creator-and-business-accounts/promoting-a-brand-product-or-service)

Use the AI-generated label for Alex's realistic synthetic content. His bio provides additional context. [AI labels](https://support.tiktok.com/en/using-tiktok/creating-videos/ai-generated-content/)

Commercial videos require commercially cleared audio; Personal account access to a popular sound does not establish commercial rights. [Commercial music](https://support.tiktok.com/en/business-and-creator/creator-and-business-accounts/commercial-use-of-music-on-tiktok)

Check TikTok Shop affiliate and product eligibility before adding shopping features. This setup grants neither.

## Saved setup and current status

The shared account strategy lives in [account.json](../campaigns/alex-creator/account.json). Lemonade remains a separate [product campaign](../campaigns/lemonade-tiktok/campaign.json).

Research now defaults to creator-wide interests; `research campaign` selects Lemonade. The current `prepare` command still creates the three Lemonade commercial plans. Three creator-first original launch scripts are saved in `campaigns/alex-creator/launch-briefs.json`, and the separate supervised renderer accepts room references plus the persistent narration WAV.

The owner confirmed account creation. Metricool reports TikTok display name `Alex | SlightlyBetter` connected to brand `7428314`; the browser window title shows `@alexslightlybetter`. Posting is authorized by the owner. Ryan's first Qwen voice and delivery were approved on October 22. The first full talking take decoded successfully but was rejected for unnatural mouth movement and blurred eyes. Warmer performance, guided rendering and room-audio trials are in progress. No first post has been published. The local upload handoff was also blocked because Computer Use could not reliably verify the browser URL and stopped interaction.
Expand Learning Studio into a platform where people can create separate classrooms for different subjects, receive a personalized curriculum, and learn through exercises appropriate to that subject.

Also fix the teaching gaps documented below. These are product and lesson-generation requirements, not just changes to one lesson.

Inspect the actual application, persistence layer, MCP tools, tutor instructions, and existing tests first. Implement the feature end to end, preserving existing learner work. Do not stop at a proposal or a UI mockup.

1. Preserve existing classrooms and progress

The current Python/ML/cloud course must remain intact, including its lesson IDs, drafts, attempts, reviews, mastery, and practice history.

Introduce separate classrooms with their own:

Subject, learner goal, starting knowledge, and desired depth.

Curriculum, prerequisites, lessons, and current position.

Exercise state, attempts, feedback, and mastery.

Teaching preferences and saved accommodations.

Add a classroom library, “Create classroom,” and a classroom switcher. Switching classrooms must restore the correct saved state without opening duplicate tabs or leaking progress between subjects.

Migrate the existing course into a classroom without resetting anything. Scope server-side reads and writes to the authenticated user and intended classroom.

2. Ask what the learner wants to accomplish

Creating a classroom should start a short, adaptive conversation rather than a large form.

Ask questions that materially affect the curriculum:

What subject or skill do you want to learn?

What would you like to be able to do afterward?

What do you already know?

How much do you want to learn: an introduction, practical competence, or deeper study?

How much time can you spend, and is there a deadline?

Are there particular areas to include or skip?

Which formats or accessibility options help you learn?

Ask subject-specific follow-ups when necessary. For anatomy, distinguish general familiarity, an introductory course, and preparation for a particular exam. For marketing, distinguish understanding the basics from learning to market an actual product.

Offer a lightweight diagnostic when useful, but do not force experienced learners through introductory material. Let learners revise their goals and depth later.

Present a proposed curriculum with its scope, prerequisites, intended outcomes, and approximate effort. Make clear that effort estimates are estimates. Allow revisions before starting.

3. Teach the reasoning before assigning the exercise

The Learn section must be a self-contained teaching guide, not a summary followed by unexplained instructions.

For each new operation or concept:

Explain its purpose in plain language.

Define unfamiliar terms.

Show a small worked example.

Identify what goes in and what comes out.

Explain how to interpret the result.

Connect it to the next step.

Map the example to the exercise’s names or objects without giving away the completed solution.

Use readable headings, paragraphs, inline code, code blocks, labeled diagrams, and other appropriate media. Keep the Syntax guide as a compact reference.

Teach concepts in dependency order. Do not require an operation before explaining it. Split overloaded lessons into smaller lessons rather than burying the learner in terminology.

4. Fix the specific gaps observed in our lessons

These are concrete examples of what the product must prevent:

“Fit training pairs, then calculate both errors” hides several operations. Explain fitting, predicting, comparing guesses with actual answers, and storing the result separately.

Show exactly what belongs inside a function call. Explain that prediction receives feature inputs and returns estimates; actual answers are used afterward for assessment.

Make variable roles visible. Distinguish a model name, a model object, a dictionary lookup, an error score, and a table.

Explain which object an instruction refers to. “Inspect the tree” must specify the deep tree, shallow tree, or selected model.

Distinguish column labels from variable names, such as the "load" column and the loads input list.

Explain terms such as “comparison,” “structure,” “baseline,” “validation,” and “report” before requesting them.

Explain the source of every reported value. A report field may retrieve an earlier result rather than calculate something new.

Clearly distinguish worked-example names from exercise names.

Make required imports easy to identify and explain where each imported tool comes from.

Explain metrics with units, denominator, direction of improvement, a numerical example, and limitations.

Label confusion-matrix axes and explain that cells count outcomes rather than identify individual examples.

Add a lesson-authoring validation step that checks whether required concepts and operations were introduced before the exercise.

5. Teach students how to read their output

Output presentation is part of learning.

Before asking students to print or interpret results, teach a suitable structure:

A summary table for comparing alternatives.

A detailed table pairing each input with its actual outcome and prediction.

Clear labels, units, headings, and sensible display precision.

Labeled diagrams or highlighted objects for visual subjects.

Explain what each row, column, symbol, or visual state represents. Keep formatting separate from stored calculations.

Do not fail otherwise correct work over arbitrary output wording unless exact output is itself the learning objective. When a required variable or schema name differs, identify that as a contract mismatch rather than a conceptual or mathematical failure.

6. Build an extensible exercise system

Separate shared learning behavior from subject-specific interaction.

Create a versioned exercise contract and a registry of supported exercise types. Each type should define:

Its authoring schema and validation.

Its interactive renderer.

Its saved learner-state format.

Its submission and attempt-evidence format.

Its checking or assessment strategy.

Its hint and feedback behavior.

Its accessibility requirements.

Any required assets or runtime capabilities.

Retain the existing coding runtime as one exercise type. Do not force every subject into a code editor or multiple-choice quiz.

Support shared primitives where appropriate: structured responses, labeling, ordering, matching, annotations, calculations, scenario decisions, and project submissions.

Curriculum generation should select from capabilities that actually exist. If a requested interaction is unsupported, explain the limitation and offer a suitable supported alternative. Do not generate a lesson that promises a nonexistent simulator.

Render structured, validated lesson content through trusted components. Do not execute arbitrary generated scripts or HTML as lesson content.

7. Implement real subject-specific interactions

Deliver a working vertical slice for these classrooms.

Coding

Preserve the editor, runnable incomplete starters, stdout, tracebacks, saved runs, meaningful checks, and tutor review.

Anatomy

Provide an interactive anatomical representation inside the classroom. Students should be able to explore structures, select them, see explanations, and practice identification.

Include:

A coherent body overview and at least one fully implemented system.

Selectable structures with stable identifiers.

Labels that can be shown for learning and hidden during practice.

Relevant system/layer controls.

Zoom and navigation appropriate to the representation.

Identification exercises such as “Select the structure described.”

Feedback explaining location, function, and relationships—not just right or wrong.

Saved progress tied to structures and learning objectives.

Prefer an accurate, appropriately licensed 3D model when feasible, with an accessible labeled 2D alternative. If the first implementation is 2D, describe it honestly and make it useful. A placeholder silhouette or decorative image does not satisfy the requirement.

Store asset provenance, attribution, licensing, and content references. Do not invent anatomy or treat generated artwork as an authoritative anatomical source.

A non-coding subject such as marketing

Include an exercise that requires applying judgment—for example, identifying an audience and drafting a positioning statement for a supplied scenario. Save the learner’s work and assess it against an explicit rubric.

Separate objectively checkable requirements from qualitative feedback. Do not present subjective marketing judgments as deterministic facts.

The purpose is to prove that the platform supports different learning interactions, not merely different text in the same coding classroom.

8. Keep assessment grounded in actual learner work

Preserve the teaching loop:

Learn → attempt → feedback → understanding check → mastery → next step.

For each exercise, record the relevant evidence: executed code, selected anatomical structures, ordered steps, submitted calculations, written answers, or project artifacts.

Use deterministic checks where appropriate and explicit rubrics where judgment is required. Passing checks alone does not automatically establish understanding.

Give focused feedback, explain the exact gap, and ask one brief interpretation or transfer question when needed. Avoid repeated restatement quizzes after understanding is demonstrated.

Make checks independent. One failed check must not cause later checks to fail because a shared reference variable was never created.

Record mastery only after the evidence supports it. Preserve the difference between incomplete work, a coding mistake, a schema mismatch, and a conceptual misunderstanding.

9. Update the actual tutor and tool contracts

Implement these behaviors in the application’s real tutor instructions, authoring prompts, tool descriptions, schemas, and validation—not only in a local note or this conversation.

Make classroom context explicit in classroom-related tools. Prevent stale requests from applying a run, review, lesson update, or mastery decision to the wrong classroom.

Use read-only workspace tools for routine reviews. Reuse the existing classroom panel; open or navigate only when requested or necessary.

Preserve read-aloud support. Teach and read lesson content in a sensible sequence, including useful descriptions of diagrams and code. Avoid exposing correct labels through accessibility text while a hidden-label identification exercise is being assessed.

Do not introduce a new paid model dependency without identifying it and confirming that it is necessary. Preserve the current tutoring integration wherever possible.

10. Verify complete learner journeys

Test and inspect these flows:

Existing learner opens the migrated Python classroom with all saved work intact.

Learner creates an anatomy classroom, answers scope questions, reviews a plan, opens a lesson, interacts with the anatomy representation, submits an identification attempt, receives feedback, and resumes later.

Learner creates a marketing classroom and completes a rubric-based exercise.

Learner switches among classrooms without state crossing between them.

An unsupported exercise request receives an honest fallback.

A failed check produces a useful explanation without cascading failures.

Duplicate submissions, stale classroom context, refreshes, and interrupted sessions preserve consistent state.

Verify desktop and narrow-screen layouts, keyboard navigation, screen-reader behavior, readable code blocks and tables, anatomical selection, saving, and restoration.

Implement in coherent stages, keeping each stage usable. Report what was implemented, tested, and left incomplete. Distinguish local validation, deployment, and verified live behavior. Do not claim universal subject coverage or a complete anatomy system from a limited initial implementation.
[Pipeline guide](../apps/avatar-marketing/README.md)
