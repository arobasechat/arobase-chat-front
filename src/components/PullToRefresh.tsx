import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n";

const TRIGGER = 70;
const MAX = 110;

function scrolledAncestor(el: EventTarget | null) {
  for (let n = el instanceof Element ? el : null; n && n !== document.body; n = n.parentElement) {
    if (n.scrollTop > 0) return true;
    if (n instanceof HTMLElement && n.dataset.noPull !== undefined) return true;
  }
  return false;
}

export function PullToRefresh() {
  const t = useT();
  const qc = useQueryClient();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!matchMedia("(pointer: coarse)").matches) return;
    let startY: number | null = null;
    let startX = 0;
    let current = 0;
    const reset = () => {
      startY = null;
      current = 0;
    };
    const onStart = (e: TouchEvent) => {
      if (busyRef.current || window.scrollY > 0 || e.touches.length > 1 || scrolledAncestor(e.target) || document.querySelector("dialog[open]")) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      const dx = Math.abs(e.touches[0].clientX - startX);
      if (dy <= 0 || window.scrollY > 0 || dx > dy) {
        if (current) setPull(0);
        reset();
        return;
      }
      current = Math.min(MAX, dy * 0.5);
      setPull(current);
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = async () => {
      if (startY === null) return;
      const reached = current >= TRIGGER;
      reset();
      if (!reached) return setPull(0);
      busyRef.current = true;
      setBusy(true);
      setPull(TRIGGER);
      navigator.vibrate?.(8);
      try {
        await Promise.race([qc.refetchQueries({ type: "active" }), new Promise((r) => setTimeout(r, 12_000))]);
      } finally {
        busyRef.current = false;
        setBusy(false);
        setPull(0);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    document.documentElement.style.overscrollBehaviorY = "contain";
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
      document.documentElement.style.overscrollBehaviorY = "";
    };
  }, [qc]);

  if (!pull && !busy) return null;
  const progress = Math.min(1, pull / TRIGGER);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center sm:hidden"
      style={{ transform: `translateY(${pull - 44}px)`, transition: startTransition(busy, pull) }}
      aria-live="polite"
    >
      <div className="mt-2 flex size-10 items-center justify-center rounded-full border border-line bg-surface shadow-lg">
        <RefreshCw
          className={clsx("size-5", progress >= 1 ? "text-accent" : "text-muted", busy && "animate-spin")}
          style={busy ? undefined : { transform: `rotate(${progress * 270}deg)`, opacity: 0.4 + progress * 0.6 }}
        />
      </div>
      {busy && <span className="sr-only">{t("Actualisation…")}</span>}
    </div>
  );
}

const startTransition = (busy: boolean, pull: number) => (busy || pull === 0 ? "transform 200ms ease-out" : "none");
