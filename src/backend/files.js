/** Hand a file to the user (iOS: Share sheet → "Save to Files"), or pick one to import. */

/**
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 * Call from a tap handler: iOS only opens the share sheet from a user gesture.
 */
export async function saveFile({ filename, blob, mime }) {
  const file = new File([blob], filename, { type: mime || blob.type });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // Any other share failure: fall through to a normal download.
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/** Opens the file picker and resolves with the chosen File (or null if dismissed). */
export function pickFile(accept = 'application/json,.json') {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}
