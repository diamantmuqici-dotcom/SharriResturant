import sq from "./sq.js";
import en from "./en.js";

const dictionaries = {
  sq,
  en
};

let currentLanguage = "sq";

export function setLanguage(lang) {
  if (dictionaries[lang]) {
    currentLanguage = lang;
    document.documentElement.lang = lang === "sq" ? "sq" : "en";
    localStorage.setItem("sharri_lang_v1", lang);
  }

  return currentLanguage;
}

export function getLanguage() {
  return currentLanguage;
}

export function t(key) {
  return dictionaries[currentLanguage]?.[key] ?? dictionaries.en[key] ?? key;
}

export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });

  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
}

export function initI18n() {
  const savedLanguage = localStorage.getItem("sharri_lang_v1");
  const language = dictionaries[savedLanguage] ? savedLanguage : "sq";
  setLanguage(language);
  applyI18n();
  return language;
}