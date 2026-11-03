// @ts-check
// Test helper: a minimal DOM that supports what views/ uses (no jsdom, no dependency).
// Text only enters through textContent/append(string), mirroring the production rule against innerHTML.

class FakeText {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
    /** @type {FakeElement | null} */
    this.parent = null;
  }
}

/** @typedef {FakeElement | FakeText} FakeNode */

export class FakeElement {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    /** @type {FakeNode[]} */
    this.children = [];
    /** @type {FakeElement | null} */
    this.parent = null;
    /** @type {Record<string, string>} */
    this.dataset = {};
    /** @type {Record<string, string>} */
    this.attributes = {};
    /** @type {Record<string, ((event: any) => void)[]>} */
    this.listeners = {};
    this.className = '';
    this.type = '';
    this.value = '';
    this.disabled = false;
    this.href = '';
    this.inputMode = '';
    this.placeholder = '';
  }

  /** @param {string} text */
  set textContent(text) {
    this.replaceChildren(text);
  }

  get textContent() {
    return this.children
      .map((child) => (child instanceof FakeText ? child.text : child.textContent))
      .join('');
  }

  /** @param {(FakeNode | string)[]} nodes */
  #adopt(nodes) {
    return nodes.map((node) => {
      const adopted = typeof node === 'string' ? new FakeText(node) : node;
      adopted.parent = this;
      return adopted;
    });
  }

  /** @param {(FakeNode | string)[]} nodes */
  append(...nodes) {
    this.children.push(...this.#adopt(nodes));
  }

  /** @param {(FakeNode | string)[]} nodes */
  prepend(...nodes) {
    this.children.unshift(...this.#adopt(nodes));
  }

  /** @param {(FakeNode | string)[]} nodes */
  replaceChildren(...nodes) {
    this.children = this.#adopt(nodes);
  }

  /** Inserts the nodes right after this element, in its parent. @param {FakeNode} node */
  after(node) {
    const parent = this.parent;
    if (!parent) throw new Error('after() needs a parent');
    node.parent = parent;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
  }

  /** @param {string} name @param {string} value */
  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  /** @param {string} type @param {(event: any) => void} listener */
  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  /** Runs the listeners of an event type. @param {string} type @param {object} [event] */
  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  click() {
    this.dispatch('click');
  }

  /** @returns {FakeElement[]} All descendant elements with this data-testid. @param {string} testId */
  findAll(testId) {
    /** @type {FakeElement[]} */
    const found = [];
    for (const child of this.children) {
      if (child instanceof FakeText) continue;
      if (child.dataset.testid === testId) found.push(child);
      found.push(...child.findAll(testId));
    }
    return found;
  }

  /** @param {string} testId */
  find(testId) {
    return this.findAll(testId)[0] ?? null;
  }

  /** Sorted testids of every descendant that has one. */
  testIds() {
    /** @type {string[]} */
    const ids = [];
    for (const child of this.children) {
      if (child instanceof FakeText) continue;
      if (child.dataset.testid) ids.push(child.dataset.testid);
      ids.push(...child.testIds());
    }
    return ids;
  }
}

/** @returns {{ root: HTMLElement, restore: () => void }} root is typed as HTMLElement for the views. */
export function installFakeDom() {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: (/** @type {string} */ tag) => new FakeElement(tag) },
  });
  return {
    root: /** @type {any} */ (new FakeElement('div')),
    restore() {
      if (original) Object.defineProperty(globalThis, 'document', original);
      else delete (/** @type {any} */ (globalThis).document);
    },
  };
}
