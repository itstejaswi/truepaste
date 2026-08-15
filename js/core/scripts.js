/**
 * Script-aware safety checks.
 *
 * Zero-width joiners and variation selectors are simultaneously a smuggling
 * channel and a hard requirement of several writing systems. Tools that strip
 * them unconditionally corrupt emoji families, Devanagari conjuncts and Arabic
 * ligatures. This module decides, per occurrence, whether a given character is
 * doing legitimate work or hiding data.
 *
 * The rule throughout: when context is ambiguous, keep the character. A
 * sanitiser that silently damages valid text is worse than one that leaves a
 * little noise behind.
 */

import { inRanges, VARIATION_SELECTORS } from './codepoints.js';

const ZWNJ = 0x200c;
const ZWJ = 0x200d;

const RE_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const RE_REGIONAL = /\p{Regional_Indicator}/u;

/**
 * Scripts that use ZWJ/ZWNJ to control conjunct and ligature formation.
 * Sourced from the Unicode script property rather than hardcoded ranges so
 * the check stays correct as Unicode grows.
 */
const RE_JOINING_SCRIPT = new RegExp(
  '[' +
    '\\p{Script=Devanagari}\\p{Script=Bengali}\\p{Script=Gurmukhi}' +
    '\\p{Script=Gujarati}\\p{Script=Oriya}\\p{Script=Tamil}' +
    '\\p{Script=Telugu}\\p{Script=Kannada}\\p{Script=Malayalam}' +
    '\\p{Script=Sinhala}\\p{Script=Arabic}\\p{Script=Syriac}' +
    '\\p{Script=Thaana}\\p{Script=Nko}\\p{Script=Mongolian}' +
    '\\p{Script=Myanmar}\\p{Script=Khmer}\\p{Script=Tibetan}' +
    '\\p{Script=Javanese}\\p{Script=Balinese}' +
    ']',
  'u'
);

/** Combining marks may sit between a base letter and its joiner. */
const RE_COMBINING = /\p{Mn}|\p{Mc}/u;

/**
 * Read the whole codepoint (not the UTF-16 unit) that ends at `index - 1`.
 * Returns null at the start of the string.
 */
function codepointBefore(text, index) {
  if (index <= 0) return null;
  const cp = text.codePointAt(index - 1);
  // Low surrogate: step back one more unit to read the full pair.
  if (cp >= 0xdc00 && cp <= 0xdfff && index >= 2) {
    return String.fromCodePoint(text.codePointAt(index - 2));
  }
  return String.fromCodePoint(cp);
}

/** Read the whole codepoint that begins at `index`. Returns null past the end. */
function codepointAt(text, index) {
  if (index >= text.length) return null;
  return String.fromCodePoint(text.codePointAt(index));
}

/**
 * Walk backwards past any combining marks and variation selectors to find the
 * base character a joiner or selector actually attaches to.
 */
function baseCharBefore(text, index) {
  let i = index;
  for (let guard = 0; guard < 8; guard += 1) {
    const ch = codepointBefore(text, i);
    if (ch === null) return null;
    const cp = ch.codePointAt(0);
    const isSkippable =
      inRanges(cp, VARIATION_SELECTORS) || RE_COMBINING.test(ch);
    if (!isSkippable) return ch;
    i -= ch.length;
  }
  return null;
}

/**
 * Decide whether the joiner at `index` is suspicious (hiding data) rather than
 * functional (shaping a script or emoji).
 *
 * Functional cases we preserve:
 *   - emoji ZWJ sequences, e.g. family and profession sequences
 *   - regional indicator pairs (flags)
 *   - Indic, Arabic and other joining scripts on either side
 *
 * Everything else - a joiner between two Latin letters, at a boundary, or
 * repeated in a run - is treated as a payload.
 *
 * @param {string} text  full text being scanned
 * @param {number} index UTF-16 offset of the joiner
 * @returns {boolean} true when the joiner carries no linguistic function
 */
export function isSuspiciousJoiner(text, index) {
  const cp = text.codePointAt(index);
  if (cp !== ZWJ && cp !== ZWNJ) return false;

  const before = baseCharBefore(text, index);
  const after = codepointAt(text, index + 1);

  // A joiner needs something on both sides to join.
  if (before === null || after === null) return true;

  // Emoji sequences and flags.
  if (RE_PICTOGRAPHIC.test(before) && RE_PICTOGRAPHIC.test(after)) return false;
  if (RE_REGIONAL.test(before) || RE_REGIONAL.test(after)) return false;

  // Scripts that genuinely use joiners for shaping.
  if (RE_JOINING_SCRIPT.test(before) || RE_JOINING_SCRIPT.test(after)) {
    return false;
  }

  // Consecutive joiners encode bits far more often than they shape text.
  const afterCp = after.codePointAt(0);
  if (afterCp === ZWJ || afterCp === ZWNJ) return true;

  return true;
}

/**
 * Decide whether the variation selector at `index` is orphaned.
 *
 * A selector is legitimate directly after an emoji or CJK base character,
 * where it chooses text or emoji presentation. Applied to a Latin letter,
 * a space, or stacked in a run, it is a steganographic payload - this is the
 * documented technique for hiding data in LLM output.
 *
 * @param {string} text  full text being scanned
 * @param {number} index UTF-16 offset of the selector
 * @returns {boolean} true when the selector has no base to modify
 */
export function isOrphanVariationSelector(text, index) {
  const cp = text.codePointAt(index);
  if (!inRanges(cp, VARIATION_SELECTORS)) return false;

  const before = codepointBefore(text, index);
  if (before === null) return true;

  const beforeCp = before.codePointAt(0);

  // A selector modifying another selector is a payload run, not presentation.
  if (inRanges(beforeCp, VARIATION_SELECTORS)) return true;

  // Emoji presentation: the overwhelmingly common legitimate use.
  if (RE_PICTOGRAPHIC.test(before)) return false;

  // CJK ideographic variation sequences are legitimate.
  if (/[\u3000-\u9fff\uf900-\ufaff]|[\u{20000}-\u{2fa1f}]/u.test(before)) {
    return false;
  }

  // Anything else - Latin letters, digits, punctuation, whitespace - has no
  // registered variation sequence, so the selector is carrying data.
  return true;
}

/**
 * Report which writing systems appear in `text`. Used by the UI to warn before
 * a destructive rule (confusable mapping, NFKC) runs over multilingual input.
 *
 * @param {string} text
 * @returns {{ hasEmoji: boolean, hasJoiningScript: boolean, hasNonLatin: boolean }}
 */
export function describeScripts(text) {
  return {
    hasEmoji: RE_PICTOGRAPHIC.test(text),
    hasJoiningScript: RE_JOINING_SCRIPT.test(text),
    hasNonLatin:
      /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(text),
  };
}
