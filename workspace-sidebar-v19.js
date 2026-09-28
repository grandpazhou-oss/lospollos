(function (root, factory) {
  "use strict";
  const i18n = typeof module === "object" && module.exports
    ? require("./platform-navigation-i18n-v19.js")
    : root.STCTPlatformV19.navigationI18n;
  const api = factory(i18n);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.workspaceSidebar = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (I18n) {
  "use strict";

  function node(documentValue, tag, className, text) {
    const result = documentValue.createElement(tag);
    if (className) result.className = className;
    if (text != null) result.textContent = text;
    return result;
  }

  const ICON_PATHS = Object.freeze({
    "/design/overview": '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>',
    "/design/facility-location": '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    "/design/network-scenarios": '<path d="M5 5v14m0-7h7a5 5 0 0 0 5-5V5m-5 7a5 5 0 0 1 5 5v2m-3-11 3-3 3 3m-6 8 3 3 3-3"/>',
    "/design/fleet-capacity": '<path d="M4 20V10h4v10m2 0V4h4v16m2 0v-7h4v7M3 20h18"/>',
    "/design/cost-to-serve": '<circle cx="12" cy="12" r="9"/><path d="M15 8h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9m3-10v12"/>',
    "/design/supply-chain-study": '<path d="M3 7h6l3 5 3-5h6M3 17h6l3-5 3 5h6"/><circle cx="3" cy="7" r="1"/><circle cx="21" cy="17" r="1"/>',
    "/design/demand-growth": '<path d="M3 17 9 11l4 4 8-10m-6 0h6v6"/>',
    "/design/resilience": '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6"/>',
    "/design/operational-validation": '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2m-7 9 3 3 5-6"/>',
    "/command/overview": '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>',
    "/command/dispatch": '<path d="M3 5h11v12H3V5Zm11 5h4l3 4v3h-7M6 17v-1m11 1v-1"/><circle cx="6.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>',
    "/command/mission-control": '<circle cx="12" cy="12" r="3"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8m12.8-12.8a9 9 0 0 1 0 12.8M8 8a5.7 5.7 0 0 0 0 8m8-8a5.7 5.7 0 0 1 0 8"/>',
    "/command/execution": '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8Z"/>',
    "/command/plan-vs-actual": '<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
    "/command/driver-simulator": '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M3 10h6m6 0h6m-9 5v6"/>',
    "/command/alerts": '<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v.5"/>',
    "/command/recovery": '<path d="M4 10a8 8 0 1 1 0 5m0-10v5h5"/>',
    "/command/shift-review": '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16m-12 4h3m3 0h2m-8 3h3"/>',
    "/platform/data": '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>',
    "/platform/scenarios": '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    "/platform/trust": '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6"/>',
    "/platform/settings": '<path d="M4 7h7m4 0h5M4 17h11m4 0h1"/><circle cx="13" cy="7" r="2"/><circle cx="17" cy="17" r="2"/>',
  });

  function routeIcon(documentValue, path) {
    const icon = node(documentValue, "span", "platform-nav-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${ICON_PATHS[path] || '<circle cx="12" cy="12" r="8"/>'}</svg>`;
    return icon;
  }

  function routeButton(documentValue, navItem, model, locale) {
    const label = I18n.translate(navItem.labelKey, locale);
    const parentRoutes = {
      "/command/execution": "/command/mission-control",
      "/command/plan-vs-actual": "/command/mission-control",
      "/command/driver-simulator": "/command/mission-control",
      "/command/recovery": "/command/alerts",
    };
    const exact = navItem.path === model.activeRoute;
    const active = exact || navItem.path === parentRoutes[model.activeRoute];
    const button = node(documentValue, "button", `platform-nav-item${active ? " active" : ""}`);
    button.type = "button";
    button.dataset.platformRoute = navItem.path;
    button.title = label;
    if (navItem.path.startsWith("/design/")) {
      const platform = globalThis.STCTPlatformV19;
      const kind = platform?.instance?.studyContext?.snapshot()?.current?.studyKind;
      const access = kind && platform?.studyKindRegistry?.routeCapability(kind, navItem.path);
      if (access) {
        button.dataset.studyCapability = access.status;
        if (["NOT_APPLICABLE", "NEEDS_INPUT", "NOT_IMPLEMENTED"].includes(access.status)) {
          const hint = { zh: "打开后查看适用条件", en: "Open to view applicability", ja: "開いて適用条件を確認" }[locale];
          button.title = `${label} · ${hint}`;
          button.setAttribute("aria-description", hint);
        }
      }
    }
    button.setAttribute("aria-label", label);
    if (exact) button.setAttribute("aria-current", "page");
    else if (active) button.setAttribute("aria-current", "location");
    button.append(routeIcon(documentValue, navItem.path));
    button.append(node(documentValue, "span", "platform-nav-label", label));
    if (active) button.append(node(documentValue, "span", "platform-nav-current", I18n.translate("workspace.current", locale)));
    return button;
  }

  function renderBusiness(options) {
    const { document: documentValue, target, model, locale } = options;
    const fragment = documentValue.createDocumentFragment();
    const secondary=new Set(['/command/execution','/command/plan-vs-actual','/command/driver-simulator','/command/recovery']);
    model.businessGroups.forEach((group) => {
      if(!group.items.some(item=>!secondary.has(item.path)))return;
      const section = node(documentValue, "section", "platform-nav-group");
      section.dataset.navGroup = group.labelKey;
      section.append(node(documentValue, "h2", "platform-nav-group-heading", I18n.translate(group.labelKey, locale)));
      const items = node(documentValue, "div", "platform-nav-items");
      group.items.filter(item=>!secondary.has(item.path)).forEach((navItem) => items.append(routeButton(documentValue, navItem, model, locale)));
      section.append(items);
      fragment.append(section);
    });
    target.setAttribute("aria-label", I18n.translate("nav.business", locale));
    target.replaceChildren(fragment);
  }

  function renderPlatform(options) {
    const { document: documentValue, target, model, locale } = options;
    const section = node(documentValue, "section", "platform-nav-group platform-nav-group-shared");
    section.dataset.navGroup = model.platformGroup.labelKey;
    section.append(node(documentValue, "h2", "platform-nav-group-heading", I18n.translate(model.platformGroup.labelKey, locale)));
    const items = node(documentValue, "div", "platform-nav-items");
    model.platformGroup.items.forEach((navItem) => items.append(routeButton(documentValue, navItem, model, locale)));
    section.append(items);
    target.setAttribute("aria-label", I18n.translate("nav.platform", locale));
    target.replaceChildren(section);
  }

  return Object.freeze({ renderBusiness, renderPlatform, routeButton });
});
