# docs/

Everything written about how this site is built. Two shelves: what is **current**
and what is **archived**. Nothing in `archive/` is an instruction.

A note on citations: roughly a hundred code comments in `vr/` cite these
documents by bare filename and section — `(VR_AI_BUILD_GUIDE.md §9.18)`,
`(BUILD_NOTES ISSUE-11)`, `(VR_TEST_REPORT B1)`. Those are citations, not
paths. Every file they name is in this directory or in `archive/`, and the
comments were deliberately left alone when the files moved here rather than
rewriting a hundred lines of shipped code for a path prefix.

---

## Current

### [`AI_BUILD_GUIDE.md`](AI_BUILD_GUIDE.md)
**The repo-wide guide.** The flat pages, the deploy, the local tooling, the
audit scripts, and the traps that are not `/vr`-specific. Start here for
anything outside `vr/`. Roughly the equivalent of the VR guide for the other
nine tenths of the site.

### [`VR_AI_BUILD_GUIDE.md`](VR_AI_BUILD_GUIDE.md)
**The standing spec for `/vr`, and the most valuable document in the repo.**
4,300 lines. Read it in full before touching anything in `vr/` — and *only*
then, because it is large and most tasks do not need it.

- §2 — the hard rules. Breaking one is a regression.
- §3 — the traps. Read twice. These are the failures that produce *convincing
  false results* rather than errors: you will not notice you have been fooled
  unless you already know to check.
- §4 — file map. §5 — the dev harnesses, which you should use rather than
  hand-rolling a new one. §6 — current state.
- §9 — the work-session log, newest layer, supersedes §4/§6 where they overlap.

### [`SITE_AUDIT.md`](SITE_AUDIT.md)
The flat-page audit: what was wrong, what was fixed, what was checked and found
fine, what was chased and turned out to be a false positive, and §4, what is
**open and deliberately unchanged**. That last section is a backlog worth
re-reading before proposing "fixes" that were already declined.

Re-runnable via `.tools/audit/` — see the AI build guide.

### [`VR_TEST_PROTOCOL.md`](VR_TEST_PROTOCOL.md)
The `/vr` test *procedure*, written to be re-run and compared across changes.
Findings never go in this file.

### [`VR_TEST_REPORT.md`](VR_TEST_REPORT.md)
Findings from running that protocol, written as a hand-off: each one carries
severity, exact location, reproduction, evidence, and a fix direction, so any
entry can be acted on without the conversation it came from. Its finding IDs
(`A5`, `B1`, `G2`, `G9`) are cited throughout the `/vr` code.

### [`VR_SHARP_PORTRAIT.md`](VR_SHARP_PORTRAIT.md)
The perspective-portrait lab — applying Apple's SHARP to the contact photo so
`/vr` shows a real view rather than a flat card. Built both ways so they could
be compared. Live on the site behind a button.

---

## Archive

Twelve planning documents from the build, in rough chronological order. Each
carries a header saying what it was, what replaced it, and why it is still here.
They are kept because they record *reasoning and reversals* that no current
document shows — and because several define identifiers the shipped code still
cites.

| | |
|---|---|
| [`VR_KICKOFF_PROMPT.md`](archive/VR_KICKOFF_PROMPT.md) | The message that started the v2 rebuild. |
| [`VR_BUILD_SPEC.md`](archive/VR_BUILD_SPEC.md) | Build Spec v2 — the architecture brief. Its §6 palette table is still cited by `themes.js`. |
| [`VR_DESIGN_RESOURCES.md`](archive/VR_DESIGN_RESOURCES.md) | The vetted library list. Origin of the no-build, pin-exact-versions rule. |
| [`VR_SPEC_ADDENDUM.md`](archive/VR_SPEC_ADDENDUM.md) | Addendum 1 — portrait, floor, link-lines. |
| [`VR_IPHONE_FALLBACK_ADDENDUM.md`](archive/VR_IPHONE_FALLBACK_ADDENDUM.md) | iOS has no WebXR at all. Still true. |
| [`VR_POLISH_PROMPT.md`](archive/VR_POLISH_PROMPT.md) | First polish critique, after the first walkable build. |
| [`VR_POLISH_STANDARDS.md`](archive/VR_POLISH_STANDARDS.md) | Single key light, one easing curve, three type sizes. |
| [`VR_FINAL_BUILD_PROMPT.md`](archive/VR_FINAL_BUILD_PROMPT.md) | The master directive that collapsed six documents into one. |
| [`BUILD_NOTES.md`](archive/BUILD_NOTES.md) | The `ISSUE-01..11` list from an in-headset walkthrough. **The only place those IDs are defined.** |
| [`VR_BUGFIX_NOTES.md`](archive/VR_BUGFIX_NOTES.md) | Later walkthrough fixes. Contains one explicit reversal — link-lines were built, then removed as clutter. **Do not rebuild them.** |
| [`VR_DEEP_DIVE_PROMPT.md`](archive/VR_DEEP_DIVE_PROMPT.md) | The brief that found the frame-clock bug. A good model for asking for a root cause instead of a guess. |
| [`VR_INTEGRITY_AUDIT_PROMPT.md`](archive/VR_INTEGRITY_AUDIT_PROMPT.md) | "Is this codebase actually sound?" — asked for measurements and for an explicit list of what was left alone. |

---

## Precedence

Where two documents disagree: **the code wins over any document; among
documents, the current shelf wins over the archive; within the VR guide, §9 is
the newest layer.**

Operating rules that apply to every session are in
[`../CLAUDE.md`](../CLAUDE.md), which is deliberately short. Work that is queued
but not underway is in
[GitHub Issues](https://github.com/sebastianazulesteva-prog/Portfolio/issues),
not in these files.
