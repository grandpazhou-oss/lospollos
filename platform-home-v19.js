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
    root.STCTPlatformV19.platformHome = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (I18n, NavigationModel) {
  "use strict";

  function element(documentValue, tag, className, text) {
    const node = documentValue.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function workspaceIcon(documentValue, workspace) {
    const icon = element(documentValue, "span", "platform-home-card-icon");
    icon.setAttribute("aria-hidden", "true");
    const paths = workspace === "DESIGN"
      ? '<path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/>'
      : '<path d="M3 5h11v12H3V5Zm11 5h4l3 4v3h-7"/><circle cx="6.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>';
    icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${paths}</svg>`;
    return icon;
  }

  function workspaceCard(documentValue, locale, workspace) {
    const lower = workspace.toLowerCase();
    const card = element(documentValue, "button", `platform-home-card platform-home-card-${lower}`);
    card.type = "button";
    card.dataset.platformWorkspace = workspace;
    card.setAttribute("aria-label", I18n.translate(`workspace.switch.${lower}`, locale));
    const header = element(documentValue, "span", "platform-home-card-header");
    header.append(workspaceIcon(documentValue, workspace));
    const title = element(documentValue, "span", "platform-home-card-title");
    title.append(element(documentValue, "strong", "", I18n.translate(`workspace.${lower}.subtitle`, locale)));
    title.append(element(documentValue, "small", "", workspace));
    header.append(title);
    card.append(header);
    card.append(element(documentValue, "span", "platform-home-card-summary", I18n.translate(`home.${lower}.summary`, locale)));
    card.append(element(documentValue, "span", "platform-home-card-capabilities", I18n.translate(`home.${lower}.capabilities`, locale)));
    const action = element(documentValue, "span", "platform-home-card-action", I18n.translate(`home.open.${lower}`, locale));
    action.append(element(documentValue, "span", "", "→"));
    card.append(action);
    const group = element(documentValue, "section", `platform-home-choice platform-home-choice-${lower}`);
    group.append(card);
    const tasks = element(documentValue, "nav", "platform-home-tasks");
    tasks.setAttribute("aria-label", I18n.translate(`workspace.${lower}.subtitle`, locale));
    const routes = workspace === "DESIGN"
      ? [["/design/facility-location", "route.design.facility"], ["/design/network-scenarios", "route.design.scenarios"]]
      : [["/command/dispatch", "route.command.dispatch"], ["/command/alerts", "route.command.alerts"]];
    routes.forEach(([path, key]) => {
      const link = element(documentValue, "button", "platform-home-task", I18n.translate(key, locale));
      link.type = "button";
      link.dataset.platformRoute = path;
      tasks.append(link);
    });
    group.append(tasks);
    return group;
  }

  function render(options) {
    const { document: documentValue, target, locale } = options;
    const home = element(documentValue, "div", "platform-home");
    const intro = element(documentValue, "header", "platform-home-intro");
    intro.append(element(documentValue, "p", "platform-home-kicker", I18n.translate("platform.name", locale)));
    intro.append(element(documentValue, "h1", "platform-home-question", I18n.translate("home.question", locale)));
    intro.append(element(documentValue, "p", "platform-home-lead", I18n.translate("home.lead", locale)));
    home.append(intro);
    const cards = element(documentValue, "div", "platform-home-cards");
    cards.append(workspaceCard(documentValue, locale, "DESIGN"), workspaceCard(documentValue, locale, "COMMAND"));
    home.append(cards);
    const shared = element(documentValue, "nav", "platform-home-shared");
    shared.setAttribute("aria-label", I18n.translate("nav.platform", locale));
    shared.append(element(documentValue, "span", "platform-home-shared-label", "PLATFORM"));
    NavigationModel.PLATFORM_ITEMS.forEach((navItem) => {
      const button = element(documentValue, "button", "platform-home-shared-link", I18n.translate(navItem.labelKey, locale));
      button.type = "button";
      button.dataset.platformRoute = navItem.path;
      shared.append(button);
    });
    home.append(shared);
    target.append(home);
    return home;
  }

  return Object.freeze({ render });
});
