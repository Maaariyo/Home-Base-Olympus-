"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cx, IconButton } from "./ui";

/**
 * Phone: bottom sheet. Desktop: `panel` docks on the right, `modal` centres.
 * Keyboard: focus moves into the sheet when it opens, Tab stays inside a modal, Escape closes,
 * and focus returns to where it was.
 */
export function Sheet({
  open,
  onClose,
  title,
  variant = "modal",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  variant?: "modal" | "panel";
  children: ReactNode;
  footer?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const modal = variant === "modal";
  // Callers pass a new onClose on every render; read it from a ref so the effect runs only on open/close.
  const close = useRef(onClose);
  close.current = onClose;
  // Remember what had focus as the sheet opens: by the time effects run, an autoFocus field has taken it.
  const wasOpen = useRef(false);
  const before = useRef<HTMLElement | null>(null);
  if (open && !wasOpen.current && typeof document !== "undefined") before.current = document.activeElement as HTMLElement | null;
  wasOpen.current = open;
  useEffect(() => {
    if (!open) return;
    // Leave autoFocus fields alone; otherwise focus the sheet itself so screen readers announce it.
    if (!box.current?.contains(document.activeElement)) box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close.current();
      if (e.key !== "Tab" || !modal || !box.current) return;
      const items = box.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])");
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (before.current?.isConnected) before.current.focus();
    };
  }, [open, modal]);

  if (!open) return null;
  const panel = variant === "panel";

  return (
    <div className={cx("fixed inset-0 z-[1000]", panel && "pointer-events-none")}>
      {!panel && <div className="animate-fade absolute inset-0 bg-black/40" onClick={onClose} />}
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal={!panel}
        aria-label={typeof title === "string" ? title : undefined}
        className={cx(
          "animate-sheet pointer-events-auto absolute flex flex-col bg-card shadow-2xl outline-none",
          "inset-x-0 bottom-0 rounded-t-3xl",
          panel ? "max-h-[55dvh]" : "max-h-[92dvh]",
          panel
            ? "md:inset-y-3 md:right-3 md:bottom-3 md:left-auto md:max-h-none md:w-[35%] md:min-w-[360px] md:max-w-[460px] md:rounded-2xl"
            : "md:inset-auto md:top-1/2 md:left-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl",
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line md:hidden" />
        {title !== undefined && (
          <div className="flex shrink-0 items-center justify-between px-5 pt-3 pb-2">
            <div className="text-lg font-bold">{title}</div>
            <IconButton label="Close" onClick={onClose}>
              <X size={20} />
            </IconButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <div className="shrink-0 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}
