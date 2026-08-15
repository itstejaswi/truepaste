/**
 * Selection overlay.
 *
 * Watches a text field for a non-empty selection, shows a small button at the
 * end of the selection, and opens a panel of cleaning options when clicked.
 *
 * Written against a generic "host" interface rather than the page directly, so
 * the same module can drive the website and, later, an opt-in content script
 * without a second implementation.
 */

import { clean } from '../core/clean.js';
import { RULES } from '../core/rules.js';

const LAYER_TITLES = {
  1: 'Hidden characters',
  3: 'Formatting',
};

/** Position of the caret at `index`, measured against a textarea. */
function caretPoint(field, index) {
  const style = window.getComputedStyle(field);
  const mirror = document.createElement('div');

  // Copy the metrics that affect line breaking.
  const copied = [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom',
    'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
    'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
    'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent',
    'whiteSpace', 'wordWrap', 'overflowWrap', 'tabSize',
  ];
  for (const prop of copied) mirror.style[prop] = style[prop];

  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.height = 'auto';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';

  mirror.textContent = field.value.slice(0, index);
  const marker = document.createElement('span');
  // A zero-width-space would be ironic here; use a normal space.
  marker.textContent = ' ';
  mirror.append(marker);
  document.body.append(mirror);

  const top = marker.offsetTop;
  const left = marker.offsetLeft;
  mirror.remove();

  const box = field.getBoundingClientRect();
  return {
    x: box.left + left - field.scrollLeft,
    y: box.top + top - field.scrollTop,
    lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4,
  };
}

export class SelectionOverlay {
  /**
   * @param {object} options
   * @param {HTMLTextAreaElement|HTMLInputElement} options.field  field to watch
   * @param {() => Record<string, boolean>} options.getRules  current rule state
   * @param {(next: Record<string, boolean>) => void} [options.onRulesChange]
   * @param {(result: { text: string, report: object }) => void} [options.onApply]
   */
  constructor({ field, getRules, onRulesChange, onApply }) {
    this.field = field;
    this.getRules = getRules;
    this.onRulesChange = onRulesChange ?? (() => {});
    this.onApply = onApply ?? (() => {});

    this.button = this.#buildButton();
    this.panel = this.#buildPanel();
    document.body.append(this.button, this.panel);

    this.#bind();
  }

  #buildButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tp-float-btn';
    btn.hidden = true;
    btn.setAttribute('aria-label', 'Clean selected text');
    btn.title = 'Clean selected text';

    const img = document.createElement('img');
    img.src = 'assets/icon-32.png';
    img.alt = '';
    img.width = 18;
    img.height = 18;
    btn.append(img);

