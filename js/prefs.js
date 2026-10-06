(() => {
  try {
    const langs = ["en", "ar", "fr", "de", "es", "nl", "it"];
    const html = document.documentElement;
    let theme = localStorage.getItem("cineaura_theme");
    if (theme !== "day" && theme !== "night") theme = "night";
    // A language is stored only when the visitor picks one (header menu / settings).
    // Until then the page follows the browser's language list, first supported match.
    let lang = localStorage.getItem("cineaura_lang");
    if (!langs.includes(lang)) {
      lang = "en";
      const list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
      for (const raw of list) {
        const code = String(raw || "").toLowerCase().split("-")[0];
        if (langs.includes(code)) {
          lang = code;
          break;
        }
      }
    }
    if (!localStorage.getItem("cineaura_theme")) localStorage.setItem("cineaura_theme", theme);
    html.dataset.theme = theme;
    html.lang = lang;
    html.dir = lang === "ar" ? "rtl" : "ltr";
    // Load the language pack (lang/<language>.js) before the page scripts run.
    const files = { ar: "arabic", fr: "french", de: "german", es: "spanish", nl: "dutch", it: "italian" };
    if (files[lang] && document.readyState === "loading") {
      document.write('<script src="lang/' + files[lang] + '.js"><\/script>');
    }
  } catch {
    /* keep markup defaults */
  }
})();
