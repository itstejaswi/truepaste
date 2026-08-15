/**
 * Website controller.
 *
 * Tab routing, theme switching, the animated home demo, and the cleaning tool.
 * Everything runs locally - the page's Content Security Policy forbids network
 * access outright, so there is no transport code here to audit.
 */

import { clean } from '../core/clean.js';
import { RULES, defaultRuleState } from '../core/rules.js';
import { SelectionOverlay } from './overlay.js';

const RULES_KEY = 'truepaste.rules.v1';
const THEME_KEY = 'truepaste.theme.v1';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ theme */

const root = document.documentElement;
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(choice) {
  root.dataset.theme = choice;
  root.classList.toggle('prefers-dark', choice === 'auto' && darkQuery.matches);

  for (const btn of document.querySelectorAll('.theme-btn')) {
    btn.setAttribute('aria-checked', String(btn.dataset.theme === choice));
  }
}

function initTheme() {
  let saved = 'auto';
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'auto') {
      saved = stored;
    }
  } catch {
    // Storage unavailable; auto is a fine default.
  }
  applyTheme(saved);

  for (const btn of document.querySelectorAll('.theme-btn')) {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme);
      try {
        localStorage.setItem(THEME_KEY, btn.dataset.theme);
      } catch {
        // Preference simply won't persist.
      }
    });
  }

  darkQuery.addEventListener('change', () => {
    if (root.dataset.theme === 'auto') applyTheme('auto');
  });
}

/* ------------------------------------------------------------------- tabs */

const VIEWS = ['home', 'tool', 'threats', 'install', 'privacy'];

let overlay = null;

function showView(name, { focus = false } = {}) {
  const view = VIEWS.includes(name) ? name : 'home';

  for (const id of VIEWS) {
    $(`view-${id}`).hidden = id !== view;
  }
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  }

  // The selection survives a view change; its floating button must not.
  overlay?.hide();

  if (location.hash.slice(1) !== view) {
    history.replaceState(null, '', `#${view}`);
  }
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (view === 'tool' && focus) $('input').focus();
  if (view === 'home') startDemo();
}

function initTabs() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => showView(tab.dataset.view, { focus: true }));
  }
  for (const link of document.querySelectorAll('[data-view-link]')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      showView(link.dataset.viewLink, { focus: true });
    });
  }

  // Left and right arrows move between tabs, as expected of a tablist.
  const tabs = [...document.querySelectorAll('.tab')];
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('keydown', (event) => {
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!delta) return;
      event.preventDefault();
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      next.focus();
      showView(next.dataset.view);
    });
  }

  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
  showView(location.hash.slice(1) || 'home');
}

/* ------------------------------------------------------------------ rules */

let ruleState = loadRules();

function loadRules() {
  const base = defaultRuleState();
  try {
    const saved = JSON.parse(localStorage.getItem(RULES_KEY) ?? '{}');
    // Only accept keys we recognise, so stale or edited storage cannot inject.
    for (const rule of RULES) {
      if (typeof saved[rule.id] === 'boolean') base[rule.id] = saved[rule.id];
    }
  } catch {
    // Corrupt or unavailable storage: defaults are correct.
  }
  return base;
}

function saveRules() {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(ruleState));
  } catch {
    // Private mode: preferences won't persist, which is acceptable.
  }
}

const GROUP_TITLES = {
  1: 'Hidden things',
  3: 'Tidying up',
};

function renderRules() {
  const host = $('rules');
  host.replaceChildren();

  for (const layer of [1, 3]) {
    const inLayer = RULES.filter((r) => r.layer === layer);
    if (inLayer.length === 0) continue;

    const title = document.createElement('p');
    title.className = 'rule-group-title';
    title.textContent = GROUP_TITLES[layer];
    host.append(title);

    for (const rule of inLayer) {
      const label = document.createElement('label');
      label.className = 'rule';
      label.title = rule.description;

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = Boolean(ruleState[rule.id]);
      box.dataset.ruleId = rule.id;
      box.addEventListener('change', () => {
        ruleState[rule.id] = box.checked;
        saveRules();
        run();
      });

      const text = document.createElement('span');
      text.textContent = rule.label;
      if (rule.destructive) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'careful';
        text.append(tag);
      }

      label.append(box, text);
      host.append(label);
    }
  }
}

