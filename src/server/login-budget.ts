const minute = 60 * 1000;
const loginLimits = {
  perUser: { count: 30, windowMs: 15 * minute },
  perInvite: { count: 5, windowMs: 15 * minute },
  loggedOutPerDevice: { count: 10, windowMs: 15 * minute },
  // Discogs allows the home IP about 25 unauthenticated calls a minute. Counted over any 60 seconds, not per clock minute,
  // logged-out logins use at most 10 of them, which leaves the rest for Invites, logged-in Users and Lookups.
  loggedOutTotal: { count: 10, windowMs: minute },
};

type Limit = { count: number; windowMs: number };

export type LoginSpender = { kind: "user"; userId: string } | { kind: "invite"; inviteId: string } | { kind: "logged-out"; device: string };

export type LoginBudgetProblem = "too-many" | "busy";

type Charge = { hasRoom(): boolean; spend(): void; problem: LoginBudgetProblem };

/** A login is charged only when every limit it counts against has room, so a refused login spends nothing and only granted logins are remembered. */
export function createLoginBudget(now: () => Date) {
  const clock = () => now().getTime();
  const perUser = fixedWindows(loginLimits.perUser, clock);
  const perInvite = fixedWindows(loginLimits.perInvite, clock);
  const loggedOutPerDevice = fixedWindows(loginLimits.loggedOutPerDevice, clock);
  const loggedOutTotal = slidingWindow(loginLimits.loggedOutTotal, clock);

  function chargesFor(spender: LoginSpender): Charge[] {
    switch (spender.kind) {
      case "user":
        return [{ ...perUser.of(spender.userId), problem: "too-many" }];
      case "invite":
        return [{ ...perInvite.of(spender.inviteId), problem: "too-many" }];
      case "logged-out":
        return [
          { ...loggedOutPerDevice.of(spender.device), problem: "too-many" },
          { ...loggedOutTotal, problem: "busy" },
        ];
    }
  }

  return {
    /** Checks and spends in one synchronous step, so concurrent requests cannot all pass the check before any of them spends. */
    take(spender: LoginSpender) {
      const charges = chargesFor(spender);
      const problem = charges.find((charge) => !charge.hasRoom())?.problem;
      if (!problem) for (const charge of charges) charge.spend();
      return problem;
    },
    refund(spender: Extract<LoginSpender, { kind: "invite" }>) {
      perInvite.of(spender.inviteId).refund();
    },
    size: () => perUser.size() + perInvite.size() + loggedOutPerDevice.size() + loggedOutTotal.size(),
  };
}

function fixedWindows({ count, windowMs }: Limit, clock: () => number) {
  // A window is added when it starts and dropped when it ends, so the Map stays in start order and the sweep stops at the first live one.
  const windows = new Map<string, { start: number; spent: number }>();
  function current(key: string) {
    const at = clock();
    for (const [stale, window] of windows) {
      if (at - window.start < windowMs) break;
      windows.delete(stale);
    }
    return windows.get(key);
  }
  return {
    of: (key: string) => ({
      hasRoom: () => (current(key)?.spent ?? 0) < count,
      spend() {
        const window = current(key);
        if (window) window.spent += 1;
        else windows.set(key, { start: clock(), spent: 1 });
      },
      refund() {
        const window = current(key);
        if (window && window.spent > 0) window.spent -= 1;
      },
    }),
    size: () => windows.size,
  };
}

function slidingWindow({ count, windowMs }: Limit, clock: () => number) {
  const spentAt: number[] = [];
  function dropExpired() {
    const at = clock();
    while (spentAt.length > 0 && at - spentAt[0]! >= windowMs) spentAt.shift();
  }
  return {
    hasRoom() {
      dropExpired();
      return spentAt.length < count;
    },
    spend() {
      dropExpired();
      spentAt.push(clock());
    },
    size: () => spentAt.length,
  };
}
