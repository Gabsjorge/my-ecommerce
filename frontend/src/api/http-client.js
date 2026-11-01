// @ts-check

export class HttpError extends Error {
  /** @param {number} status */
  constructor(status) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * @param {string} path Relative path (same origin, proxied by nginx).
 * @returns {Promise<unknown>}
 */
export async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new HttpError(res.status);
  }
  return res.json();
}
