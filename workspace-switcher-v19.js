(function (root, factory) {
  "use strict";
  const i18n = typeof module === "object" && module.exports
    ? require("./platform-navigation-i18n-v19.js")
    : root.STCTPlatformV19.navigationI18n;
  const model = typeof module === "object" && module.exports
    ? require("./workspace-navigation-model-v19.js")
    : root.STCTPlatformV19.navigationModel;
  const api = factory(i18n, model);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.workspaceSwitcher = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (I18n, NavigationModel) {
  "use strict";

  function node(documentValue, tag, className, text) {
    const result = documentValue.createElement(tag);
    if (className) result.className = className;
    if (text != null) result.textContent = text;
    return result;
  }

  function workspaceIcon(documentValue, workspace) {
    const icon = node(documentValue, "span", "platform-workspace-icon");
    icon.setAttribute("aria-hidden", "true");
    const paths = workspace === "DESIGN"
      ? '<path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/>'
      : '<path d="M3 5h11v12H3V5Zm11 5h4l3 4v3h-7"/><circle cx="6.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>';
    icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${paths}</svg>`;
    return icon;
  }

  function render(options) {
    const { document: documentValue, target, model, locale } = options;
    const fragment = documentValue.createDocumentFragment();
    fragment.append(node(documentValue, "p", "platform-nav-section-label", I18n.translate("workspace.label", locale)));
    const list = node(documentValue, "div", "platform-workspace-options");
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", I18n.translate("workspace.label", locale));
    ["DESIGN", "COMMAND"].forEach((workspace) => {
      const identity = NavigationModel.WORKSPACE_IDENTITIES[workspace];
      const lower = workspace.toLowerCase();
      const active = model.activeWorkspace === workspace;
      const retained = model.activeWorkspace === "PLATFORM" && model.businessWorkspace === workspace;
      const button = node(documentValue, "button", `platform-workspace-option platform-workspace-${lower}`);
      button.type = "button";
      button.dataset.platformWorkspace = workspace;
      button.dataset.collapsedLabel = workspace === "DESIGN" ? "D" : "C";
      button.setAttribute("aria-label", I18n.translate(`workspace.switch.${lower}`, locale));
      button.setAttribute("aria-pressed", String(active));
      button.append(workspaceIcon(documentValue, workspace));
      const copy = node(documentValue, "span", "platform-workspace-copy");
      copy.append(node(documentValue, "strong", "", workspace));
      copy.append(node(documentValue, "small", "", I18n.translate(identity.subtitleKey, locale)));
      button.append(copy);
      if (active || retained) {
        const status = node(documentValue, "span", "platform-workspace-status", I18n.translate(active ? "workspace.current" : "workspace.last", locale));
        status.dataset.workspaceStatus = active ? "current" : "retained";
        button.append(status);
      }
      list.append(button);
    });
    fragment.append(list);
    target.replaceChildren(fragment);
    return list;
  }

  return Object.freeze({ render });
});
