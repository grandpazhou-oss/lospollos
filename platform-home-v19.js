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
    const identity = element(documentValue, "details", "platform-home-runtime");
    identity.dataset.platformBuild = documentValue.querySelector('meta[name="stct-build"]')?.content || 'STCT';
    identity.append(element(documentValue, "summary", "", ({zh:'当前版本与入口 · 受控本地试用',en:'Version and entry · controlled local trial',ja:'版と入口・管理されたローカル試用'})[locale] || 'Version and entry'));
    identity.append(element(documentValue, "p", "", `${identity.dataset.platformBuild} · index.html`));
    const directory = globalThis.STCTPlatformV19?.activeServiceDirectory;
    if (directory) identity.append(element(documentValue, "p", "", `${({zh:'供应链求解端点（连接状态请在分析页检查）',en:'Supply solver endpoint (check connection in the analysis page)',ja:'供給網求解エンドポイント（接続は分析画面で確認）'})[locale] || 'Supply solver endpoint'}: ${directory.endpoint('SUPPLY_CHAIN_PERIOD')}`));
    intro.append(identity);
    const actions = element(documentValue, "nav", "platform-home-actions");
    actions.setAttribute("aria-label", I18n.translate("home.actions", locale));
    [["data", "/platform/data"], ["supply", "/design/supply-chain-study"], ["dispatch", "/command/dispatch"]].forEach(([key, path]) => {
      const button = element(documentValue, "button", "platform-home-action");
      button.type = "button";
      button.dataset.platformRoute = path;
      button.append(element(documentValue, "strong", "", I18n.translate(`home.action.${key}`, locale)));
      button.append(element(documentValue, "small", "", I18n.translate(`home.action.${key}.detail`, locale)));
      actions.append(button);
    });
    if(options.currentStudy){const continueButton=element(documentValue,'button','platform-home-action');continueButton.type='button';continueButton.dataset.platformRoute=options.currentStudy.studyKind==='SUPPLY_CHAIN_PERIOD'?'/design/supply-chain-study':options.currentStudy.studyKind==='FACILITY'?'/design/facility-location':'/design/overview';continueButton.append(element(documentValue,'strong','',({zh:'继续当前研究',en:'Continue current study',ja:'現在の研究を続ける'})[locale]));continueButton.append(element(documentValue,'small','',`${options.currentStudy.name||options.currentStudy.studyId} · ${options.currentStudy.saveLabel||''}`));actions.prepend(continueButton);}
    intro.append(actions);
    home.append(intro);
    const cards = element(documentValue, "div", "platform-home-cards");
    cards.append(workspaceCard(documentValue, locale, "DESIGN"), workspaceCard(documentValue, locale, "COMMAND"));
    home.append(cards);
    if(options.listStudies){
      const recent=element(documentValue,'section','platform-home-recent');
      recent.append(element(documentValue,'h2','',({zh:'最近保存的研究',en:'Recently saved studies',ja:'最近保存した研究'})[locale]));
      home.append(recent);
      Promise.resolve().then(options.listStudies).then(rows=>{
        if(!home.isConnected)return;
        const titles={SUPPLY_CHAIN_STUDY:['供应链设计','Supply chain','供給網'],FACILITY_STUDY:['仓库选址','Facility location','施設選址'],DESIGN_STUDY:['网络研究','Network study','ネットワーク研究']};
        const saved=rows.filter(row=>!row.archived&&!row.deleted&&titles[row.type]).sort((a,b)=>String(b.savedAt||'').localeCompare(String(a.savedAt||''))).slice(0,3);
        for(const row of saved){const link=element(documentValue,'button','platform-home-action');link.type='button';link.dataset.platformRoute='/platform/scenarios?scenarioId='+encodeURIComponent(row.id);link.append(element(documentValue,'strong','',row.name||row.studyId||row.id));const info=element(documentValue,'small','',`${titles[row.type][['zh','en','ja'].indexOf(locale)]} · ${row.savedAt?new Date(row.savedAt).toLocaleString(locale):'—'}`);info.title=row.savedAt||'';link.append(info);recent.append(link);}
        if(!saved.length)recent.append(element(documentValue,'p','',({zh:'还没有保存的研究。从数据中心开始导入。',en:'No saved studies yet. Start in the Data Hub.',ja:'保存した研究がありません。データセンターで取込を開始してください。'})[locale]));
      }).catch(()=>{if(home.isConnected)recent.append(element(documentValue,'p','',({zh:'最近研究暂时未读到，请打开情景库重试。',en:'Recent studies could not be read. Retry in the Scenario Library.',ja:'最近の研究を読み込めません。シナリオ一覧で再試行してください。'})[locale]));});
    }
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
