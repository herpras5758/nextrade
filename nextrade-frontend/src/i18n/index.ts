import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import id from "./locales/id.json";
import en from "./locales/en.json";

// Rule: no string is ever hardcoded in a component. Every piece of UI text
// flows through this layer. Default language is chosen by the user on
// first login and persisted to their profile (see AuthContext) — it is
// NOT auto-detected from the browser, per product decision.
export const SUPPORTED_LANGUAGES = ["id", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// Direction metadata for every language the platform's i18n architecture
// is designed to support (Rule D). Only "id"/"en" are active in the UI
// language switcher today, but this map is the single place that decides
// text direction — adding "ar" later means adding one entry here, not
// rewriting layout CSS, because all layout already uses logical
// properties (see globals.css).
export const LANGUAGE_DIRECTION: Record<string, "ltr" | "rtl"> = {
  id: "ltr",
  en: "ltr",
  zh: "ltr",
  ar: "rtl",
};

export function applyDocumentDirection(language: string) {
  document.documentElement.dir = LANGUAGE_DIRECTION[language] ?? "ltr";
  document.documentElement.lang = language;
}

i18n.use(initReactI18next).init({
  resources: {
    id: { translation: id },
    en: { translation: en },
  },
  lng: undefined, // set explicitly after user/tenant profile loads
  fallbackLng: "id",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", applyDocumentDirection);

export default i18n;
