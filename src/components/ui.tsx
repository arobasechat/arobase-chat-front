import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { useT } from "@/lib/i18n";

type Variant = "primary" | "ghost" | "outline" | "danger";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: "sm" | "md" }
>(({ variant = "primary", loading, size = "md", className, children, disabled, ...rest }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={clsx(
      "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
      variant === "primary" && "bg-primary text-primary-fg hover:opacity-90",
      variant === "ghost" && "text-fg hover:bg-elevated",
      variant === "outline" && "border border-line bg-surface/40 text-fg hover:bg-elevated",
      variant === "danger" && "bg-danger text-white hover:brightness-110",
      className,
    )}
    {...rest}
  >
    {loading && <Loader2 className="size-4 animate-spin" />}
    {children}
  </button>
));
Button.displayName = "Button";

export const Spinner = ({ className }: { className?: string }) => {
  const t = useT();
  return <Loader2 className={clsx("size-5 animate-spin text-muted", className)} aria-label={t("Chargement")} />;
};

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="text-lg font-semibold">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="m-4 rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm">
      <p className="font-semibold text-danger">{t("Erreur")}</p>
      <p className="mt-1 break-words text-fg/80">{error instanceof Error ? error.message : String(error)}</p>
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
          {t("Réessayer")}
        </Button>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(560px,calc(100vw-24px))] rounded-xl border border-line bg-surface p-0 text-fg shadow-2xl"
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} className="rounded-full p-1.5 hover:bg-elevated" aria-label={t("Fermer")}>
              <X className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-bg px-3 py-2 text-[15px] outline-none transition placeholder:text-subtle focus:border-accent focus:ring-2 focus:ring-accent/20";

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="flex border-b border-line" role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            "relative flex-1 py-3.5 text-sm font-medium transition hover:bg-elevated/60",
            value === it.value ? "text-fg" : "text-muted",
          )}
        >
          {it.label}
          {value === it.value && <span className="absolute inset-x-1/4 bottom-0 h-0.5 rounded-full bg-fg" />}
        </button>
      ))}
    </div>
  );
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-md border border-tag-line bg-tag px-1.5 py-0.5 text-sm text-tag-fg", className)}>
      {children}
    </span>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "ok" | "warn" | "danger" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        tone === "muted" && "bg-elevated text-muted",
        tone === "accent" && "border border-tag-line bg-tag text-tag-fg",
        tone === "ok" && "bg-ok/15 text-ok",
        tone === "warn" && "bg-warn/15 text-warn",
        tone === "danger" && "bg-danger/15 text-danger",
      )}
    >
      {children}
    </span>
  );
}

export function PostSkeleton() {
  return (
    <div className="flex gap-3 border-b border-line px-4 py-4">
      <div className="skeleton size-10 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2.5 pt-1">
        <div className="skeleton h-3.5 w-1/3 rounded" />
        <div className="skeleton h-3.5 w-full rounded" />
        <div className="skeleton h-3.5 w-2/3 rounded" />
      </div>
    </div>
  );
}
