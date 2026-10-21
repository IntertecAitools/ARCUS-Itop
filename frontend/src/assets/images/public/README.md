# Public-page imagery

The landing page, the sign-in / password-reset screens and the end-user portal
show the pictures in this folder. Every file here is an **abstract
placeholder** drawn for this app (shapes and lines in the deep-green palette),
not a photograph — swap in your organisation's own photos whenever you have them.

| Slot (`index.ts`) | File            | Where it shows                          | Shape    |
| ----------------- | --------------- | --------------------------------------- | -------- |
| `hero`            | `hero.svg`      | Landing hero; sign-in side panel        | 3 : 2    |
| `requests`        | `requests.svg`  | Landing, "Follow it to the finish" row  | 9 : 7    |
| `answers`         | `answers.svg`   | Landing, "Find answers yourself" row    | 9 : 7    |

## Replacing a picture

1. Put your photo in this folder (JPEG or WebP, around 2400 px on the long
   side, under ~400 KB).
2. In `index.ts`, change the import for that slot, e.g.
   `import hero from './office-desk.webp';`
3. Pictures are cropped to fill their frame (`object-cover`), so keep the
   subject near the centre. Darker photos suit the dark look best.

Use only photos your organisation has the rights to. The pictures are
decorative (`alt=""`): the text next to them carries the meaning.
