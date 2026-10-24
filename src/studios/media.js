'use strict';
// Shared conversion: a studio tool result -> what the model sees (JSON text + images) and what the UI can show.

/**
 * Tool handlers return plain JSON-able values. They may carry images under `__images: [{mime, base64}]`;
 * Sprite's own convention `{text, image}` is understood too.
 * Returns {text, images}.
 */
function split(result) {
  if (result === undefined || result === null) return { text: 'ok', images: [] };
  if (typeof result === 'string') return { text: result, images: [] };
  if (typeof result !== 'object') return { text: String(result), images: [] };
  const images = [];
  let rest = result;
  if (Array.isArray(result.__images)) {
    images.push(...result.__images);
    rest = { ...result }; delete rest.__images;
  }
  if (result.image && result.image.base64 && (result.text !== undefined || Object.keys(result).length <= 2)) {
    images.push(result.image);
    rest = result.text !== undefined ? result.text : { ok: true };
  }
  const text = typeof rest === 'string' ? rest : JSON.stringify(rest);
  return { text, images };
}

module.exports = { split };
