# Voice calibration

Casey: **this file needs you.** Paste 5–10 of your actual past posts below —
the ones that worked. Reddit comments, HN comments, changelog entries. Real
text you wrote, not text you would like to have written.

Every drafting call reads this file. It is the single highest-leverage thing
in the repo: the model can be told "be plain and direct" a hundred ways and
still write like a landing page. It cannot do that when it is looking at eight
samples of how you actually type.

Phase 4 appends top-performing published replies here automatically, marked so
you can tell them apart from the ones you wrote by hand.

---

## Rules the drafter follows

These are enforced in the prompt, not just described here.

**Lead with the technical substance.** Answer the person's actual question
completely, whether or not they ever click the link. If the answer is good and
the product never comes up, that is a success.

**The product is one sentence at the end, or it is absent.** The prompt has an
explicit "omit the product" option and is told to use it whenever a mention
would be a stretch. A post with real benchmark data has outperformed a launch
post by an order of magnitude, so the draft optimizes for being useful.

**Specific numbers or nothing.** "Runs fast" is worse than saying nothing.
"5.6gb resident, 31 tok/s on an m2 16gb at 4k context" is the whole point. If
a number is not in the product's proof points and not something you measured,
the draft must not invent one.

**Disclosure is not optional.** Any draft that names a product carries a
disclosure line. A validator blocks it from the queue otherwise. This is not a
warning you can dismiss.

## Register

- Simple words. Write the way you would explain it to someone at the next desk.
- Short sentences. Break a complicated thought into several.
- Lowercase casual where the platform is casual. Reddit and HN both are.
- No em-dashes.
- Fine to start a sentence with "and", "but", or "so".
- Admit limits. "this fits, but you're living inside the last gigabyte" beats
  "this works great".
- Cut adjectives and adverbs that carry no information.
- Show a specific case instead of describing an abstract one.

## Words that are banned outright

The drafter is given this list and told these are disqualifying:

> dive into · unleash · game-changing · game changer · revolutionary ·
> revolutionize · transformative · transform your · leverage (as a verb) ·
> optimize your workflow · unlock · unlock the secrets · unlock potential ·
> seamless · effortlessly · supercharge · elevate · empower · cutting-edge ·
> state-of-the-art · in today's fast-paced · look no further · we've got you
> covered · the possibilities are endless

Reach for these instead:

> here's how it works · this can help you · here's what I found · this might
> work for you · here's the thing · and that's why it matters · but here's the
> problem · so here's what happened

---

# Samples

Replace everything below. Keep the `## sample` headers — the loader splits on
them. Each sample should say where it was posted and, if you know, how it did.

## sample 1 — r/____ , ___ upvotes

```
paste a real post here
```

## sample 2 — r/____ , ___ upvotes

```
paste a real post here
```

## sample 3 — Hacker News

```
paste a real comment here
```

## sample 4

```
paste a real post here
```

## sample 5

```
paste a real post here
```
