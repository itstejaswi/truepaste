/**
 * Rule registry.
 *
 * Every rule exposes one method, scan(text), returning the edits it would make.
 * Cleaning applies those edits; detection counts them. Because both modes read
 * the same output, the report can never disagree with the result.
 *
 * An edit is { start, end, replacement } over UTF-16 offsets, where
 * `replacement` of '' means deletion.
 *
 * Rule metadata:
 *   layer       1 invisible codepoints, 2 container metadata, 3 stylistic
 *   destructive true when the rule can alter legitimate text; off by default
 *   severity    'security' surfaces separately in the UI
 */

import {
  BIDI_CONTROLS,
  CONFUSABLE_MAP,
  CONTROL_CHARS,
  DASH_MAP,
  EXOTIC_SPACES,
  INVISIBLE,
  JOINERS,
  LINE_SEPARATORS,
  MISC_PUNCT_MAP,
  QUOTE_MAP,
  REPLACEMENT_CHARS,
  TAG_CHARS,
  VARIATION_SELECTORS,
  rangesToRegExp,
} from './codepoints.js';
import { isOrphanVariationSelector, isSuspiciousJoiner } from './scripts.js';

/** Collect edits for every match of a global regexp. */
function scanRanges(text, ranges, replacement = '') {
  const re = rangesToRegExp(ranges);
  const edits = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    edits.push({ start: m.index, end: m.index + m[0].length, replacement });
  }
  return edits;
}

/** Collect edits from a literal character -> string map. */
function scanMap(text, map) {
  const edits = [];
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i));
    const replacement = map[ch];
    if (replacement !== undefined) {
      edits.push({ start: i, end: i + ch.length, replacement });
    }
    i += ch.length;
  }
  return edits;
}

/** Collect edits for matches of a global regexp, using a replacement function. */
function scanRegExp(text, re, replacementFor) {
  const edits = [];
  let m;
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  while ((m = rx.exec(text)) !== null) {
    const replacement = replacementFor ? replacementFor(m) : '';
    if (m[0].length === 0) {
      rx.lastIndex += 1;
      continue;
    }
    edits.push({ start: m.index, end: m.index + m[0].length, replacement });
  }
  return edits;
}

