# CLAUDE.md

The operating contract for this repository. Short on purpose — it loads into
every session. The detail lives in `docs/`, and this file tells you which one
you need.

---

## 1. Who you are here

You are the only one writing code on this site. Sebastian is the only human, and
he is not reviewing diffs line by line. If a second contributor is ever added he
will say so explicitly; until then, assume no one else will catch anything.

What he wants instead of review is **a legible chain of thought**. He should be
able to open any commit, months later, and understand what was asked, what was
actually wrong, what you decided, and how you know it worked. That is not a
nicety here — it is the only audit surface that exists. See §6.

## 2. The rule that bites

**`main` is the live site.** GitHub Pages publishes this repo's root from
`main`, at sesteva.com. There is no staging. A push is a deploy.

- Committing to `main` is normal and expected. That is how this repo works.
- **Pushing is publishing.** Ask first, unless he has already said to push in
  this session.
- Anything else outward-facing — filing issues, changing repo settings,
  publishing anything — gets asked first too.

## 3. Which guide to read

Read the one that matches what you are touching. Do not read both by default;
the `/vr` guide is 4,300 lines and most tasks do not need it.

| Touching | Read first |
|---|---|
| Anything in `vr/` | [`docs/VR_AI_BUILD_GUIDE.md`](docs/VR_AI_BUILD_GUIDE.md) — **in full, before writing code.** §2 is the hard rules, §3 is the catalogue of traps that fail *silently*. |
| The flat pages, tooling, deploy, docs | [`docs/AI_BUILD_GUIDE.md`](docs/AI_BUILD_GUIDE.md) |
| Anything, if you want the map | [`docs/README.md`](docs/README.md) |

## 4. Standing constraints

These hold everywhere, and breaking one is a regression, not a style choice.

1. **No build step.** Plain files, CDN libraries, no npm, no bundler, no
   transpile. `vr/` scripts are ES5-style (`var`, no modules) to match.
2. **Pin every CDN version exactly.** Never `latest`.
3. **Cache-busting is manual.** Every script and stylesheet in `vr/index.html`
   carries `?v=N`. Editing a file without bumping `N` ships nothing to anyone
   who already has the page cached — including you, mid-debug.
4. **Content is derived from the live site, never hand-duplicated.** `/vr`
   scrapes the flat pages. If you are typing project copy into a VR file, stop.
5. **Audio is off at the source, and never plays during testing.** Mute
   `#ambientAudio` and set `window.VRSound.enabled = false` before anything
   else. He has been startled by test audio from a hidden tab.
6. **`prefers-reduced-motion` and `a11yMode` are respected everywhere.**
   Reduced motion means "arrives in final state instantly", not "broken".
7. **Don't touch the rest of the site.** A `/vr` task does not wander into the
   flat pages. The three sanctioned exceptions are enumerated in the VR guide
   §2 rule 3; they were each asked for explicitly and none of them generalise.

## 5. How to know something works

The recurring failure mode in this repo is not a broken build — there is no
build. It is **a measurement that looked right and was not**. The VR guide's §3
exists because several of these cost real debugging time, and they all produced
convincing false results rather than errors.

So:

- **Measure, don't assume.** If a number is going into a commit message or a
  document, it came from an instrument you ran, not from reasoning.
- **Verify in the browser when the change is visible in a browser.** Not by
  asking him to check.
- **Screenshots must be actual image files sent to him.** He cannot see
  in-tool screenshot results.
- **Use the gzip server** (`static-site-gzip`) for any transfer-size number.
  GitHub Pages gzips binaries; a plain local server reports the uncompressed
  size and will never reproduce the live figure.
- **Don't over-verify small tweaks.** A one-line CSS change does not need a
  test rig. Match the effort to the risk.

## 6. Commit messages

The commit log is the design record. Its established form, which should be kept:

**Subject** — one plain sentence about what changed in the world. No `feat:`
prefixes, no file lists, no imperative-mood convention. Often the surprising
part rather than the obvious one:

> *There is ground under you now*
> *The lamps did go out; two caches were hiding it*
> *Beautiful from one angle is not a feature*
> *The length on the wire was not the length in the buffer*

**Body** — the reasoning, in prose paragraphs. What was asked for, what was
actually wrong and why, what was decided and what was rejected, what it broke in
passing and how that was handled. Longer bodies use bare capitalised labels
(`STYLE.`, `LIMITS.`) to open a paragraph rather than markdown headings.

**Last paragraph** — how it was verified, concretely. Not "tested" but *"paging
the whole document with real clicks: page 1 up pad hidden and unclickable, pages
2 and 3 both pads live, counter tracking 1/4 through 4/4 throughout."*

Close with the `Co-Authored-By` trailer. Reference an issue by number when one
exists.

## 7. Issues

Work that is queued but not being done right now goes in
[GitHub Issues](https://github.com/sebastianazulesteva-prog/Portfolio/issues),
not in a TODO comment and not in a doc.

- One issue per idea, titled so the list is skimmable.
- If you find something real while working on something else, file it rather
  than expanding scope — then keep going on the original task.
- Closing an issue happens in the commit that actually fixes it.

**Name the session after the issue.** Set the chat title to the issue number
and roughly three words:

> `#4 Host-only teleprompter`
> `#2 Docs off domain`
> `#9 Writing hero art`

Do it at the start, not the end — the point is that a sidebar full of sessions
reads as a list of what is being worked on, and that any chat can be traced
back to the issue that explains why it happened. Work with no issue behind it
gets the three words alone.

## 8. Working style he has asked for

- **Ask up front, then run to completion.** Put open decisions in a
  multiple-choice prompt at the start with clearly defined options, rather than
  a prose list of considerations mid-task. Then finish the whole list and review
  it item by item at the end.
- **Stop and ask when stuck**, or when one detail is eating the session, rather
  than grinding at it.
- **Review section by section** for visual work — one card, one element at a
  time, using the dev harnesses in `vr/` rather than the whole scene.
- **Keep narration short.** Batch reads. He does not need a play-by-play.
- **Show, don't describe.** A screenshot of the actual thing beats a paragraph
  about it.

## 9. Concurrency

Sessions in this repo sometimes run in parallel, in git worktrees under
`.claude/worktrees/`. Your branch can gain commits from another session while
you are working. Re-read git state immediately before committing rather than
trusting the status you read at the start.