function syncRuleCheckboxes() {
  for (const box of $('rules').querySelectorAll('input[data-rule-id]')) {
    box.checked = Boolean(ruleState[box.dataset.ruleId]);
  }
}

/* ----------------------------------------------------------------- report */

function renderReport(report) {
  const host = $('report');
  host.replaceChildren();
  host.classList.toggle('found', report.total > 0);

  if (!$('input').value) return;

  const heading = document.createElement('h3');
  if (report.total === 0) {
    heading.textContent = 'All clear. Nothing hiding in there.';
  } else {
    const noun = report.total === 1 ? 'thing' : 'things';
    heading.textContent = `Found and removed ${report.total} ${noun}.`;
  }
  host.append(heading);

  if (report.findings.length > 0) {
    const list = document.createElement('ul');
    list.className = 'findings';
    for (const finding of report.findings) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = finding.label;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = String(finding.count);
      li.append(name, count);
      list.append(li);
    }
    host.append(list);
  }

  const { tagText, variationSelectors } = report.payloads;
  if (tagText) addPayload(host, 'Hidden message it was carrying', tagText);
  if (variationSelectors.text) {
    addPayload(host, 'Hidden data it was carrying', variationSelectors.text);
  } else if (variationSelectors.bytes > 0) {
    addPayload(
      host,
      'Hidden data it was carrying',
      `${variationSelectors.bytes} bytes, not readable text`
    );
  }
}

function addPayload(host, labelText, value) {
  const box = document.createElement('div');
  box.className = 'payload';
  const label = document.createElement('span');
  label.className = 'payload-label';
  label.textContent = labelText;
  const code = document.createElement('code');
  code.textContent = value;
  box.append(label, code);
  host.append(box);
}

function run() {
  const { text, report } = clean($('input').value, { rules: ruleState });
  $('output').value = text;
  renderReport(report);
}

/* ----------------------------------------------------------- sample text */

/** Encode ASCII as tag characters - how a hidden payload is actually built. */
const toTagChars = (s) =>
  [...s].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');

/** Encode bytes as variation selectors. */
const toVariationSelectors = (s) =>
  [...s]
    .map((c) => {
      const b = c.charCodeAt(0);
      return b < 16
        ? String.fromCodePoint(0xfe00 + b)
        : String.fromCodePoint(0xe0100 + b - 16);
    })
    .join('');

const SAMPLE =
  `Thanks for the update\u200b - I've reviewed the numbers.${toTagChars('src:asst-4o')}\n` +
  `\n\n\n` +
  `Everything looks\u00a0correct \u2014 though\u202f I'd double-check` +
  ` the Q3 figures.${toVariationSelectors('v2')}\n` +
  `Happy to talk it through\u200d tomorrow.   \n`;

/* ------------------------------------------------------------ home demo */

/**
 * The home panel: shows an innocent-looking paragraph, then reveals the
 * hidden characters one at a time as labelled chips.
 *
 * Built from DOM nodes rather than markup so nothing here can inject.
 */
/**
 * The demo paragraph. Written the way assistant output actually arrives:
 * em-dashes, curly quotes, a bullet, a stray asterisk pair, and a narrow
 * no-break space before the punctuation - on top of the genuinely invisible
 * characters. Built from explicit codepoints so every artefact is visible in
 * the source rather than hidden inside a literal.
 */
const DEMO_TEXT =
  `Hi Sam,\u200b thanks for sending${toTagChars('id:9c4')} the draft \u2014 it reads\u00a0well.\n` +
  `\u2022 The intro could be tighter${toVariationSelectors('w1')}\u202f, I think.`;

