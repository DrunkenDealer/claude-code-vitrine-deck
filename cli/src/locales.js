// Store locales a deck can be written in. Curated from the App Store Connect
// localization list, which is the shorter of the two stores' — a locale Apple
// won't take is a folder nobody can upload.
//
// Imported by both the Node render and the web bundle, so it has to stay free of
// node-only APIs, the same rule fonts.js and devices.js follow.
//
// `script` is what the font hint reads: none of the bundled families in fonts.js
// draw anything outside Latin, and `fontFamilyStack` falls back to a system
// stack that differs between the browser preview and the render container — so a
// non-Latin locale that hasn't picked a covering family renders two different
// ways and neither is the one on screen.
//
// `dir` is carried but not yet honoured: slideHtml.js emits no `dir` and resolves
// alignment through hardcoded left/right, so RTL locales are filtered out of the
// picker rather than offered and silently rendered the wrong way round.

const locale = (id, label, native, script = "latin", dir = "ltr") => ({
  id,
  label,
  native,
  script,
  dir,
});

export const LOCALES = [
  locale("ar-SA", "Arabic", "العربية", "arabic", "rtl"),
  locale("ca", "Catalan", "Català"),
  locale("cs", "Czech", "Čeština"),
  locale("da", "Danish", "Dansk"),
  locale("de-DE", "German", "Deutsch"),
  locale("el", "Greek", "Ελληνικά", "greek"),
  locale("en-AU", "English (Australia)", "English (Australia)"),
  locale("en-CA", "English (Canada)", "English (Canada)"),
  locale("en-GB", "English (UK)", "English (UK)"),
  locale("en-US", "English (US)", "English (US)"),
  locale("es-ES", "Spanish (Spain)", "Español (España)"),
  locale("es-MX", "Spanish (Mexico)", "Español (México)"),
  locale("fi", "Finnish", "Suomi"),
  locale("fr-CA", "French (Canada)", "Français (Canada)"),
  locale("fr-FR", "French", "Français"),
  locale("he", "Hebrew", "עברית", "hebrew", "rtl"),
  locale("hi", "Hindi", "हिन्दी", "devanagari"),
  locale("hr", "Croatian", "Hrvatski"),
  locale("hu", "Hungarian", "Magyar"),
  locale("id", "Indonesian", "Bahasa Indonesia"),
  locale("it", "Italian", "Italiano"),
  locale("ja", "Japanese", "日本語", "cjk-ja"),
  locale("ko", "Korean", "한국어", "cjk-ko"),
  locale("ms", "Malay", "Bahasa Melayu"),
  locale("nl-NL", "Dutch", "Nederlands"),
  locale("no", "Norwegian", "Norsk"),
  locale("pl", "Polish", "Polski"),
  locale("pt-BR", "Portuguese (Brazil)", "Português (Brasil)"),
  locale("pt-PT", "Portuguese (Portugal)", "Português (Portugal)"),
  locale("ro", "Romanian", "Română"),
  locale("ru", "Russian", "Русский", "cyrillic"),
  locale("sk", "Slovak", "Slovenčina"),
  locale("sv", "Swedish", "Svenska"),
  locale("th", "Thai", "ไทย", "thai"),
  locale("tr", "Turkish", "Türkçe"),
  locale("uk", "Ukrainian", "Українська", "cyrillic"),
  locale("vi", "Vietnamese", "Tiếng Việt"),
  locale("zh-Hans", "Chinese (Simplified)", "简体中文", "cjk-hans"),
  locale("zh-Hant", "Chinese (Traditional)", "繁體中文", "cjk-hant"),
];

export const DEFAULT_LOCALE = "en-US";

const BY_ID = new Map(LOCALES.map((l) => [l.id, l]));

export const getLocale = (id) => BY_ID.get(id) ?? null;
export const isLocaleId = (id) => BY_ID.has(id);

// A locale the editor can actually render. RTL is excluded rather than offered:
// the render HTML has no `dir`, so an Arabic caption would come out left-aligned
// and left-to-right, which is worse than not being on the list.
export const isSupportedLocale = (id) => BY_ID.get(id)?.dir === "ltr";
export const supportedLocales = () => LOCALES.filter((l) => l.dir === "ltr");

// Whether a locale needs a font the bundled families don't have. Latin is the
// only script every one of them draws.
export const needsFontCoverage = (id) => {
  const l = BY_ID.get(id);
  return Boolean(l) && l.script !== "latin";
};

export const localeLabel = (id) => BY_ID.get(id)?.label ?? id;
