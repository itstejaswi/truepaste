# TruePaste

**Your words, without hidden surprises.**

Text copied out of a chat window picks up passengers: characters you cannot
see, cannot select, and cannot delete. They survive every copy and paste and
ride along into your email, your essay, your pull request.

Some are harmless formatting. Some carry a tracking marker or a watermark.
Some carry an instruction meant for the next AI assistant that reads your text.

TruePaste finds them, decodes what they were carrying, and takes them out.

- **Runs entirely on your device.** No upload, no account, no limits.
- **The page cannot phone home.** Its Content Security Policy sets
  `connect-src 'none'`, which your browser enforces.
- **The extension asks for no site access** when you install it.
- **MIT licensed, no dependencies**, and small enough to read in one sitting.

## Try it

Open [the website](https://itstejaswi.github.io/truepaste/), or clone and run
it locally:

```bash
git clone https://github.com/itstejaswi/truepaste.git
cd truepaste
npm run dev          # http://localhost:8080
```

## Install the extension

Chrome and Edge only allow one-click installation from their own stores, and
both refuse `.crx` files from anywhere else. Loading unpacked is the supported
route for an extension distributed as source - and it means the code you run is
the code you can read.

1. Download `truepaste-<version>.zip` from
   [Releases](https://github.com/itstejaswi/truepaste/releases).
2. Optionally verify it against the published SHA-256:
   ```powershell
   Get-FileHash truepaste.zip -Algorithm SHA256   # Windows
   shasum -a 256 truepaste.zip                    # macOS, Linux
   ```
3. Unzip it somewhere permanent - the browser reloads from that folder at every
   start.
4. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**,
   choose **Load unpacked**, and select the folder.

Right-click any selection for **Clean selected text**, or press
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> for the popup.

## What it removes

Security-relevant, on by default:

| Artefact | Why it matters |
| --- | --- |
| Tag characters `U+E0000-E007F` | An invisible mirror of the entire ASCII range. Hides IDs, watermarks or whole instructions inside ordinary sentences. |
| Variation selectors `U+FE00-FE0F`, `U+E0100+` | Legitimate after emoji. Attached to letters they encode arbitrary bytes - the documented way to watermark text. |
| Bidi controls `U+202A-202E`, `U+2066-2069` | Reorder rendered text independently of its real order. The Trojan Source attack (CVE-2021-42574). |
| Zero-width characters `U+200B`, `U+2060`, `U+FEFF` | Render as nothing, break search and regex, and are the most common carrier for hidden markers. |
| Out-of-place joiners `U+200C`, `U+200D` | Removed only where they serve no linguistic purpose (see below). |
| Control characters | C0 and C1 controls other than tab, newline and carriage return. |

Formatting, mostly opt-in: unusual spaces, line separators `U+2028`/`U+2029`,
dashes, smart quotes, ellipses, leftover markdown, padded blank lines, and
look-alike letter mapping.

### What it cannot remove

Statistical watermarks such as SynthID-Text are embedded in token selection -
the choice of words - not in the characters. No amount of character cleaning
touches them.

Tools that promise to defeat AI detectors are describing a different problem.
Detectors work on perplexity and burstiness, so TruePaste will not change what
they conclude. It removes hidden data and metadata; it does not rewrite prose.

## Script safety

Zero-width joiners and variation selectors are simultaneously a smuggling
channel and a hard requirement of several writing systems. Tools that strip them
unconditionally corrupt emoji families, Devanagari conjuncts and Arabic
ligatures.

TruePaste decides per occurrence. A joiner between two Latin letters is a
payload; the same character inside `👨‍👩‍👦` or `क‍ष` is doing real work and is
left alone. When context is ambiguous, the character stays - a sanitiser that
silently damages valid text is worse than one that leaves a little noise.

The test suite covers this explicitly. See `tests/core.test.mjs`.

## Using the core directly

The engine has no dependencies and no build step.

```js
import { clean, detect } from './js/core/clean.js';

const { text, report, changed } = clean(input);
console.log(report.total);              // how many artefacts were removed
console.log(report.payloads.tagText);   // any hidden message, decoded

const scan = detect(input);             // inspect without modifying
```

Every rule is a toggle:

```js
clean(input, { rules: { dashes: true, quotes: true, markdown: false } });
```

## Layout

```
js/core/      the engine - codepoints, script safety, rules, clean/detect
js/web/       website controller and the selection overlay
extension/    MV3 shell; the build copies js/core into it
tests/        node --test, no framework
tools/        dev server, logo generator, extension build
```

`js/core` has exactly one home. The build copies it into the extension, so the
website and the extension can never drift apart.

## Development

```bash
npm test                              # run the test suite
npm run dev                           # serve the site locally
node tools/build-extension.mjs --zip  # build and package the extension
node tools/make-logo.mjs              # regenerate icons from source
```

No build step, no bundler, no dependencies. The repository contains no opaque
binary assets: the icons are generated by a script you can read.

## Licence

Copyright (C) 2026 Tejaswi C.

Released under the [GNU AGPL v3](LICENSE). You may use, study, modify and share
it freely. If you run a modified version and let others use it over a network,
section 13 requires you to offer them your source as well � rehosting it
unchanged is welcome, rehosting it changed and silent is not.

