// @ts-check
// Test helper: replaces globalThis.fetch and records the calls.

/**
 * @typedef {Object} FakeResponse
 * @property {number} [status]
 * @property {unknown} [body] JSON body; omit together with `text` for an empty body.
 * @property {string} [text] Raw (non-JSON) body.
 */

/**
 * @typedef {Object} FakeFetch
 * @property {{ url: string, init: RequestInit | undefined }[]} calls
 * @property {() => void} restore
 */

/**
 * @param {FakeResponse | Error} response
 * @returns {FakeFetch}
 */
export function installFakeFetch(response) {
  const original = globalThis.fetch;
  /** @type {{ url: string, init: RequestInit | undefined }[]} */
  const calls = [];
  globalThis.fetch = /** @type {typeof fetch} */ (
    async (input, init) => {
      calls.push({ url: String(input), init });
      if (response instanceof Error) throw response;
      const status = response.status ?? 200;
      const raw = response.text ?? JSON.stringify(response.body ?? null);
      return new Response(raw, { status });
    }
  );
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
