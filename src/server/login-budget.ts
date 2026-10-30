const minute = 60 * 1000;
const loginLimits = {
  perUser: { count: 30, windowMs: 15 * minute },
  perInvite: { count: 5, windowMs: 15 * minute },
  loggedOutPerDevice: { count: 10, windowMs: 15 * minute },
  // Discogs allows the home IP about 25 unauthenticated requests a minute; this leaves room for everyone else's calls.
  loggedOutTotal: { count: 10, windowMs: minute },
};

export type LoginSpender = { kind: "user"; userId: string } | { kind: "invite"; inviteId: string } | { kind: "logged-out"; device: string };

export type LoginBudgetProblem = "too-many" | "busy";

export function createLoginBudget(now: () => Date) {
  const perUser = fixedWindowLimit(loginLimits.perUser, now);
  const perInvite = fixedWindowLimit(loginLimits.perInvite, now);
  const loggedOutPerDevice = fixedWindowLimit(loginLimits.loggedOutPerDevice, now);
  const loggedOutTotal = fixedWindowLimit(loginLimits.loggedOutTotal, now);

  return {
    take(spender: LoginSpender): LoginBudgetProblem | undefined {
      switch (spender.kind) {
        case "user":
          return perUser.allow(spender.userId) ? undefined : "too-many";
        case "invite":
          return perInvite.allow(spender.inviteId) ? undefined : "too-many";
        case "logged-out":
          if (!loggedOutPerDevice.allow(spender.device)) return "too-many";
          return loggedOutTotal.allow("all") ? undefined : "busy";
      }
    },
    trackedKeys() {
      return perUser.size() + perInvite.size() + loggedOutPerDevice.size() + loggedOutTotal.size();
    },
  };
}

function fixedWindowLimit({ count: limit, windowMs }: { count: number; windowMs: number }, now: () => Date) {
  const windows = new Map<string, { windowStart: number; count: number }>();
  return {
    allow(key: string) {
      const at = now().getTime();
      for (const [stale, window] of windows) {
        if (at - window.windowStart >= windowMs) windows.delete(stale);
      }
      const window = windows.get(key) ?? { windowStart: at, count: 0 };
      window.count += 1;
      windows.set(key, window);
      return window.count <= limit;
    },
    size: () => windows.size,
  };
}
