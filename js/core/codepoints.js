/**
 * Codepoint taxonomy.
 *
 * Single source of truth for every character class TrustPaste knows about.
 * Kept free of transform logic so it can be audited on its own: a reviewer
 * should be able to read this file and know exactly what the tool touches.
 *
 * Ranges are inclusive [start, end] pairs of codepoints.
 */

/** Characters that render nothing and carry no linguistic meaning anywhere. */
export const INVISIBLE = Object.freeze([
  [0x200b, 0x200b], // ZERO WIDTH SPACE
  [0x2060, 0x2060], // WORD JOINER
  [0x2061, 0x2064], // invisible maths operators
  [0xfeff, 0xfeff], // ZERO WIDTH NO-BREAK SPACE / BOM
  [0x180e, 0x180e], // MONGOLIAN VOWEL SEPARATOR (no longer a format char)
  [0x00ad, 0x00ad], // SOFT HYPHEN
]);

/**
 * Tag characters. The entire ASCII range has an invisible mirror here, so
 * arbitrary text can be smuggled inside a sentence that renders identically.
 * Deprecated by Unicode; no legitimate use in modern text.
 */
export const TAG_CHARS = Object.freeze([[0xe0000, 0xe007f]]);

/**
 * Variation selectors. VS1-16 live in the BMP block, VS17-256 in the
 * supplementary block. Legitimate after an emoji or CJK base character;
 * a smuggling channel when orphaned. See isOrphanVariationSelector().
 */
export const VARIATION_SELECTORS = Object.freeze([
  [0xfe00, 0xfe0f],
  [0xe0100, 0xe01ef],
]);

/**
 * Bidirectional controls. Can reorder rendered text independently of its
 * logical order, which is the Trojan Source class of attack (CVE-2021-42574).
 */
export const BIDI_CONTROLS = Object.freeze([
  [0x202a, 0x202e], // LRE, RLE, PDF, LSO, RSO
  [0x2066, 0x2069], // LRI, RLI, FSI, PDI
  [0x200e, 0x200f], // LRM, RLM
  [0x061c, 0x061c], // ARABIC LETTER MARK
]);

/**
 * Joiners. Genuinely required by emoji sequences, Indic scripts and Arabic.
 * Never strip these unconditionally - see isSuspiciousJoiner().
 */
export const JOINERS = Object.freeze([
  [0x200c, 0x200c], // ZERO WIDTH NON-JOINER
  [0x200d, 0x200d], // ZERO WIDTH JOINER
]);

/** Spaces that are not U+0020 but occupy visible width. */
export const EXOTIC_SPACES = Object.freeze([
  [0x00a0, 0x00a0], // NO-BREAK SPACE
  [0x2000, 0x200a], // EN QUAD .. HAIR SPACE
  [0x202f, 0x202f], // NARROW NO-BREAK SPACE
  [0x205f, 0x205f], // MEDIUM MATHEMATICAL SPACE
  [0x3000, 0x3000], // IDEOGRAPHIC SPACE
  [0x1680, 0x1680], // OGHAM SPACE MARK
]);

/**
 * Line and paragraph separators. Valid Unicode, but they terminate a string
 * literal in older JavaScript parsers and break naive JSON handling.
 */
export const LINE_SEPARATORS = Object.freeze([
  [0x2028, 0x2028],
  [0x2029, 0x2029],
]);

/** Artefacts of a failed encode/decode round trip. */
export const REPLACEMENT_CHARS = Object.freeze([
  [0xfffc, 0xfffc], // OBJECT REPLACEMENT CHARACTER
  [0xfffd, 0xfffd], // REPLACEMENT CHARACTER
]);

/**
 * C0/C1 control characters, excluding tab, newline and carriage return.
 * Nothing legitimate survives a copy-paste in this range.
 */
export const CONTROL_CHARS = Object.freeze([
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
]);

/** Substitutions applied by the punctuation rules, as explicit pairs. */
export const DASH_MAP = Object.freeze({
  '\u2010': '-', // HYPHEN
  '\u2011': '-', // NON-BREAKING HYPHEN
  '\u2012': '-', // FIGURE DASH
  '\u2013': '-', // EN DASH
  '\u2014': '-', // EM DASH
  '\u2015': '-', // HORIZONTAL BAR
  '\u2212': '-', // MINUS SIGN
});

export const QUOTE_MAP = Object.freeze({
  '\u2018': "'", // LEFT SINGLE QUOTATION MARK
  '\u2019': "'", // RIGHT SINGLE QUOTATION MARK
  '\u201a': "'", // SINGLE LOW-9 QUOTATION MARK
  '\u201b': "'", // SINGLE HIGH-REVERSED-9
  '\u2032': "'", // PRIME
  '\u201c': '"', // LEFT DOUBLE QUOTATION MARK
  '\u201d': '"', // RIGHT DOUBLE QUOTATION MARK
  '\u201e': '"', // DOUBLE LOW-9 QUOTATION MARK
  '\u201f': '"', // DOUBLE HIGH-REVERSED-9
  '\u2033': '"', // DOUBLE PRIME
});

export const MISC_PUNCT_MAP = Object.freeze({
  '\u2026': '...', // HORIZONTAL ELLIPSIS
  '\u2044': '/', // FRACTION SLASH
  '\u2022': '-', // BULLET
  '\u2023': '-', // TRIANGULAR BULLET
  '\u2043': '-', // HYPHEN BULLET
  '\u00b7': '-', // MIDDLE DOT
});

/**
 * Confusables: characters from other scripts that are visually identical to
 * Latin. Mapping these is destructive for legitimately multilingual text, so
 * the rule that uses this map is off by default.
 */
export const CONFUSABLE_MAP = Object.freeze({
  // Cyrillic
  а: 'a', в: 'b', с: 'c', е: 'e', һ: 'h', і: 'i', ј: 'j', к: 'k', м: 'm',
  н: 'h', о: 'o', р: 'p', ѕ: 's', т: 't', у: 'y', х: 'x', А: 'A', В: 'B',
  С: 'C', Е: 'E', Н: 'H', І: 'I', Ј: 'J', К: 'K', М: 'M', О: 'O', Р: 'P',
  Ѕ: 'S', Т: 'T', У: 'Y', Х: 'X',
  // Greek
  α: 'a', ο: 'o', ρ: 'p', ν: 'v', Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H',
  Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
  // Fullwidth Latin is handled by NFKC, not here.
});

/** Build a RegExp character class source fragment from inclusive ranges. */
export function rangesToClassSource(ranges) {
  return ranges
    .map(([lo, hi]) => {
      const a = `\\u{${lo.toString(16)}}`;
      const b = `\\u{${hi.toString(16)}}`;
      return lo === hi ? a : `${a}-${b}`;
    })
    .join('');
}

/** Compile inclusive ranges into a global, unicode-aware RegExp. */
export function rangesToRegExp(ranges, flags = 'gu') {
  return new RegExp(`[${rangesToClassSource(ranges)}]`, flags);
}

/** True when codepoint `cp` falls inside any of the inclusive `ranges`. */
export function inRanges(cp, ranges) {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}
