export {
  adMediaUrls,
  classifyPlaylistBody,
  classifyRequest,
  mayDescribeAds,
  pickBest,
  type Candidate,
  type PlaylistRole,
  type RequestInfo,
  type StreamKind,
} from "./candidates.ts";
export {
  buildLaunchOptions,
  launchWithSandboxFallback,
  PlaywrightStreamDetector,
  StreamDetectionError,
  type BrowserLike,
  type ContextLike,
  type DetectedStream,
  type DetectOptions,
  type LaunchOptions,
  type PageLike,
  type PlaywrightStreamDetectorOptions,
  type RequestLike,
  type ResponseLike,
} from "./detector.ts";
export { Semaphore } from "./semaphore.ts";
export {
  CONNECT_TIMEOUT_MS,
  DNS_CACHE_TTL_MS,
  GuardedProxy,
  type GuardedProxyOptions,
} from "./proxy.ts";
