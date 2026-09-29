# sesteva.com

Sebastian Esteva's portfolio. A static, hand-written site with a WebXR wing.

**Live:** <https://sesteva.com> · **VR:** <https://sesteva.com/vr> (beta)

---

## The one thing to know first

**`main` is the live site.** GitHub Pages serves this repository's root from the
`main` branch, with `CNAME` pointing at sesteva.com and HTTPS enforced. There is
no staging environment and no deploy step: a push to `main` is a publish, and
it is visible to anyone within about a minute.

Commit freely. Push deliberately.

---

## What is here

| | |
|---|---|
| `index.html` | Homepage — hero, work grid, contact. The largest page by far. |
| `experience.html` | Résumé-shaped page. |
| Ten project pages | `chess`, `pendant`, `slipdoor`, `baston`, `timecollector`, `3d-printed-glasses-frames`, `algorithmic-modeling-shape-optimization`, `apple-medical-licensure-apple-watch`, `hp-reckoning-corporate-espionage`, `social-engineering-predictive-algorithms` |
| `vr-spatial-portfolio.html` | "The Dome, a portfolio you walk into" — the flat page *about* `/vr`. The nav's `Experience in VR` link lands here, not in the headset. |
| `vr/` | The WebXR scene itself — A-Frame 1.5.0, 47 components, ~87 KB of `index.html`. |
| `touchscreen/` | A standalone one-off, not linked from the site. |
| `images/` | Every image on the site. |
| `*.pdf` | Writing samples and reports, linked from the project pages. |
| `docs/` | Everything written about how this is built. Start at [`docs/README.md`](docs/README.md). |

There is no build system. No `package.json`, no bundler, no transpiler, no
framework. Each flat page is self-contained with its own inline `<style>` block;
there is no shared stylesheet at the root. `vr/` is the only part with a
component architecture, and it loads three pinned libraries from CDNs.

## Running it locally

Servers are defined in `.claude/launch.json`:

```bash
python3 -m http.server 8080
```

- **`static-site`** — plain `python3 -m http.server`. Fine for everything except
  measuring transfer sizes.
- **`static-site-gzip`** — serves with gzip, because GitHub Pages compresses
  binaries and a plain local server will report the *uncompressed* size. Use
  this one whenever a number is going into a document.
- **`vr-image-picker`** — a local GUI for choosing which images each VR room uses.

Phone and headset testing goes over HTTPS on the LAN via `.tools/vr-phone.sh`,
which generates a self-signed cert and can tunnel through cloudflared.

## `.tools/` is real, and it is not in this repository

`.tools/` holds the local-only tooling: a cloudflared binary, the self-signed
cert and private key, the image indexer and picker, a PDF shrinker, a texture
generator, and the re-runnable site audit scripts. It is gitignored deliberately
— it contains a private key and 57 MB of binaries. If it is missing from a fresh
clone, that is expected, and the scripts that matter are described in
[`docs/AI_BUILD_GUIDE.md`](docs/AI_BUILD_GUIDE.md).

Also gitignored: `vr/_dev-*` (nineteen dev harnesses and their screenshots, none of which may ship),
`vr/assets/*.mp3` and `vr-audio/` (the audio is switched off at the source), and
`portfolio-sharp/` (another session's git worktree, not a directory of this
site).

## Who works on this

Sebastian is the only human. Claude is the only one writing code. There is no
review queue and no second contributor to coordinate with, so the discipline
that would normally live in pull requests lives in two places instead: the
commit messages, which explain reasoning rather than list changes, and the
[issues](https://github.com/sebastianazulesteva-prog/Portfolio/issues), which
hold the work that is queued but not being done right now.

If you are an AI assistant picking this up, read [`CLAUDE.md`](CLAUDE.md) first.
It is short.
