const LOGIN_IP_WINDOW_MS = 60 * 1000;
const LOGIN_IP_LIMIT = 3;

type LoginIpCounter = {
  windowStart: number;
  count: number;
};

const loginIpCounters = new Map<string, LoginIpCounter>();
let cleanupCounter = 0;

export const LOGIN_LOCK_FAILED_ATTEMPTS = 3;

export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  return (
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

export function consumeLoginIpAttempt(ip: string, now = Date.now()) {
  cleanupCounter += 1;
  if (cleanupCounter % 100 === 0) {
    for (const [key, value] of loginIpCounters.entries()) {
      if (now - value.windowStart >= LOGIN_IP_WINDOW_MS) {
        loginIpCounters.delete(key);
      }
    }
  }

  const current = loginIpCounters.get(ip);
  if (!current || now - current.windowStart >= LOGIN_IP_WINDOW_MS) {
    loginIpCounters.set(ip, { windowStart: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= LOGIN_IP_LIMIT) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((LOGIN_IP_WINDOW_MS - (now - current.windowStart)) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
