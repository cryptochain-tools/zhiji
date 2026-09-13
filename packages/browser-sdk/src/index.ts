export { ZhijiClient } from "./sdk.js";
export { sanitizePageKey } from "./privacy.js";
export type {
  BehaviorAction, BehaviorCaptureOptions, BehaviorCapturePolicy, BehaviorEvent, ErrorCaptureOptions, ReplayCaptureOptions,
  FlushResult, FlushResults, Lane, PrivacyPolicy, TrackOptions, WebVitalName,
  WebVitalRating, ZhijiOptions,
} from "./types.js";

import { ZhijiClient } from "./sdk.js";
import type { ZhijiOptions } from "./types.js";

export function init(options: ZhijiOptions): ZhijiClient { return new ZhijiClient(options); }