export const RULES = Object.freeze([
  // ---------------------------------------------------------------- layer 1
  {
    id: 'tagChars',
    label: 'Tag characters',
    description:
      'Invisible mirrors of the ASCII range (U+E0000-E007F). Arbitrary text - a tracking ID or a whole hidden instruction - can be smuggled inside a sentence that looks completely normal.',
    layer: 1,
    severity: 'security',
    default: true,
    destructive: false,
    scan: (text) => scanRanges(text, TAG_CHARS),
  },
  {
    id: 'bidi',
    label: 'Bidirectional controls',
    description:
      'Reorder rendered text independently of its underlying order. The basis of the Trojan Source attack, where code reads one way and executes another.',
    layer: 1,
    severity: 'security',
    default: true,
    destructive: false,
    scan: (text) => scanRanges(text, BIDI_CONTROLS),
  },
  {
    id: 'orphanVariationSelectors',
    label: 'Orphan variation selectors',
    description:
      'Variation selectors attached to something that has no variant form - a Latin letter, a space, or another selector. Legitimate emoji and CJK selectors are preserved.',
    layer: 1,
    severity: 'security',
    default: true,
    destructive: false,
    scan: (text) => {
      const edits = [];
      for (let i = 0; i < text.length; ) {
        const ch = String.fromCodePoint(text.codePointAt(i));
        if (isOrphanVariationSelector(text, i)) {
          edits.push({ start: i, end: i + ch.length, replacement: '' });
        }
        i += ch.length;
      }
      return edits;
    },
  },
  {
    id: 'invisible',
    label: 'Zero-width and invisible characters',
    description:
      'Zero-width spaces, word joiners, byte-order marks and soft hyphens. They render as nothing, break search and regex, and are the most common carrier for hidden markers.',
    layer: 1,
    severity: 'security',
    default: true,
    destructive: false,
    scan: (text) => scanRanges(text, INVISIBLE),
  },
  {
    id: 'suspiciousJoiners',
    label: 'Out-of-place joiners',
    description:
      'Zero-width joiners that are not shaping an emoji sequence or a script that needs them. Emoji families, Devanagari conjuncts and Arabic ligatures are left intact.',
    layer: 1,
    severity: 'security',
    default: true,
    destructive: false,
    scan: (text) => {
      const edits = [];
      const re = rangesToRegExp(JOINERS);
      let m;
      while ((m = re.exec(text)) !== null) {
        if (isSuspiciousJoiner(text, m.index)) {
          edits.push({ start: m.index, end: m.index + m[0].length, replacement: '' });
        }
      }
      return edits;
    },
  },
  {
    id: 'controlChars',
    label: 'Control characters',
    description:
      'C0 and C1 controls other than tab, newline and carriage return. Nothing legitimate survives a copy-paste in this range.',
    layer: 1,
    severity: 'security',
    default: true,
    destructive: false,
    scan: (text) => scanRanges(text, CONTROL_CHARS),
  },
  {
    id: 'lineSeparators',
    label: 'Line and paragraph separators',
    description:
      'U+2028 and U+2029. Valid Unicode, but they terminate string literals in older JavaScript parsers and break naive JSON handling.',
    layer: 1,
    severity: 'security',
    default: true,
    destructive: false,
    scan: (text) => scanRanges(text, LINE_SEPARATORS, '\n'),
  },
  {
    id: 'replacementChars',
    label: 'Replacement characters',
    description:
      'U+FFFD and U+FFFC, left behind by a failed encoding round trip or a stripped embedded object.',
    layer: 1,
    severity: 'hygiene',
    default: true,
    destructive: false,
    scan: (text) => scanRanges(text, REPLACEMENT_CHARS),
  },

  // ---------------------------------------------------------------- layer 3
  {
    id: 'exoticSpaces',
    label: 'Unusual spaces',
    description:
      'Non-breaking, narrow, thin and ideographic spaces converted to a plain space. They look ordinary but prevent wrapping and defeat exact-match search.',
    layer: 3,
    severity: 'hygiene',
    default: true,
    destructive: false,
    scan: (text) => scanRanges(text, EXOTIC_SPACES, ' '),
  },
  {
    id: 'dashes',
    label: 'Dashes',
    description:
      'Em, en and figure dashes converted to a plain hyphen. The em-dash is the single most recognisable stylistic tell in generated prose.',
    layer: 3,
    severity: 'style',
    default: false,
    destructive: false,
    scan: (text) => scanMap(text, DASH_MAP),
  },
  {
    id: 'quotes',
    label: 'Smart quotes',
    description:
      'Curly quotes and primes converted to straight quotes. Essential when the text is going into code, JSON or a shell.',
    layer: 3,
    severity: 'style',
    default: false,
    destructive: false,
    scan: (text) => scanMap(text, QUOTE_MAP),
  },
  {
    id: 'miscPunctuation',
    label: 'Ellipses and bullets',
    description:
      'Single-character ellipsis expanded to three dots; bullet and middle-dot characters converted to hyphens.',
    layer: 3,
    severity: 'style',
    default: false,
    destructive: false,
    scan: (text) => scanMap(text, MISC_PUNCT_MAP),
  },
  {
    id: 'markdown',
    label: 'Markdown syntax',
    description:
      'Removes heading markers, bold and italic markers, and list bullets, leaving the text they wrapped. Useful when pasting into an editor that does not render markdown.',
    layer: 3,
    severity: 'style',
    default: false,
    destructive: false,
    scan: (text) => {
      const edits = [];
      // Leading heading markers and list bullets, per line.
      edits.push(...scanRegExp(text, /^[ \t]*#{1,6}[ \t]+/gm, () => ''));
      edits.push(...scanRegExp(text, /^[ \t]*[*+-][ \t]+/gm, (m) => {
        const indent = m[0].match(/^[ \t]*/)[0];
        return `${indent}- `;
      }));
      // Emphasis markers, keeping the wrapped text.
      edits.push(...scanRegExp(text, /\*\*\*(?=\S)|(?<=\S)\*\*\*/g, () => ''));
      edits.push(...scanRegExp(text, /\*\*(?=\S)|(?<=\S)\*\*/g, () => ''));
      edits.push(...scanRegExp(text, /(?<![\w*])\*(?=\S)|(?<=\S)\*(?![\w*])/g, () => ''));
      return edits;
    },
  },
  {
    id: 'trailingWhitespace',
    label: 'Trailing whitespace',
    description: 'Removes spaces and tabs at the end of each line.',
    layer: 3,
    severity: 'hygiene',
    default: true,
    destructive: false,
    scan: (text) => scanRegExp(text, /[ \t]+$/gm, () => ''),
  },
  {
    id: 'excessBlankLines',
    label: 'Extra blank lines',
    description:
      'Collapses two or more consecutive blank lines into a single one, keeping paragraph breaks but removing the padding that chat interfaces add.',
    layer: 3,
    severity: 'hygiene',
    default: false,
    destructive: false,
    // Three or more newlines means two or more blank lines between paragraphs.
    scan: (text) => scanRegExp(text, /(?:[ \t]*\r?\n){3,}/g, () => '\n\n'),
  },

  // -------------------------------------------------- destructive, off by default
  {
    id: 'confusables',
    label: 'Look-alike letters',
    description:
      'Maps Cyrillic and Greek letters that imitate Latin ones - the basis of homograph spoofing. Destructive for genuinely multilingual text, so it is off unless you ask for it.',
    layer: 3,
    severity: 'security',
    default: false,
    destructive: true,
    scan: (text) => scanMap(text, CONFUSABLE_MAP),
  },
]);

/** Rules keyed by id, for lookup. */
export const RULES_BY_ID = Object.freeze(
  Object.fromEntries(RULES.map((r) => [r.id, r]))
);

/** The default enabled set: conservative, non-destructive rules only. */
export function defaultRuleState() {
  return Object.fromEntries(RULES.map((r) => [r.id, r.default]));
}
