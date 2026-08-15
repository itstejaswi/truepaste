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

const MENU_CLEAN = 'truepaste-clean-selection';
const MENU_INSPECT = 'truepaste-inspect-selection';

/**
 * Build the context menus.
 *
 * Registered on install and on browser start: a service worker that restarts
 * does not re-run onInstalled, and menus created only there can go missing.
 */
function createMenus() {
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
}

chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);

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

/**
 * Store the last result for the popup to report.
 *
 * Session storage is preferred - it never touches disk - but it is not
 * available in every build, so local storage is the fallback and failure is
 * survivable either way.
 */
async function stashResult(result) {
  try {
    if (chrome.storage.session) {
      await chrome.storage.session.set({ lastResult: result });
      return;
    }
    await chrome.storage.local.set({ lastResult: result });
  } catch (error) {
    console.warn('TruePaste: could not store the result for the popup', error);
  }
}

/**
 * Open the popup so the result can be read. chrome.action.openPopup landed in
 * Chrome 127 and is not available everywhere, so failure is not an error - the
 * badge still reports the count and the popup shows the result when opened.
 */
async function openPopup() {
  try {
    await chrome.action.openPopup();
  } catch {
    // Older browser, or the call is not permitted in this context.
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId !== MENU_CLEAN && info.menuItemId !== MENU_INSPECT) return;

  try {
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
    if (!source) {
      await flashBadge('?', '#8a6d00');
      return;
    }

    const rules = await loadRuleState();
    const { text, report } = clean(source, { rules });

    // Hand the result to the popup so there is something to read, not just a
    // number on a badge. Reporting must never block the clean itself.
    await stashResult({
      report,
      cleaned: text,
      original: source.slice(0, 20000),
      mode: info.menuItemId === MENU_INSPECT ? 'inspect' : 'clean',
      at: Date.now(),
    });

    if (info.menuItemId === MENU_INSPECT) {
      await flashBadge(String(report.total), report.total > 0 ? '#b3261e' : '#146c2e');
      await openPopup();
      return;
    }

    let replaced = false;
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: replaceSelectionInPage,
        args: [text],
      });
      replaced = Boolean(result?.replaced);
    } catch {
      replaced = false;
    }

    if (replaced) {
      await flashBadge(String(report.total), '#146c2e');
      // Replaced in place: only open the report when there is something to say.
      if (report.total > 0) await openPopup();
    } else {
      // Read-only context: the popup carries the cleaned text to copy.
      await flashBadge('copy', '#8a6d00');
      await openPopup();
    }
  } catch (error) {
    console.error('TruePaste: context menu action failed', error);
    await flashBadge('!', '#b3261e');
  }
});
