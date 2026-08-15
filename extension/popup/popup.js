/**
 * Popup controller.
 *
 * Paste in, clean, copy out. The popup never touches the page and never opens
 * a network connection; the extension CSP forbids the latter outright.
 */

import { clean } from '../core/clean.js';
import { RULES, defaultRuleState } from '../core/rules.js';

const $ = (id) => document.getElementById(id);
const input = $('input');
const reportEl = $('report');
const rulesPanel = $('rules-panel');
const toggleRules = $('toggle-rules');

let ruleState = defaultRuleState();

const LAYER_TITLES = {
  1: 'Hidden and invisible characters',
  3: 'Formatting and style',
};

/** Load saved preferences, then render the rule list. */
async function init() {
  try {
    const stored = await chrome.storage.local.get('rules');
    ruleState = { ...ruleState, ...(stored.rules ?? {}) };
  } catch {
    // Storage unavailable: carry on with defaults.
  }
  renderRules();

  // A context-menu clean on a read-only page leaves its result here.
  try {
    const { pendingResult } = await chrome.storage.session.get('pendingResult');
    if (pendingResult) {
      input.value = pendingResult;
      await chrome.storage.session.remove('pendingResult');
    }
  } catch {
    // Session storage is optional.
  }
  input.focus();
}

function renderRules() {
  rulesPanel.replaceChildren();
  for (const layer of [1, 3]) {
    const inLayer = RULES.filter((r) => r.layer === layer);
    if (inLayer.length === 0) continue;

    const title = document.createElement('p');
    title.className = 'group-title';
    title.textContent = LAYER_TITLES[layer];
    rulesPanel.append(title);

    for (const rule of inLayer) {
      const label = document.createElement('label');
      label.className = 'rule';
      label.title = rule.description;

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = Boolean(ruleState[rule.id]);
      box.addEventListener('change', () => {
        ruleState[rule.id] = box.checked;
        chrome.storage.local.set({ rules: ruleState }).catch(() => {});
      });

      const text = document.createElement('span');
      text.className = 'rule-text';
      const name = document.createElement('span');
      name.className = 'rule-name';
      name.textContent = rule.label;
      text.append(name);

      if (rule.destructive) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'may alter valid text';
        name.append(tag);
      }

      label.append(box, text);
      rulesPanel.append(label);
    }
  }
}

/** Render the findings for a completed clean. */
function renderReport(report, copied) {
  reportEl.replaceChildren();

  const summary = document.createElement('p');
  summary.className = `summary ${report.total > 0 ? 'found' : 'ok'}`;
  if (report.total === 0) {
    summary.textContent = copied ? 'Nothing hidden found. Copied.' : 'Nothing hidden found.';
  } else {
    const noun = report.total === 1 ? 'item' : 'items';
    summary.textContent = `Removed ${report.total} ${noun}${copied ? '. Copied.' : '.'}`;
  }
  reportEl.append(summary);

  if (report.findings.length > 0) {
    const list = document.createElement('ul');
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
    reportEl.append(list);
  }

  const { tagText, variationSelectors } = report.payloads;
  if (tagText) addPayload('Hidden text recovered', tagText);
  if (variationSelectors.text) {
    addPayload('Hidden data recovered', variationSelectors.text);
  } else if (variationSelectors.bytes > 0) {
    addPayload(
      'Hidden data recovered',
      `${variationSelectors.bytes} bytes (not printable text)`
    );
  }
}

function addPayload(labelText, value) {
  const box = document.createElement('div');
  box.className = 'payload';
  const label = document.createElement('span');
  label.className = 'payload-label';
  label.textContent = labelText;
  const code = document.createElement('code');
  code.textContent = value;
  box.append(label, code);
  reportEl.append(box);
}

async function runClean() {
  const source = input.value;
  if (!source) {
    input.focus();
    return;
  }

  const { text, report } = clean(source, { rules: ruleState });
  input.value = text;

  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    input.select();
  }
  renderReport(report, copied);
}

$('clean').addEventListener('click', runClean);

$('clear').addEventListener('click', () => {
  input.value = '';
  reportEl.replaceChildren();
  input.focus();
});

toggleRules.addEventListener('click', () => {
  const open = rulesPanel.hidden;
  rulesPanel.hidden = !open;
  toggleRules.setAttribute('aria-expanded', String(open));
});

// Ctrl/Cmd+Enter cleans without reaching for the mouse.
input.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    runClean();
  }
});

init();