const CHIP_LABELS = {
  invisible: 'zero-width',
  tagChars: 'hidden id',
  orphanVariationSelectors: 'watermark',
  exoticSpaces: 'odd space',
  suspiciousJoiners: 'stray joiner',
  bidi: 'reordering',
  dashes: 'em-dash',
  quotes: 'curly quote',
  miscPunctuation: 'bullet',
  markdown: 'markdown',
};

let demoTimers = [];

function clearDemoTimers() {
  for (const t of demoTimers) clearTimeout(t);
  demoTimers = [];
}

function startDemo() {
  const body = $('demo-body');
  const status = $('demo-status');
  const count = $('demo-count');
  if (!body) return;

  clearDemoTimers();

  // Work out where the hidden characters are, using the same engine as the tool.
  // Markdown is excluded here: its edits are multi-character and would produce
  // chips that split words awkwardly in this compressed view.
  const rules = {
    ...defaultRuleState(),
    dashes: true,
    quotes: true,
    miscPunctuation: true,
  };
  const report = clean(DEMO_TEXT, { rules }).report;

  // Rebuild the paragraph, splitting it around each hidden character.
  const marks = [];
  for (const rule of RULES) {
    if (!rules[rule.id]) continue;
    if (!CHIP_LABELS[rule.id]) continue;
    for (const edit of rule.scan(DEMO_TEXT)) {
      marks.push({ ...edit, ruleId: rule.id });
    }
  }
  marks.sort((a, b) => a.start - b.start);

  // Merge adjacent marks from the same rule: a hidden message is one payload,
  // not fourteen separate characters, and should read as one chip.
  const runs = [];
  for (const mark of marks) {
    const last = runs.at(-1);
    if (last && last.ruleId === mark.ruleId && mark.start <= last.end) {
      last.end = mark.end;
      last.count += 1;
    } else {
      runs.push({ ...mark, count: 1 });
    }
  }

  body.replaceChildren();
  const chips = [];
  let cursor = 0;

  for (const run of runs) {
    if (run.start < cursor) continue;
    body.append(document.createTextNode(DEMO_TEXT.slice(cursor, run.start)));

    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent =
      run.count > 1
        ? `${CHIP_LABELS[run.ruleId]} \u00d7${run.count}`
        : CHIP_LABELS[run.ruleId];
    chip.style.visibility = 'hidden';
    body.append(chip);
    chips.push(chip);

    cursor = run.end;
  }
  body.append(document.createTextNode(DEMO_TEXT.slice(cursor)));

  status.textContent = 'Looks perfectly normal\u2026';
  status.classList.remove('found');
  count.textContent = '';

  // Reveal the chips one by one.
  chips.forEach((chip, index) => {
    demoTimers.push(
      setTimeout(() => {
        chip.style.visibility = 'visible';
        count.textContent = index === 0 ? 'wait\u2026' : `${index + 1} found`;
        count.classList.add('found');
      }, 900 + index * 320)
    );
  });

  demoTimers.push(
    setTimeout(() => {
      status.textContent = 'Every one of these is invisible to you.';
      status.classList.add('found');
      count.textContent = `${report.total} hiding in two lines`;
    }, 900 + chips.length * 320 + 400)
  );
}

/* ------------------------------------------------------------------- init */

initTheme();
renderRules();
initTabs();
run();

$('demo-replay').addEventListener('click', startDemo);

$('sample').addEventListener('click', () => {
  $('input').value = SAMPLE;
  run();
  $('input').focus();
});

$('copy').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!$('output').value) return;
  try {
    await navigator.clipboard.writeText($('output').value);
    button.textContent = 'Copied';
  } catch {
    $('output').select();
    button.textContent = 'Press Ctrl+C';
  }
  setTimeout(() => {
    button.textContent = 'Copy';
  }, 1600);
});

$('input').addEventListener('input', run);

$('clear').addEventListener('click', () => {
  $('input').value = '';
  run();
  $('input').focus();
});

new SelectionOverlay({
  field: $('input'),
  getRules: () => ruleState,
  onRulesChange: (next) => {
    ruleState = next;
    saveRules();
    syncRuleCheckboxes();
    run();
  },
  onApply: () => run(),
});
