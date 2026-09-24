import { useEffect, useState, useRef } from "react";
import { useLocation } from "react-router-dom";
import { subscribeLoading, startLoading, stopLoading, getLoadingDepth } from "@/lib/loading-bus";

/**
 * Light loading UX:
 * - Route change / quick API → thin gold top bar only
 * - Continuous busy ≥ 1.2s → full "Bharati Vidyapeeth" overlay
 * StrictMode-safe cleanup on route effect.
 */
export function GlobalLoading() {
  const location = useLocation();
  const [depth, setDepth] = useState(0);
  const [routePulse, setRoutePulse] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showBrand, setShowBrand] = useState(false);
  const timerRef = useRef(null);
  const brandDelayRef = useRef(null);

  useEffect(() => {
    return subscribeLoading((_busy, d) => setDepth(typeof d === "number" ? d : getLoadingDepth()));
  }, []);

  // Route: short top-bar pulse only
  useEffect(() => {
    let stopped = false;
    setRoutePulse(true);
    setProgress(18);
    startLoading("route");

    const t = setTimeout(() => {
      if (stopped) return;
      setProgress(100);
      stopLoading();
      setTimeout(() => {
        if (!stopped) {
          setRoutePulse(false);
          setProgress(0);
        }
      }, 160);
    }, 280);

    return () => {
      stopped = true;
      clearTimeout(t);
      stopLoading();
      setRoutePulse(false);
    };
  }, [location.pathname, location.search]);

  // Brand overlay only if still busy after 1.2s (slow APIs only)
  useEffect(() => {
    if (brandDelayRef.current) {
      clearTimeout(brandDelayRef.current);
      brandDelayRef.current = null;
    }
    if (depth > 0) {
      brandDelayRef.current = setTimeout(() => {
        if (getLoadingDepth() > 0) setShowBrand(true);
      }, 1200);
    } else {
      setShowBrand(false);
    }
    return () => {
      if (brandDelayRef.current) clearTimeout(brandDelayRef.current);
    };
  }, [depth]);

  const active = depth > 0 || routePulse;

  useEffect(() => {
    if (!active) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    setProgress((p) => (p < 10 ? 10 : p));
    timerRef.current = setInterval(() => {
      setProgress((p) => (p >= 88 ? p : p + Math.random() * 5 + 1.5));
    }, 320);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [active]);

  useEffect(() => {
    if (!active && progress > 0) {
      setProgress(100);
      const t = setTimeout(() => setProgress(0), 150);
      return () => clearTimeout(t);
    }
  }, [active]);

  if (progress <= 0 && !active && !showBrand) return null;

  return (
    <>
      <div
        className="bvu-top-loader"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-hidden={!active}
      >
        <div
          className="bvu-top-loader-bar"
          style={{
            width: `${Math.min(100, progress)}%`,
            opacity: progress > 0 ? 1 : 0,
          }}
        />
      </div>

      {showBrand && depth > 0 ? (
        <div className="bvu-loading-overlay" aria-live="polite" aria-busy="true">
          <div className="bvu-loading-card">
            <div className="bvu-spinner" aria-hidden="true" />
            <p className="bvu-brand-load">Bharati Vidyapeeth</p>
            <p className="bvu-brand-load-sub">Deemed to be University</p>
            <p className="bvu-loading-text">Loading</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
