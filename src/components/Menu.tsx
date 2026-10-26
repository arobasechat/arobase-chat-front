import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";

export type MenuItem = { label: ReactNode; onSelect: () => void; danger?: boolean; icon?: ReactNode; disabled?: boolean };

export function Menu({ trigger, items, align = "right" }: { trigger: ReactNode; items: (MenuItem | null | false | undefined)[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const visible = items.filter(Boolean) as MenuItem[];
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          role="menu"
          className={clsx(
            "absolute top-full z-30 mt-1 min-w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {visible.map((it, i) => (
            <button
              key={i}
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={clsx(
                "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm hover:bg-elevated disabled:opacity-40",
                it.danger && "text-danger",
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
