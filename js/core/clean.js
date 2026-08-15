/**
 * Cleaning and detection.
 *
 * Both modes run the same rule scans. clean() applies the resulting edits;
 * detect() reports them without touching the text. Detection additionally
 * attempts to decode any hidden payload it finds, so the user can see what was
 * actually being carried rather than only a count.
 */

import { RULES, RULES_BY_ID, defaultRuleState } from './rules.js';
import { TAG_CHARS, VARIATION_SELECTORS, inRanges } from './codepoints.js';

/**
 * Resolve overlapping edits. Earlier start wins; on a tie the longer edit wins.
 * Overlaps are rare but possible where a stylistic rule meets a hidden-character
 * rule, and silently applying both would corrupt offsets.
 */
function resolveEdits(edits) {
  const sorted = [...edits].sort((a, b) =>
    a.start !== b.start ? a.start - b.start : b.end - a.end
  );
  const out = [];
  let cursor = -1;
  for (const edit of sorted) {
    if (edit.start >= cursor) {
      out.push(edit);
      cursor = edit.end;
    }
  }
  return out;
}

/** Gather edits from every enabled rule. */
function collectEdits(text, ruleState) {
  const all = [];
  for (const rule of RULES) {
    if (!ruleState[rule.id]) continue;
    for (const edit of rule.scan(text)) {
      all.push({ ...edit, ruleId: rule.id });
    }
  }
  return all;
}

/** Apply resolved edits to produce the output string. */
function applyEdits(text, edits) {
  if (edits.length === 0) return text;
  const parts = [];
  let last = 0;
  for (const edit of edits) {
    parts.push(text.slice(last, edit.start), edit.replacement);
    last = edit.end;
  }
  parts.push(text.slice(last));
  return parts.join('');
}

/**
 * Decode a run of tag characters back into the ASCII it represents.
 * U+E0000 + n maps to codepoint n, so the payload is recoverable exactly.
 */
export function decodeTagChars(text) {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (inRanges(cp, TAG_CHARS)) {
      const ascii = cp - 0xe0000;
      if (ascii >= 0x20 && ascii <= 0x7e) out += String.fromCharCode(ascii);
    }
  }
  return out;
}

/**
 * Decode a run of variation selectors as bytes.
 * VS1-16 occupy U+FE00-FE0F (bytes 0-15) and VS17-256 occupy U+E0100-E01EF
 * (bytes 16-255), which is the standard encoding used to hide data this way.
 * Returns printable ASCII only; anything else is reported as a byte count.
 */
export function decodeVariationSelectors(text) {
  const bytes = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xfe00 && cp <= 0xfe0f) bytes.push(cp - 0xfe00);
    else if (cp >= 0xe0100 && cp <= 0xe01ef) bytes.push(cp - 0xe0100 + 16);
  }
  if (bytes.length === 0) return { bytes: 0, text: '' };
  const printable = bytes.every((b) => b >= 0x20 && b <= 0x7e);
  return {
    bytes: bytes.length,
    text: printable ? String.fromCharCode(...bytes) : '',
  };
}

/**
 * Inspect `text` without modifying it.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {Record<string, boolean>} [options.rules] rule id -> enabled
 * @returns {{
 *   total: number,
 *   clean: boolean,
 *   byRule: Record<string, number>,
 *   bySeverity: Record<string, number>,
 *   findings: Array<{ ruleId: string, label: string, severity: string, count: number, layer: number }>,
 *   payloads: { tagText: string, variationSelectors: { bytes: number, text: string } }
 * }}
 */
export function detect(text, options = {}) {
  const ruleState = { ...defaultRuleState(), ...(options.rules ?? {}) };
  const edits = collectEdits(text, ruleState);

  const byRule = {};
  const bySeverity = {};
  for (const edit of edits) {
    byRule[edit.ruleId] = (byRule[edit.ruleId] ?? 0) + 1;
    const sev = RULES_BY_ID[edit.ruleId].severity;
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
  }

  const findings = Object.entries(byRule)
    .map(([ruleId, count]) => ({
      ruleId,
      label: RULES_BY_ID[ruleId].label,
      severity: RULES_BY_ID[ruleId].severity,
      layer: RULES_BY_ID[ruleId].layer,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    total: edits.length,
    clean: edits.length === 0,
    byRule,
    bySeverity,
    findings,
    payloads: {
      tagText: decodeTagChars(text),
      variationSelectors: decodeVariationSelectors(text),
    },
  };
}

/**
 * Clean `text` according to the enabled rules.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {Record<string, boolean>} [options.rules] rule id -> enabled
 * @param {boolean} [options.normalizeUnicode] apply NFKC after the rules run
 * @returns {{ text: string, report: ReturnType<typeof detect>, changed: boolean }}
 */
export function clean(text, options = {}) {
  if (typeof text !== 'string') {
    throw new TypeError('clean() expects a string');
  }
  const ruleState = { ...defaultRuleState(), ...(options.rules ?? {}) };
  const report = detect(text, { rules: ruleState });

  let out = applyEdits(text, resolveEdits(collectEdits(text, ruleState)));

  // NFKC runs last so the rules see the text as it was pasted. It is a
  // whole-string transform rather than an edit, and it is destructive for
  // characters such as fractions and superscripts, so it is opt-in.
  if (options.normalizeUnicode) {
    out = out.normalize('NFKC');
  }

  return { text: out, report, changed: out !== text };
}

export { RULES, RULES_BY_ID, defaultRuleState };
