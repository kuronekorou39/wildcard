import { useEffect, useState } from 'react';
import type { TurnClock } from '../transport/tableRuntime.js';

function useRemaining(clock: TurnClock) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [clock.id, clock.deadline]);
  return clock.deadline === null ? clock.durationMs : Math.min(clock.durationMs, Math.max(0, clock.deadline - now));
}

export function TurnRing({ clock }: { readonly clock: TurnClock }) {
  const remaining = useRemaining(clock);
  return <svg className="turn-ring" data-urgent={remaining <= 5000} aria-hidden="true">
    <rect width="100%" height="100%" rx="12" pathLength="100"
      strokeDasharray="100" strokeDashoffset={100 * (1 - remaining / clock.durationMs)} />
  </svg>;
}

export function TurnSeconds({ clock }: { readonly clock: TurnClock }) {
  const remaining = useRemaining(clock);
  return <span className="turn-seconds" data-urgent={remaining <= 5000} role="timer"
    aria-label={`残り${Math.ceil(remaining / 1000)}秒`}>{Math.ceil(remaining / 1000)}秒</span>;
}
