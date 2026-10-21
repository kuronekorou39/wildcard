import { useEffect, useRef, useState } from 'react';

/** A newly displayed action needs a fresh tap; one decision can only be sent once. */
export function useActionLatch(key: string, delay = 550) {
  const latch = useRef({ key, after: Date.now() + delay, sent: false });
  const [armed, setArmed] = useState<string | null>(null);
  if (latch.current.key !== key) latch.current = { key, after: Date.now() + delay, sent: false };
  useEffect(() => {
    setArmed(null);
    const timer = setTimeout(() => setArmed(key), Math.max(0, latch.current.after - Date.now()));
    return () => clearTimeout(timer);
  }, [key]);
  return {
    enabled: armed === key && !latch.current.sent,
    run: (action: () => void) => {
      if (latch.current.key !== key || latch.current.sent || Date.now() < latch.current.after) return;
      latch.current.sent = true;
      setArmed(null);
      action();
    },
  };
}
