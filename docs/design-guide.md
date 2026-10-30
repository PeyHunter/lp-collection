# Design guide: Gig poster

LP-Collection uses the "Gig poster" look. The page is dark brown, the text is cream, and the collection stats are set in very large stacked type like a concert poster. The sections below the poster are calm. The Owner chose this direction from ten home-screen variants (ticket #3).

The throwaway prototypes in `prototypes/gig-poster/` show every rule in this guide. Open them in a browser at phone width, or see the screenshots in `prototypes/gig-poster/screenshots/`. Run `node prototypes/gig-poster/shoot.mjs` from the repo root to take them again. The script fails if a page scrolls sideways, a font does not load, or a tap target is smaller than 44px.

All CSS follows the project's good-css skill (`.claude/skills/good-css/`). The rules that matter most here:

- Write logical properties (`inline`, `block`), never left, right, top, or bottom.
- Write colors in `oklch()`. Derive tints and pressed states with `color-mix(in oklch, ...)`.
- Write no width `@media` queries. Poster type scales with its container (`cqi`), and lists stay one column.
- Put every `:hover` rule inside `@media (hover: hover) and (pointer: fine)`. Give everything pressable an `:active` state.
- Style focus with `:focus-visible` and `outline`. Never write `outline: none`.
- Put every transform transition inside `@media (prefers-reduced-motion: no-preference)`.
- Pad the header and the bottom bar by the safe-area insets, with `viewport-fit=cover` in the viewport meta tag.

## Fonts

| Role | Font | Weights |
| --- | --- | --- |
| Display: poster type, headings, numbers that matter | Unbounded | 600, 700, 800, 900 |
| Body: everything else | Instrument Sans | 400, 500, 600, 700 |

The prototypes load both fonts from Google Fonts. The real app self-hosts them: the variable `woff2` files live in `src/web/public/fonts/` with their OFL licenses, split into a Latin and a Latin Extended file per font by `unicode-range`. `src/web/styles.css` declares them with `@font-face` and `font-display: swap`, and `src/web/index.html` preloads the two Latin files. Self-hosting keeps the app working offline as a home-screen app and sends no requests to Google. The reset sets `font-synthesis: none`, so load every weight above or the browser renders it as regular.

Use the font tokens, never a font name:

```css
:root {
	--display: "Unbounded", ui-sans-serif, system-ui, sans-serif;
	--body:    "Instrument Sans", ui-sans-serif, system-ui, sans-serif;
}
```

## Color tokens

The app has one theme, dark. `color-scheme: dark` is set on `:root` and in a `<meta name="color-scheme">` tag. If a light theme comes later, turn each token into a `light-dark()` pair rather than adding a second block.

```css
:root {
	--bg:          oklch(24% 0.04 50);
	--surface:     oklch(28.5% 0.045 50);
	--sunk:        oklch(20% 0.035 48);
	--ink:         oklch(93% 0.035 85);
	--ink-dim:     color-mix(in oklch, var(--ink) 66%, var(--bg));
	--ink-faint:   color-mix(in oklch, var(--ink-dim) 85%, var(--bg));
	--line:        color-mix(in oklch, var(--ink) 18%, transparent);
	--accent:      oklch(62% 0.15 36);
	--accent-fill: oklch(56% 0.15 36);
	--accent-ink:  oklch(70% 0.14 40);
	--on-accent:   oklch(98% 0.01 85);
	--gain:        oklch(82% 0.12 140);
	--loss:        oklch(74% 0.13 25);
	--press:       color-mix(in oklch, var(--ink) 6%, transparent);
	--black:       oklch(0% 0 none);
	--white:       oklch(100% 0 none);
}
```

| Token | Use | Contrast on `--bg` |
| --- | --- | --- |
| `--bg` | Page background | |
| `--surface` | Raised cards, such as the Value facts | |
| `--sunk` | Inputs, the bottom bar, an empty cover | |
| `--ink` | Main text, the thick poster rules | 13.5:1 |
| `--ink-dim` | Secondary text, labels | 6.1:1 |
| `--ink-faint` | Row meta lines and hints only | 4.7:1 |
| `--line` | Thin dividers and control borders | |
| `--accent` | Large poster type only, such as "187 LABELS" | 4.3:1 |
| `--accent-fill` | Filled controls: Scan, primary buttons, the shelf marker | 3.3:1 |
| `--accent-ink` | Accent text at body size: kickers, links, "No Value yet" | 5.9:1 |
| `--on-accent` | Text on `--accent-fill` | 4.7:1 on the fill |
| `--gain`, `--loss` | A rising or falling Value, a positive or negative Gain | 9.9:1, 6.8:1 |

The contrast numbers are WCAG 2 ratios, computed from the token values. `--accent` is below 4.5:1, so use it only for large text. Cream text on `--accent` measures 3.7:1, so filled controls use the darker `--accent-fill`.

Never put `--ink-faint` text on `--surface`. It already sits near the 4.5:1 floor on `--bg`, and the lighter `--surface` takes contrast away. The same goes for any tinted row or card. Use `--ink-dim` for secondary text there.

Darken or lighten with `--black` and `--white`, never the keywords `black` and `white`, as in `color-mix(in oklch, var(--accent-fill), var(--black) 14%)` for a pressed fill. Their hue is `none`, so the mix keeps the accent's hue.

## Type scale

The body text is 1rem. Every size is in `rem`, so it follows the reader's text-size setting.

```css
:root {
	--text-2xs: 0.6875rem;
	--text-xs:  0.75rem;
	--text-s:   0.8125rem;
	--text-sm:  0.875rem;
	--text-m:   1rem;
	--text-l:   1.125rem;
	--text-xl:  1.375rem;
	--text-2xl: 2.125rem;
}
```

| Text | Font | Size | Weight | Notes |
| --- | --- | --- | --- | --- |
| Poster type | Unbounded | `cqi` of its container | 800 to 900 | Uppercase, `letter-spacing: -0.03em`, `line-height: 0.86` |
| Section heading | Unbounded | `--text-l` | 700 | Sentence case |
| Big amount (Value) | Unbounded | `--text-2xl` | 600 | `tabular-nums` |
| Row title | Instrument Sans | `--text-m` | 600 | Clamped to 2 lines |
| Body | Instrument Sans | `--text-m` | 400 | `line-height: 1.45` |
| Kicker and field label | Instrument Sans | `--text-xs` | 600 | Uppercase, `letter-spacing: 0.08em` to `0.14em` |
| Meta line | Instrument Sans | `--text-xs` | 400 | One line, ellipsis |

Poster type sizes come from container units, so a line fills the width of its block at any phone size. The element that holds poster type sets `container-type: inline-size`. The prototypes size each line by hand, such as `31cqi` for "612" and `13.2cqi` for "187 LABELS". Size a new line so that its longest real value still fits. Set `white-space: nowrap` and `text-overflow: ellipsis` on a poster line that shows user data, such as a group heading.

Put `font-variant-numeric: tabular-nums` (the `.tnum` class) on Values, counts, and Catalog numbers.

## Motion

```css
:root {
	--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
}
```

Press feedback scales with `scale` over 160ms on `--ease-out`, inside `@media (prefers-reduced-motion: no-preference)`.

## Spacing and radii

```css
:root {
	--space-3xs: 0.125rem;
	--space-2xs: 0.25rem;
	--space-xs:  0.5rem;
	--space-s:   0.75rem;
	--space-m:   1rem;
	--space-l:   1.5rem;
	--space-xl:  2.25rem;

	--radius-s:    0.375rem;
	--radius-m:    0.625rem;
	--radius-pill: 999px;

	--tap: 44px;
	--gutter: 1rem;
}
```

- `main` is a content grid with a `1rem` gutter and a `30rem` content column. Sections in `main` sit `--space-xl` apart, set by the grid's `row-gap`.
- Parents set the space between their children with `gap`. Children carry no block margins.
- Covers and photos use `--radius-s`. Cards and inputs use `--radius-m`. Buttons, chips, and the Scan button use `--radius-pill`.
- Every tap target is at least `--tap` (44px) in both directions.

## Components

### Poster headline

The poster headline is large uppercase Unbounded type that fills the width. Use it once near the top of a screen ("THE RECORDS", "KIND OF BLUE", "C4") and for group headings in the Collection list ("THE 70s", "2.000+ KR", "B"). A 2px `--ink` rule sits above the headline. One word or one number per line can take `--accent`.

### Stat block

A stat block is the home-screen poster: big numbers stacked with their labels ("612 LPS", "341 ARTISTS", "187 LABELS"), a lineup of top artists in falling sizes, and "DOORS" and "CURFEW" for the oldest and newest record. The Period chart and the genre split follow. Small facts go last, in body type as `dt` and `dd` pairs. Collection stats come first on the home screen. Value comes second, as a calm section.

### Section heading

A section heading is Unbounded at `--text-l` over a 2px `--ink` rule. An optional action ("See all", "Open shelf") or count sits at the end of the row. The action is a link at least 44px tall.

### List row

A list row is the cover, then the title, artist, and meta line, then the Value. The title link covers the whole row with an `::after` overlay, so a screen reader reads only the title as the link. The title clamps to two lines. Artist and meta lines cut to one line with an ellipsis. Press gives `--press` behind the row, and focus draws an outline around the whole row. A Copy with no cover shows a drawn record on `--sunk`, never an empty box.

### Value and "No Value yet"

- A Value is a number in Unbounded with a small `kr` in Instrument Sans, using Danish formatting such as `4.850 kr`.
- A change in Value is `--gain` or `--loss` text with an arrow, the amount, the percentage, and the period, as in "↑ 450 kr (+10,2 %) 12 mo".
- The Lowest listing is a smaller second line in `--ink-dim` under the Value. It never takes the Value's place.
- A Copy with no Value shows "No Value yet" in `--accent-ink` at `--text-xs`, never `0 kr` and never a dash. When sorted by Value, these Copies sit last in their own group, whichever direction the sort goes.
- No price stickers. A Value is plain type, never a tag or a badge.
- The Value history is a line chart: a `--ink` line, an `--accent` gradient below it, and a dot on the latest point.

### Bottom bar with Scan

The bottom bar is sticky at the bottom with a 2px `--ink` rule on top, `--sunk` at 92% behind it, and the bottom safe-area inset as padding. It holds Home, Scan, and Collection. Until the home screen exists, the Home cell stays empty. Scan sits in the middle as a pill of `--accent-fill`, 3.5rem tall, with an uppercase Unbounded label. The current tab is `--ink`, and the other tabs are `--ink-dim`. On Lookup, Scan is the current page and gets a ring. At large text sizes Scan may move off center: a side cell never gets narrower than its label, so the empty Home cell gives up its room first.

### Buttons

| Kind | Look | Use |
| --- | --- | --- |
| Primary | `--accent-fill` pill, `--on-accent` text | The one main action, such as "Add another" or "Look up" |
| Secondary | 1.5px `--ink` border | The other choice, such as "Cancel" |
| Quiet | 1.5px `--line` border, `--ink-dim` text | Tools, such as "Adjust grid" |
| Danger | `--loss` text and border | "Delete this Copy" |

Buttons are at least 3rem tall. Press scales them to 0.97, and the transition sits inside the reduced-motion query.

### Fields and chips

Inputs and selects are 3rem tall on `--sunk` with a `--line` border, at `max(16px, 1rem)` so iOS does not zoom. A select keeps the native picker. The note field grows with its text (`field-sizing: content`). Sort options are radio chips. The checked chip fills with `--ink`.

### Loading, empty and error states

Every screen that fetches has all three, in the place the content would go.

- **Loading.** One line of `--ink-dim` text that names what is coming ("Loading your Collection…", "Asking Discogs…"). It pulses gently, only under `prefers-reduced-motion: no-preference`. The region around it sets `aria-busy`. The button that started it is disabled and says what it is doing ("Looking…", "Adding…").
- **Empty.** A sentence in `--ink-dim` that says what is missing, then the next step as a primary button or a hint. The empty Collection says "No Copies yet." with "Add your first record". A Lookup with no match names the barcode and says to check the digits.
- **Error.** A `--surface` card with a thin `--loss` border and `role="alert"`, saying what failed and what to do. A failed load gets a quiet "Try again" button. A failed save keeps the picked Release, so one tap retries.
- **Done.** After a save, the next screen shows a `--surface` card with a thin `--gain` border and `role="status"` ("Added Kind of Blue to your Collection."), and tints the new row with 10% `--accent`. The tint and the pressed background reach `--space-s` past the row on each side, so the cover and the Value never touch their edges while the row text stays in line with the rows around it. A reload clears it.

### Lookup candidates

A candidate is a list row whose title is a button. The meta line wraps, so the year, country, label, Catalog number and format all show. Tapping a candidate marks it with an `--accent` check and opens a save panel under it: a `--accent` bordered card that says which conditions the Copy will be saved with, and the primary "Add to Collection" button. A single match opens its panel at once. A candidate the Collection already has carries an "In your Collection" pill, and its panel asks "You already have 1 Copy of this. Add another?" in Unbounded at `--text-l`, with "Add another" and "Cancel" side by side. The way to look up is a row of radio chips above the field: "Barcode", "Catalog number" and "Artist and title". A Lookup that finds nothing offers the next way as a primary button, and a list offers it as a link under "Not the one you hold?".

### Scanner

The Lookup screen opens with "Scan the barcode". The camera fills a 4:3 `--sunk` box with `--radius-m` corners. A frame of four `--ink` corners and an `--accent` line marks where to hold the barcode, and a dark pill at the bottom says "Hold the barcode inside the frame". "Camera on" sits at the end of the section heading while the camera runs. After a read, the box gives way to one row: "Read" and the digits, and a quiet "Scan another" button. When the camera is blocked or missing, a `--surface` card says why and points to the typed field below, with a quiet "Try the camera again" when trying again can help. The typed field always stays.

### Shelf (first sketch)

The shelf screen is exploratory and not final. The Owner photographs a shelf, and the app lays a grid over the photo. Columns get letters and rows get numbers, so a 4 by 6 cube shelf has squares A1 to D6. A looked-up Copy's square gets a thick `--accent` outline and a "C4" marker in `--accent-fill`, and the other squares dim. The Copy screen shows the same square in a small "Where it lives" map.
