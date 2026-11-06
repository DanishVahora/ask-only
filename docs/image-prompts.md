# Image prompts

Four images. Paste each prompt as-is into ChatGPT (GPT Image) or Midjourney. They are written
to produce one coherent set, not four unrelated pictures.

**Where they go** — save into `app/public/img/` with these exact names:

| File | Section | Aspect |
|---|---|---|
| `hero.webp` | under the hero headline | 16:9 |
| `enclave.webp` | the forest band, "4 of 12 lines" | 3:2 |
| `expiry.webp` | the forest band, retention | 3:2 |
| `close.webp` | the closing section | 16:9 |

If a file is absent the slot renders nothing at all — no dashed box, no caption. So you can add
them one at a time and the page is never broken.

---

## The art direction (read this once)

Everything is **still-life photography**, not illustration, not 3D, not AI-art. Three materials
only: **aged bronze or brass**, **ivory bookbinding cloth**, and **blank uncoated paper**. One
soft window light raking from the upper left through a slatted blind, so there are soft parallel
shadows. Shallow depth of field. Generous empty space.

The background is a **seamless warm ivory sweep, hex #FFFEEB**, which is the page colour — that
is what makes the image sit on the page with no visible rectangle.

Two hard rules, both load-bearing:

1. **No red, no orange, no amber anywhere.** Clay red means "refused" in this interface; a red
   object in a photograph would read as a status.
2. **No text, no letters, no numbers, no logos, no screens, no UI.** The type on the page is the
   type. An image with words in it fights the headline and is the fastest way to look generated.

Also avoid: people, hands, faces, lens flare, bokeh balls, glowing edges, neon, gradients,
holograms, circuit-board motifs, padlock clichés, glossy plastic, and anything that looks like
a stock photo of "security".

---

## 1 — `hero.webp` · the document that does not move

The idea: everything around it has moved; **the paper has not**.

```
Still-life photograph, 16:9, horizontal.

A single sheet of blank ivory uncoated paper lies perfectly flat on a seamless warm ivory
background (#FFFEEB). The sheet is held down at one corner by a small, heavy aged-bronze
paperweight with a plain geometric form — no engraving, no text.

Rising from the sheet and travelling to the right, a single fine brass wire arcs out of frame,
and one small polished brass bead sits on that wire, clearly in motion, well away from the
paper. The bead is the only thing that has left.

One soft window light rakes from the upper left through a slatted blind, casting soft parallel
shadow bars across the background but falling only gently on the paper. Shallow depth of field:
the paper and paperweight are sharp, the bead slightly soft, the far end of the wire out of
focus.

Muted, warm, desaturated palette: ivory, bone, aged brass, soft grey-green shadow. No red, no
orange, no amber. No text, letters, numbers, logos, screens or UI anywhere. No people or hands.

Composition: the paper and paperweight sit in the lower-left third; the upper-right two-thirds
are near-empty background for breathing room. Calm, precise, editorial — like a photograph from
a well-printed design annual.
```

---

## 2 — `enclave.webp` · the sealed box with a narrow slot

The idea: the model is **inside** something sealed. Only a sliver goes in.

```
Still-life photograph, 3:2, horizontal.

A small, closed, aged-bronze box with precise machined edges sits on a seamless warm ivory
background (#FFFEEB). The box is entirely sealed — no hinge visible, no opening — except for one
narrow horizontal slot on its face, about the width of a card.

A single thin strip of ivory paper, cut from a larger sheet, is part-way into the slot. Beside
the box, the remainder of that sheet lies flat and clearly mostly intact — visibly much larger
than the narrow strip that was taken from it. The proportion between the small strip and the
large remaining sheet is the subject of the photograph.

One soft window light from the upper left through a slatted blind; soft parallel shadows fall
across the ivory ground and over the far edge of the sheet. The bronze has a soft satin finish
with gentle specular highlights, not mirror-polished.

Muted warm palette: ivory, bone, aged bronze, soft neutral shadow. No red, orange or amber. No
text, letters, numbers, logos, screens or UI. No people or hands. Shallow depth of field, the
slot and the strip sharpest.

Composition: box slightly right of centre, the large remaining sheet running off the left edge,
clear empty space above.
```

---

## 3 — `expiry.webp` · the seal that was allowed to lapse

The idea: **two outcomes, and the quiet one is the default.** This image is the asymmetry.

```
Still-life photograph, 3:2, horizontal.

Two small objects on a seamless warm ivory background (#FFFEEB), separated by a clear span of
empty space.

On the left: an aged-bronze wax-seal stamp lying on its side, unused, its face clean. Beneath it
a sheet of blank ivory paper with a faint circular impression where a seal once was — the
impression is empty, no wax, nothing remaining. This side is softly lit and quiet.

On the right: the same kind of sheet, but here a bronze clamp holds it firmly shut, and a short
length of fine brass wire is twisted tight around the clamp — deliberate, effortful, obviously
an action someone took.

One soft window light from the upper left through a slatted blind. The parallel shadow bars are
noticeably stronger and longer on the right-hand object than the left, so the right side feels
weightier and more deliberate.

Muted warm palette: ivory, bone, aged bronze, deep neutral shadow. No red, orange or amber. No
text, letters, numbers, logos, screens or UI. No people or hands.

Composition: generous empty ivory between the two halves; neither object centred.
```

---

## 4 — `close.webp` · nothing to delete

The idea: there is **no copy to destroy**, because one was never made.

```
Still-life photograph, 16:9, horizontal.

A small, empty aged-bronze tray or shallow dish sits on a seamless warm ivory background
(#FFFEEB). The tray is completely empty and immaculately clean — nothing in it, no shadow of a
missing object, no dust, no residue.

Beside it, just outside the tray, a single sheet of blank ivory paper lies flat and undisturbed,
exactly where it has always been. The relationship is the subject: the tray is where a copy
would have gone, and no copy was ever placed in it.

One soft window light from the upper left through a slatted blind. The shadow bars fall across
the empty tray, and the emptiness of the tray is the most lit, most visible part of the frame.

Muted warm palette: ivory, bone, aged bronze, soft neutral shadow. No red, orange or amber. No
text, letters, numbers, logos, screens or UI. No people or hands. Shallow depth of field.

Composition: tray in the right third, paper lower-left, the upper-centre left almost entirely
empty background. Restrained and quiet — the image should feel like an ending.
```

---

## After you generate them

1. Save as `.webp` (or `.jpg` — change the filename in `index.html` to match) into
   `app/public/img/`.
2. Keep each under ~250 KB so the page stays fast on venue wifi.
3. The CSS already applies `mix-blend-mode: multiply` on cream sections, so if the generated
   ivory ground is a shade off it blends into the page instead of showing a rectangle. On the
   forest bands the image is shown normally — so for `enclave.webp` and `expiry.webp`, prefer a
   generation where the ground is clean and even.

If one comes back with text in it, or anything red, regenerate rather than shipping it — both
would read as a UI state rather than a photograph.
