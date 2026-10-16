// -----------------------------------------------------------------------------
// User-facing texts: every message the integration shows (action results,
// toasts, widget labels, connection status) is a multi-language object, picked
// by the core in the user's language with English as the fallback.
//
// The integration speaks English, French, German and Spanish, like its
// manifest and its documentation (docs/en.md, fr.md, de.md, es.md).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/**
 * Build a multi-language text.
 * @param {string} en
 * @param {string} fr
 * @param {string} de
 * @param {string} es
 * @returns {{ en: string, fr: string, de: string, es: string }}
 */
export function t(en, fr, de, es) {
  return { en, fr, de, es };
}

/**
 * Apply the same suffix (a value, a count...) to every language of a text.
 * @param {Record<string, string>} text
 * @param {(value: string, lang: string) => string} format
 */
export function mapText(text, format) {
  return Object.fromEntries(
    Object.entries(text).map(([lang, value]) => [lang, format(value, lang)]),
  );
}
