(function (root, factory) {
  "use strict";
  const base = root?.STCTTimeline || (typeof require === "function" ? require("./timeline-v14.js") : null);
  const api = factory(base);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.timeline = api;
    root.STCTTimelineV15 = api;
    root.STCTTimeline = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Base) {
  "use strict";

  const VERSION = "stct-timeline-v1.5";
  const BREAK_DISCLOSURE = Object.freeze({
    label: "Configured break window",
    enforcement: "NOT_SOLVER_ENFORCED",
    disclosure: "Not solver-enforced",
  });

  function buildTimeline(plan, scenario, options = {}) {
    const timeline = Base.buildTimeline(plan, scenario, options);
    timeline.version = VERSION;
    timeline.breakSemantics = { ...BREAK_DISCLOSURE };
    timeline.lanes.forEach((lane) => {
      lane.blocks.forEach((block) => {
        if (block.type === Base.BLOCK_TYPES.LUNCH_BREAK) Object.assign(block, BREAK_DISCLOSURE);
      });
    });
    return timeline;
  }

  return {
    ...Base,
    VERSION,
    BREAK_DISCLOSURE,
    buildTimeline,
  };
});
