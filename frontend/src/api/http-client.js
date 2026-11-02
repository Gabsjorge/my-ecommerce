// @ts-check

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status; 0 when no response was received.
   * @param {string} code API error code, or NETWORK_ERROR / UNKNOWN_ERROR.
   * @param {string} message
   * @param {unknown} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {Response} res
 * @returns {Promise<ApiError>}
 */
async function toApiError(res) {
  try {
    const body = await res.json();
    const error = body?.error;
    if (error && typeof error.code === 'string') {
      return new ApiError(res.status, error.code, String(error.message ?? ''), error.details);
    }
  } catch {
    // Body is not JSON: fall through to UNKNOWN_ERROR.
  }
  return new ApiError(res.status, 'UNKNOWN_ERROR', `HTTP ${res.status}`);
}

/**
 * @param {string} method
 * @param {string} path Relative path (same origin, proxied by nginx).
 * @param {unknown} [body] Serialized as JSON when provided.
 * @returns {Promise<unknown>}
 */
async function request(method, path, body) {
  /** @type {RequestInit} */
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Network error');
  }
  if (!res.ok) {
    throw await toApiError(res);
  }
  try {
    return await res.json();
  } catch {
    throw new ApiError(res.status, 'UNKNOWN_ERROR', 'Invalid response body');
  }
}

/** @param {string} path */
export const getJson = (path) => request('GET', path);

/**
 * @param {string} path
 * @param {unknown} [body]
 */
export const postJson = (path, body) => request('POST', path, body);

/**
 * @param {string} path
 * @param {unknown} body
 */
export const patchJson = (path, body) => request('PATCH', path, body);

/** @param {string} path */
export const deleteJson = (path) => request('DELETE', path);
