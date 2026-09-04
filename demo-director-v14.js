(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.STCTDemoDirector = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCENES = Object.freeze([
    {
      id: "data-trust",
      number: 1,
      title: "Data Trust",
      targetMode: "director",
      conclusion: "Canonical Scenario, engine and verifier identity are explicit.",
      annotations: ["inputHash", "Verifier status", "Engine"],
      requires: ["canonicalScenario", "verifiedPlan"],
      fallbackView: "trust-table",
    },
    {
      id: "candidate-intelligence",
      number: 2,
      title: "Candidate Intelligence",
      targetMode: "arena",
      conclusion: "The candidate pool uses actual objective labels and verified metrics.",
      annotations: ["Six objectives", "Candidate pool", "Verified metrics"],
      requires: ["candidatePool"],
      fallbackView: "candidate-table",
    },
    {
      id: "scenario-arena",
      number: 3,
      title: "Scenario Arena",
      targetMode: "arena",
      conclusion: "Baseline and candidate differences are shown as observed evidence.",
      annotations: ["Plan A/B", "Delta Ribbon", "Change Set"],
      requires: ["baselinePlan", "candidatePlan"],
      fallbackView: "arena-table",
    },
    {
      id: "what-if",
      number: 4,
      title: "What-if",
      targetMode: "arena",
      conclusion: "Scenario deltas are separated from same-input improvement claims.",
      annotations: ["Scenario changed", "+1 vehicle", "inputHash"],
      requires: ["whatIfScenario"],
      fallbackView: "scenario-delta-table",
    },
    {
      id: "human-in-loop",
      number: 5,
      title: "Human in the Loop",
      targetMode: "timeline",
      conclusion: "A manual proposal is verified transactionally and remains undoable.",
      annotations: ["Preview", "Verifier", "Undo"],
      requires: ["manualCapability"],
      fallbackView: "manual-audit-table",
    },
    {
      id: "mission-replay",
      number: 6,
      title: "Mission Control Replay",
      targetMode: "replay",
      conclusion: "Verified schedule playback and simulated delay share deterministic state.",
      annotations: ["Replay", "Simulated delay", "simulationHash"],
      requires: ["replayPlan"],
      fallbackView: "fleet-timeline",
    },
    {
      id: "outcome",
      number: 7,
      title: "Outcome",
      targetMode: "director",
      conclusion: "Service, distance, cost, CO2 and trust boundaries are shown together.",
      annotations: ["Outcome", "Verifier PASS", "Known limits"],
      requires: ["verifiedPlan"],
      fallbackView: "outcome-table",
    },
  ]);

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function identityEqual(left, right) {
    return ["contentHash", "inputHash", "requestHash", "planHash", "manualRevision"].every((field) => left?.[field] === right?.[field]);
  }

  function prerequisiteStatus(scene, prerequisites = {}) {
    const missing = scene.requires.filter((key) => !prerequisites[key]);
    return {
      status: missing.length ? "MISSING" : "READY",
      missing,
      message: missing.length ? `Prerequisite required: ${missing.join(", ")}` : "Prerequisites ready",
    };
  }

  function sceneView(scene, prerequisites, environment) {
    return {
      ...clone(scene),
      prerequisite: prerequisiteStatus(scene, prerequisites),
      presentation: environment.webglAvailable ? "PRIMARY" : "NO_WEBGL_FALLBACK",
      evidenceView: environment.webglAvailable ? scene.targetMode : scene.fallbackView,
      transitionMs: environment.reducedMotion ? 0 : 300,
    };
  }

  function createDirectorController(options = {}) {
    const captureState = options.captureState || (() => ({}));
    const restoreState = options.restoreState || (() => {});
    const getIdentity = options.getIdentity || (() => ({}));
    const onScene = options.onScene || (() => {});
    const onTemporarySimulation = options.onTemporarySimulation || (() => {});
    const onClearSimulation = options.onClearSimulation || (() => {});
    let prerequisites = clone(options.prerequisites || {});
    let environment = {
      reducedMotion: Boolean(options.reducedMotion),
      webglAvailable: options.webglAvailable !== false,
      mobile: Boolean(options.mobile),
    };
    let state = {
      active: false,
      status: "idle",
      sceneIndex: 0,
      presentationMode: false,
      entrySnapshot: null,
      entryIdentity: null,
      temporarySimulationActive: false,
      enterCount: 0,
      lastExitReason: "",
    };
    let keyboardTarget = null;
    let keyboardHandler = null;

    function assertIdentity() {
      if (!state.entryIdentity) return true;
      const current = clone(getIdentity());
      if (!identityEqual(state.entryIdentity, current)) {
        const error = new Error("Demo Director changed protected planning identity.");
        error.code = "DIRECTOR_IDENTITY_MUTATION";
        error.expected = clone(state.entryIdentity);
        error.actual = current;
        throw error;
      }
      return true;
    }

    function currentScene() {
      return sceneView(SCENES[state.sceneIndex], prerequisites, environment);
    }

    function snapshot() {
      return {
        ...clone(state),
        sceneCount: SCENES.length,
        scene: currentScene(),
        scenes: SCENES.map((scene, index) => ({ id: scene.id, number: scene.number, title: scene.title, active: index === state.sceneIndex, complete: index < state.sceneIndex, prerequisite: prerequisiteStatus(scene, prerequisites) })),
        reducedMotion: environment.reducedMotion,
        webglAvailable: environment.webglAvailable,
        mobile: environment.mobile,
      };
    }

    function applyScene(index, reason) {
      state.sceneIndex = Math.max(0, Math.min(SCENES.length - 1, Number(index) || 0));
      const scene = currentScene();
      if (state.temporarySimulationActive && scene.id !== "mission-replay") {
        onClearSimulation({ reason: "scene-change" });
        state.temporarySimulationActive = false;
      }
      if (scene.id === "mission-replay" && scene.prerequisite.status === "READY" && !state.temporarySimulationActive && options.temporaryDelayEvent) {
        onTemporarySimulation(clone(options.temporaryDelayEvent));
        state.temporarySimulationActive = true;
      }
      onScene(scene, { reason: text(reason || "navigation"), noBusinessMutation: true });
      assertIdentity();
      return snapshot();
    }

    function start(sceneIndex = 0) {
      if (state.active) return applyScene(sceneIndex, "restart");
      state.entrySnapshot = clone(captureState());
      state.entryIdentity = clone(getIdentity());
      state.active = true;
      state.status = "paused";
      state.presentationMode = Boolean(options.presentationMode);
      state.enterCount += 1;
      state.lastExitReason = "";
      return applyScene(sceneIndex, "start");
    }

    function next() {
      if (!state.active) throw new Error("Demo Director is not active.");
      if (state.sceneIndex >= SCENES.length - 1) {
        state.status = "paused";
        return snapshot();
      }
      return applyScene(state.sceneIndex + 1, "next");
    }

    function previous() {
      if (!state.active) throw new Error("Demo Director is not active.");
      return applyScene(Math.max(0, state.sceneIndex - 1), "previous");
    }

    function jump(target) {
      if (!state.active) throw new Error("Demo Director is not active.");
      const index = typeof target === "number" ? target : SCENES.findIndex((scene) => scene.id === text(target));
      if (index < 0 || index >= SCENES.length) throw new Error(`Unknown Director scene: ${target}`);
      return applyScene(index, "jump");
    }

    function play() {
      if (!state.active) start(state.sceneIndex);
      state.status = "playing";
      assertIdentity();
      return snapshot();
    }

    function pause() {
      if (state.active) state.status = "paused";
      assertIdentity();
      return snapshot();
    }

    function advance() {
      if (state.status !== "playing") return snapshot();
      if (state.sceneIndex >= SCENES.length - 1) {
        state.status = "paused";
        return snapshot();
      }
      return next();
    }

    function exit(reason = "user") {
      if (!state.active) return snapshot();
      assertIdentity();
      if (state.temporarySimulationActive) {
        onClearSimulation({ reason: "director-exit" });
        state.temporarySimulationActive = false;
      }
      restoreState(clone(state.entrySnapshot));
      assertIdentity();
      state.active = false;
      state.status = "idle";
      state.presentationMode = false;
      state.lastExitReason = text(reason);
      state.entrySnapshot = null;
      state.entryIdentity = null;
      return snapshot();
    }

    function handleKey(key) {
      if (!state.active) return false;
      if (key === "ArrowRight") next();
      else if (key === "ArrowLeft") previous();
      else if (key === "Escape") exit("escape");
      else if (key === " " || key === "Spacebar") state.status === "playing" ? pause() : play();
      else return false;
      return true;
    }

    function installKeyboard(target) {
      if (!target?.addEventListener || !target?.removeEventListener) throw new Error("Keyboard target must implement addEventListener/removeEventListener.");
      if (keyboardTarget === target && keyboardHandler) return () => uninstallKeyboard();
      uninstallKeyboard();
      keyboardTarget = target;
      keyboardHandler = (event) => {
        if (handleKey(event.key)) event.preventDefault?.();
      };
      keyboardTarget.addEventListener("keydown", keyboardHandler);
      return () => uninstallKeyboard();
    }

    function uninstallKeyboard() {
      if (keyboardTarget && keyboardHandler) keyboardTarget.removeEventListener("keydown", keyboardHandler);
      keyboardTarget = null;
      keyboardHandler = null;
    }

    function setEnvironment(next = {}) {
      environment = {
        ...environment,
        reducedMotion: next.reducedMotion ?? environment.reducedMotion,
        webglAvailable: next.webglAvailable ?? environment.webglAvailable,
        mobile: next.mobile ?? environment.mobile,
      };
      return snapshot();
    }

    function setPrerequisites(next = {}) {
      prerequisites = clone(next);
      return snapshot();
    }

    function destroy() {
      if (state.active) exit("destroy");
      uninstallKeyboard();
    }

    return {
      get state() { return state; },
      snapshot,
      start,
      next,
      previous,
      jump,
      play,
      pause,
      advance,
      exit,
      handleKey,
      installKeyboard,
      uninstallKeyboard,
      setEnvironment,
      setPrerequisites,
      assertIdentity,
      destroy,
    };
  }

  return {
    SCENES,
    prerequisiteStatus,
    sceneView,
    createDirectorController,
  };
});
