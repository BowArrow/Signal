/**
 * Time is injectable everywhere it matters. Cooldowns, rate limits, thread age
 * and the attribution window are all clock-dependent, and every one of them
 * needs to be testable without sleeping.
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** A clock you can move by hand. Tests only. */
export function fixedClock(startMs: number): Clock & { advance(ms: number): void; set(ms: number): void } {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
    set: (ms: number) => {
      current = ms;
    },
  };
}

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