    const badge = document.createElement('span');
    badge.className = 'tp-float-badge';
    badge.hidden = true;
    btn.append(badge);
    this.badge = badge;

    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => this.#openPanel());
    return btn;
  }

  #buildPanel() {
    const panel = document.createElement('div');
    panel.className = 'tp-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Cleaning options');
    panel.addEventListener('mousedown', (e) => e.preventDefault());

    const head = document.createElement('div');
    head.className = 'tp-panel-head';
    const title = document.createElement('strong');
    title.textContent = 'Clean selection';
    this.summary = document.createElement('span');
    this.summary.className = 'tp-panel-summary';
    head.append(title, this.summary);

    this.ruleList = document.createElement('div');
    this.ruleList.className = 'tp-panel-rules';

    const actions = document.createElement('div');
    actions.className = 'tp-panel-actions';

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'tp-btn tp-btn-primary';
    apply.textContent = 'Clean';
    apply.addEventListener('click', () => this.#apply());

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'tp-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.hide());

    actions.append(apply, cancel);
    panel.append(head, this.ruleList, actions);
    return panel;
  }

  #renderRules() {
    const state = this.getRules();
    this.ruleList.replaceChildren();

    for (const layer of [1, 3]) {
      const inLayer = RULES.filter((r) => r.layer === layer);
      if (inLayer.length === 0) continue;

      const title = document.createElement('p');
      title.className = 'tp-panel-group';
      title.textContent = LAYER_TITLES[layer];
      this.ruleList.append(title);

      for (const rule of inLayer) {
        const label = document.createElement('label');
        label.className = 'tp-panel-rule';
        label.title = rule.description;

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = Boolean(state[rule.id]);
        box.addEventListener('change', () => {
          const next = { ...this.getRules(), [rule.id]: box.checked };
          this.onRulesChange(next);
          this.#updateSummary();
        });

        const text = document.createElement('span');
        text.textContent = rule.label;

        label.append(box, text);
        this.ruleList.append(label);
      }
    }
  }

  /** Current selection, or null when there is nothing selected. */
  #selection() {
    const { selectionStart: start, selectionEnd: end, value } = this.field;
    if (start == null || start === end) return null;
    return { start, end, text: value.slice(start, end) };
  }

  #updateSummary() {
    const selection = this.#selection();
    if (!selection) return;
    const { report } = clean(selection.text, { rules: this.getRules() });
    this.summary.textContent =
      report.total === 0
        ? 'Nothing to remove'
        : `${report.total} to remove`;
    this.summary.classList.toggle('found', report.total > 0);
  }

  /** Show the floating button at the end of the current selection. */
  #showButton() {
    const selection = this.#selection();
    if (!selection) {
      this.hide();
      return;
    }

    const { report } = clean(selection.text, { rules: this.getRules() });
    this.badge.hidden = report.total === 0;
    this.badge.textContent = String(report.total);
    this.button.classList.toggle('has-findings', report.total > 0);

    const point = caretPoint(this.field, selection.end);
    const fieldBox = this.field.getBoundingClientRect();

    // Keep the button inside the field's horizontal bounds and below the line.
    const x = Math.min(Math.max(point.x, fieldBox.left), fieldBox.right - 30);
    const y = point.y + point.lineHeight + 4;

    this.button.style.left = `${Math.round(x + window.scrollX)}px`;
    this.button.style.top = `${Math.round(y + window.scrollY)}px`;
    this.button.hidden = false;
  }

  #openPanel() {
    this.#renderRules();
    this.#updateSummary();

    const btnBox = this.button.getBoundingClientRect();
    this.panel.hidden = false;

    // Measure, then flip above or shift left if it would overflow the viewport.
    const panelBox = this.panel.getBoundingClientRect();
    let left = btnBox.left;
    let top = btnBox.bottom + 6;

    if (left + panelBox.width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - panelBox.width - 12);
    }
    if (top + panelBox.height > window.innerHeight - 12) {
      top = Math.max(12, btnBox.top - panelBox.height - 6);
    }

    this.panel.style.left = `${Math.round(left + window.scrollX)}px`;
    this.panel.style.top = `${Math.round(top + window.scrollY)}px`;
  }

  #apply() {
    const selection = this.#selection();
    if (!selection) return;

    const { text, report } = clean(selection.text, { rules: this.getRules() });
    const value = this.field.value;
    this.field.value =
      value.slice(0, selection.start) + text + value.slice(selection.end);
    this.field.selectionStart = selection.start;
    this.field.selectionEnd = selection.start + text.length;
    this.field.dispatchEvent(new Event('input', { bubbles: true }));

    this.hide();
    this.field.focus();
    this.onApply({ text, report });
  }

  hide() {
    this.button.hidden = true;
    this.panel.hidden = true;
  }

  #bind() {
    const refresh = () => {
      if (!this.panel.hidden) return; // don't move while the panel is open
      this.#showButton();
    };

    // selectionchange is the only event that fires for every selection route:
    // mouse drag, shift-arrow, and Ctrl+A alike.
    document.addEventListener('selectionchange', () => {
      if (document.activeElement !== this.field) return;
      refresh();
    });

    this.field.addEventListener('input', () => this.hide());
    this.field.addEventListener('blur', () => {
      // Allow a click on the button or panel to land first.
      setTimeout(() => {
        if (document.activeElement === this.field) return;
        if (this.panel.contains(document.activeElement)) return;
        this.hide();
      }, 150);
    });

    this.field.addEventListener('scroll', refresh, { passive: true });
    window.addEventListener('scroll', refresh, { passive: true });
    window.addEventListener('resize', () => this.hide());

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.hide();
    });

    document.addEventListener('mousedown', (event) => {
      if (this.panel.hidden) return;
      if (this.panel.contains(event.target)) return;
      if (this.button.contains(event.target)) return;
      this.hide();
    });
  }
}
