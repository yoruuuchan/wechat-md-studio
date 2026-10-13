export const Session = {
  cookieName: "mopai_sid",
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Per-image upload cap, shared by the browser (which refuses an over-limit
 * original before sending it) and both server doors — tRPC storage.upload and
 * the Agent API. mopai-worker carries its own copy of the same cap; changes
 * must keep all of them in sync.
 */
export const MaxImageBytes = 20 * 1024 * 1024;

export const ErrorMessages = {
  unauthenticated: "需要登录后才能使用云端草稿箱",
  insufficientRole: "权限不足",
} as const;
