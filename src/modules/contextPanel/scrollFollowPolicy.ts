import { AUTO_SCROLL_BOTTOM_THRESHOLD } from "./constants";

export type StreamingScrollFollowAction = "cancel" | "follow" | "manual";

export function isAtAutoFollowBottom(distanceFromBottom: number): boolean {
  return distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
}

export function resolveStreamingScrollFollowAction(params: {
  scrollDelta: number;
  distanceFromBottom: number;
  isStreaming: boolean;
}): StreamingScrollFollowAction {
  if (params.scrollDelta < -2) return "cancel";
  if (!params.isStreaming) return "manual";
  if (
    params.scrollDelta > 2 &&
    isAtAutoFollowBottom(params.distanceFromBottom)
  ) {
    return "follow";
  }
  return "manual";
}
