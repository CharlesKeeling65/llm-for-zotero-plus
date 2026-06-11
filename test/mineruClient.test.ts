import { assert } from "chai";
import { getMineruCloudPollDecisionForTests } from "../src/utils/mineruClient";

const MINUTE_MS = 60 * 1000;

describe("mineruClient cloud poll policy", function () {
  it("times out pending jobs after the pre-processing window", function () {
    const decision = getMineruCloudPollDecisionForTests({
      state: "pending",
      nowMs: 30 * MINUTE_MS,
      pollStartMs: 0,
      lastStatusAtMs: 30 * MINUTE_MS,
      activeStartedAtMs: null,
    });

    assert.equal(decision.action, "timeout");
    if (decision.action === "timeout") {
      assert.equal(decision.reason, "pre_processing");
      assert.equal(decision.phase, "pre_processing");
    }
  });

  it("does not time out active running or converting jobs", function () {
    for (const state of ["running", "converting"]) {
      const decision = getMineruCloudPollDecisionForTests({
        state,
        nowMs: 3 * 60 * MINUTE_MS,
        pollStartMs: 0,
        lastStatusAtMs: 3 * 60 * MINUTE_MS,
        activeStartedAtMs: 5 * MINUTE_MS,
      });

      assert.equal(decision.action, "continue");
      if (decision.action === "continue") {
        assert.equal(decision.phase, "active_processing");
        assert.equal(decision.pollIntervalMs, 60 * 1000);
      }
    }
  });

  it("times out when polling stops returning usable status", function () {
    const noStatusFromStart = getMineruCloudPollDecisionForTests({
      state: null,
      nowMs: 10 * MINUTE_MS,
      pollStartMs: 0,
      lastStatusAtMs: null,
      activeStartedAtMs: null,
    });

    assert.equal(noStatusFromStart.action, "timeout");
    if (noStatusFromStart.action === "timeout") {
      assert.equal(noStatusFromStart.reason, "no_status");
    }

    const malformedAfterStatus = getMineruCloudPollDecisionForTests({
      state: "",
      nowMs: 20 * MINUTE_MS,
      pollStartMs: 0,
      lastStatusAtMs: 10 * MINUTE_MS,
      activeStartedAtMs: null,
    });

    assert.equal(malformedAfterStatus.action, "timeout");
    if (malformedAfterStatus.action === "timeout") {
      assert.equal(malformedAfterStatus.reason, "no_status");
    }
  });

  it("keeps done and failed states terminal", function () {
    for (const state of ["done", "failed"] as const) {
      const decision = getMineruCloudPollDecisionForTests({
        state,
        nowMs: 90 * MINUTE_MS,
        pollStartMs: 0,
        lastStatusAtMs: 90 * MINUTE_MS,
        activeStartedAtMs: null,
      });

      assert.equal(decision.action, "terminal");
      if (decision.action === "terminal") {
        assert.equal(decision.terminalState, state);
      }
    }
  });
});
