import { useEffect, useState } from 'react';

/** Tick only while a pending presentation or countdown needs time updates. */
export function usePresentationTime(until: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (Date.now() >= until) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [until]);
  return Math.max(now, Date.now());
}
