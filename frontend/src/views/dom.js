// @ts-check

/**
 * Creates an element. Content goes through textContent only: never innerHTML.
 * @param {string} tag
 * @param {string | null} testId Value of the data-testid attribute, if any.
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function element(tag, testId, text) {
  const el = document.createElement(tag);
  if (testId) el.dataset.testid = testId;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * @param {string} testId
 * @param {string} label
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
export function button(testId, label, onClick) {
  const el = /** @type {HTMLButtonElement} */ (element('button', testId, label));
  el.type = 'button';
  el.addEventListener('click', onClick);
  return el;
}
