(function (root, factory) {
  "use strict";
  const i18n = typeof module === "object" && module.exports
    ? require("./platform-navigation-i18n-v19.js")
    : root.STCTPlatformV19.navigationI18n;
  const api = factory(i18n);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.mobileNavigation = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (I18n) {
  "use strict";

  function node(documentValue, tag, className, text) {
    const result = documentValue.createElement(tag);
    if (className) result.className = className;
    if (text != null) result.textContent = text;
    return result;
  }

  function renderTopbar(options) {
    const { document: documentValue, target, model, locale, heading } = options;
    const brand = node(documentValue, "div", "platform-mobile-brand");
    brand.append(node(documentValue, "strong", "", I18n.translate("platform.name", locale)));
    brand.append(node(documentValue, "span", "", model.isHome ? "PLATFORM" : model.businessWorkspace));
    const page = node(documentValue, "span", "platform-mobile-page", heading || I18n.translate("platform.name", locale));
    const menu = node(documentValue, "button", "platform-mobile-menu", "☰");
    menu.type = "button";
    menu.dataset.platformDrawerToggle = "true";
    menu.setAttribute("aria-label", I18n.translate("control.menu", locale));
    menu.setAttribute("aria-expanded", String(model.drawerOpen));
    menu.hidden = model.isHome;
    target.replaceChildren(brand, page, menu);
    return menu;
  }

  function setInteractive(element, interactive) {
    element.setAttribute("aria-hidden", String(!interactive));
    if (interactive) element.removeAttribute("inert");
    else element.setAttribute("inert", "");
  }

  function focusableElements(drawer) {
    return Array.from(drawer.querySelectorAll("button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"))
      .filter((element) => !element.hidden);
  }

  return Object.freeze({ renderTopbar, setInteractive, focusableElements });
});
