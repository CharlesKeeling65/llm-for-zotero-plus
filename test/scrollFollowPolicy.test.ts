import { assert } from "chai";
import { describe, it } from "mocha";

import { AUTO_SCROLL_BOTTOM_THRESHOLD } from "../src/modules/contextPanel/constants";
import {
  isAtAutoFollowBottom,
  resolveStreamingScrollFollowAction,
} from "../src/modules/contextPanel/scrollFollowPolicy";

describe("scrollFollowPolicy", function () {
  it("treats only the actual bottom as auto-follow eligible", function () {
    assert.equal(AUTO_SCROLL_BOTTOM_THRESHOLD, 1);
    assert.isTrue(isAtAutoFollowBottom(0));
    assert.isTrue(isAtAutoFollowBottom(1));
    assert.isFalse(isAtAutoFollowBottom(1.01));
    assert.isFalse(isAtAutoFollowBottom(64));
    assert.isFalse(isAtAutoFollowBottom(900));
  });

  it("cancels follow-bottom on upward streaming scroll", function () {
    assert.equal(
      resolveStreamingScrollFollowAction({
        scrollDelta: -3,
        distanceFromBottom: 0,
        isStreaming: true,
      }),
      "cancel",
    );
  });

  it("follows on downward streaming scroll only at the bottom", function () {
    assert.equal(
      resolveStreamingScrollFollowAction({
        scrollDelta: 3,
        distanceFromBottom: 0,
        isStreaming: true,
      }),
      "follow",
    );
    assert.equal(
      resolveStreamingScrollFollowAction({
        scrollDelta: 3,
        distanceFromBottom: 1,
        isStreaming: true,
      }),
      "follow",
    );
    assert.equal(
      resolveStreamingScrollFollowAction({
        scrollDelta: 3,
        distanceFromBottom: 1.01,
        isStreaming: true,
      }),
      "manual",
    );
    assert.equal(
      resolveStreamingScrollFollowAction({
        scrollDelta: 3,
        distanceFromBottom: 900,
        isStreaming: true,
      }),
      "manual",
    );
  });

  it("does not change follow state when the current conversation is not streaming", function () {
    assert.equal(
      resolveStreamingScrollFollowAction({
        scrollDelta: 3,
        distanceFromBottom: 0,
        isStreaming: false,
      }),
      "manual",
    );
  });
});
