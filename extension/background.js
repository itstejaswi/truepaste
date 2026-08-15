/**
 * Service worker.
 *
 * Owns the context menu and performs clean-in-place on the current selection.
 * All work happens here or in the injected function; nothing is sent anywhere.
 *
 * The extension holds no host permissions. activeTab grants access to a single
 * tab, only for as long as it takes to service an explicit right-click, and is
 * revoked immediately afterwards.
 */

import { clean } from './core/clean.js';
import { defaultRuleState } from './core/rules.js';

const MENU_CLEAN = 'trustpaste-clean-selection';
const MENU_INSPECT = 'trustpaste-inspect-selection';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_CLEAN,
      title: 'Clean selected text',
      contexts: ['selection', 'editable'],
    });
    chrome.contextMenus.create({
      id: MENU_INSPECT,
      title: 'Inspect selected text for hidden data',
      contexts: ['selection'],
    });
  });
});

/** Load the user's saved rule preferences, falling back to the defaults. */
async function loadRuleState() {
  const stored = await chrome.storage.local.get('rules');
  return { ...defaultRuleState(), ...(stored.rules ?? {}) };
}

/**
 * Injected into the page. Replaces the current selection when it sits in an
 * editable field, and reports whether the replacement was possible.
 */
function replaceSelectionInPage(replacement) {
  const active = document.activeElement;
  const isField =
    active &&
    (active.tagName === 'TEXTAREA' ||
      (active.tagName === 'INPUT' && /^(text|search|url|email|tel)$/i.test(active.type)));

  if (isField) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    const value = active.value;
    active.value = value.slice(0, start) + replacement + value.slice(end);
    active.selectionStart = active.selectionEnd = start + replacement.length;
    active.dispatchEvent(new Event('input', { bubbles: true }));
    return { replaced: true };
  }

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && document.designMode === 'on') {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));
    return { replaced: true };
  }

  if (active && active.isContentEditable) {
    document.execCommand('insertText', false, replacement);
    return { replaced: true };
  }

  return { replaced: false };
}

/** Read the current selection out of the page. */
function readSelectionFromPage() {
  const active = document.activeElement;
  const isField =
    active &&
    (active.tagName === 'TEXTAREA' ||
      (active.tagName === 'INPUT' && typeof active.selectionStart === 'number'));
  if (isField && active.selectionStart !== active.selectionEnd) {
    return active.value.slice(active.selectionStart, active.selectionEnd);
  }
  return String(window.getSelection() ?? '');
}

/** Badge feedback, cleared after a moment. Avoids needing the notifications API. */
async function flashBadge(text, colour) {
  await chrome.action.setBadgeBackgroundColor({ color: colour });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId !== MENU_CLEAN && info.menuItemId !== MENU_INSPECT) return;

  // Prefer the live selection: info.selectionText is normalised by Chrome and
  // loses the very characters we are looking for.
  let source = '';
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readSelectionFromPage,
    });
    source = result ?? '';
  } catch {
    source = info.selectionText ?? '';
  }
  if (!source) return;

  const rules = await loadRuleState();
  const { text, report } = clean(source, { rules });

  if (info.menuItemId === MENU_INSPECT) {
    await chrome.storage.session
      .set({ lastInspection: { report, sample: source.slice(0, 4000) } })
      .catch(() => {});
    await flashBadge(String(report.total), report.total > 0 ? '#b3261e' : '#146c2e');
    return;
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: replaceSelectionInPage,
      args: [text],
    });
    if (result?.replaced) {
      await flashBadge(String(report.total), '#146c2e');
    } else {
      // Read-only context: stash the result so the popup can offer it.
      await chrome.storage.session.set({ pendingResult: text }).catch(() => {});
      await flashBadge('copy', '#8a6d00');
    }
  } catch {
    await flashBadge('!', '#b3261e');
  }
});
