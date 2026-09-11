import { useEffect, useState } from 'react';

/**
 * A ticking clock. The kiosk shows live time, and an open shift's elapsed
 * counter has to move or the screen looks frozen.
 *
 * Aligned to the wall clock rather than to mount time: a 1000 ms interval
 * started at :30.7 would tick at .7 past every second and the displayed minute
 * would change up to a second late.
 */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timeoutId;
    let intervalId;

    const start = () => {
      setNow(new Date());
      intervalId = setInterval(() => setNow(new Date()), intervalMs);
    };

    timeoutId = setTimeout(start, intervalMs - (Date.now() % intervalMs));

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [intervalMs]);

  return now;
}
