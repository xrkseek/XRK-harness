# @xrkseek/client-ui-release-notes

English | 中文

Release-notes surface plugin, browser half: the bell button in the sidebar foot
(`sidebar.footer.action`, order 10 — the row above Settings). It carries a red dot
while the newest bundled version is unread and opens a wider modal: pinned notice
on top, then an accordion per version. Expanding the newest version writes the
read marker (opening the dialog alone does not).

## Where the content lives

**`src/client/release-notes.ts`** — the notes themselves. Version rows go in
`RELEASE_NOTES` (newest first). An optional `RELEASE_NOTES_PINNED` block is a
top-of-dialog notice (thanks, policy) — not a version and not part of the unread
marker. This is source code, imported into the bundle at build time. Nothing is
fetched and nothing is persisted: the list can never disagree with the installed
build, and nothing in it touches `localStorage`.

Adding a version is one entry:

```ts
{
  version: '0.5.15',              // exact published string
  date: '2026-10-20',              // ISO date
  title: { zh: '…', en: '…' },
  changes: [
    { zh: '…', en: '…' },
    { zh: '…', en: '…' },
  ],
}
```

## Where the read state lives

Only the acknowledgement is durable: `release-notes-copy.ts` pins the settings
namespace `ui-onboarding` and the field `releaseNotesReadVersion` (the same
document the product welcome notice writes). A marker equal to the newest
bundled version means read; anything else — including an absent, malformed, or
newer-looking value — reads as unread.

**Read-on-open, not read-on-load.** Loading the shell never consumes a version's
notes; the dot clears on the gesture that actually shows them. A remote browser
whose settings wire is loopback-only settles read in process memory, mirroring
the welcome notice.

A failed read or write keeps the dot. That is deliberate: an unreachable settings
backend must not silently mark notes the user never saw as read.

## Design notes

The button reuses the sidebar foot's trigger geometry (42px / 12px-radius row,
36px rail circle) rather than inventing a rhythm — `.footArea` is a plain flex
column, so a second metric there reads as a misaligned stack. The unread dot is
absolutely positioned over the bell's top-right corner, so the label never
reflows when it appears or clears, and it is `aria-hidden` (the button's
`aria-label` carries the state).

`IconBellOutline16` is hand-authored: the design set ships no bell export. It
follows the `ic_ds_*` outline idiom per `ui-primitives/README.md`, which already
documents redrawn approximations as accepted practice.

## Known limitations

- The red dot compares against the **newest** version only. A user who skips
  three releases sees one dot, not three.
- Notes never expire or get pruned — history grows with the file.