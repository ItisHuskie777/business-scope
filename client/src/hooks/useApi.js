import { useEffect, useRef, useState } from "react";

/**
 * Small hook that runs `fetcher()` on mount (and whenever `deps` change) and
 * exposes `{data, loading, error, refetch}`. Cancels stale writes so a
 * late-arriving response can't overwrite a newer one.
 *
 * @template T
 * @param {() => Promise<T>} fetcher
 * @param {Array<any>} deps
 * @returns {{data:T|null, loading:boolean, error:Error|null, refetch:()=>void}}
 */
export default function useApi(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    setError(null);
    fetcher()
      .then((value) => {
        if (aliveRef.current) setData(value);
      })
      .catch((err) => {
        if (aliveRef.current) setError(err);
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
    return () => {
      aliveRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, refetch: () => setTick((t) => t + 1) };
}
