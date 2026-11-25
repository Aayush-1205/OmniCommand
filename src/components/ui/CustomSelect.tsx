import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface CustomSelectOption<T extends string = string> {
  value: T;
  label: string;
  subtitle?: string;
  dotColor?: string;
  icon?: ReactNode;
  dividerBefore?: boolean;
}

interface CustomSelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: CustomSelectOption<T>[];
  ariaLabel?: string;
  placeholder?: string;
  size?: "sm" | "md" | "ghost";
  placement?: "bottom" | "top";
  align?: "left" | "right";
  className?: string;
  menuClassName?: string;
  disabled?: boolean;
}

export function CustomSelect<T extends string = string>({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder = "Select...",
  size = "md",
  placement = "bottom",
  align = "left",
  className = "",
  menuClassName = "",
  disabled = false,
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedIndex = options.findIndex((opt) => opt.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const minWidth = Math.max(rect.width, size === "ghost" ? 196 : 168);
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const estimatedHeight = Math.min(options.length * 46 + 12, 280);

    const spaceBelow = viewportH - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openUpward =
      placement === "top"
        ? spaceAbove >= Math.min(estimatedHeight, 140) || spaceAbove > spaceBelow
        : spaceBelow < Math.min(estimatedHeight, 160) && spaceAbove > spaceBelow;

    let left = align === "right" ? rect.right - minWidth : rect.left;
    if (left + minWidth > viewportW - 8) {
      left = Math.max(8, viewportW - minWidth - 8);
    }
    if (left < 8) {
      left = 8;
    }

    if (openUpward) {
      setMenuStyle({
        position: "fixed",
        left,
        bottom: viewportH - rect.top + 4,
        minWidth,
        maxWidth: Math.min(340, viewportW - 16),
      });
    } else {
      setMenuStyle({
        position: "fixed",
        left,
        top: rect.bottom + 4,
        minWidth,
        maxWidth: Math.min(340, viewportW - 16),
      });
    }
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleWindowChange = () => {
      updateMenuPosition();
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options.length, placement, align]);

  useEffect(() => {
    if (!open) return;
    const el = optionRefs.current[highlightedIndex];
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [open, highlightedIndex]);

  const selectIndex = (idx: number) => {
    const opt = options[idx];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }

    if (e.key === "Tab") {
      setOpen(false);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % Math.max(options.length, 1));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => (i - 1 + options.length) % Math.max(options.length, 1));
      return;
    }

    if (e.key === "Home") {
      e.preventDefault();
      setHighlightedIndex(0);
      return;
    }

    if (e.key === "End") {
      e.preventDefault();
      setHighlightedIndex(Math.max(options.length - 1, 0));
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectIndex(highlightedIndex);
    }
  };

  const triggerSizing =
    size === "ghost"
      ? "h-7 px-2 rounded-md text-[11.5px] bg-transparent border border-transparent text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-black/[0.04] dark:hover:bg-white/[0.05] focus:outline-none focus-visible:border-[#2563EB]"
      : size === "sm"
        ? "h-8 px-2.5 rounded-md text-[12.5px] bg-[#F6F7F9] dark:bg-[#181A1E] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] hover:border-[#D1D5DB] dark:hover:border-[#374151] focus:outline-none focus:border-[#2563EB]"
        : "h-9 px-3 rounded-md text-[13px] bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] hover:border-[#D1D5DB] dark:hover:border-[#374151] focus:outline-none focus:border-[#2563EB]";

  const menu =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            style={menuStyle}
            className={`z-[90] rounded-lg border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] shadow-xl py-1 max-h-[280px] overflow-y-auto ${menuClassName}`}
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightedIndex;
              return (
                <div key={opt.value}>
                  {opt.dividerBefore && (
                    <div className="my-1 border-t border-[#E5E7EB] dark:border-[#262930]" />
                  )}
                  <button
                    ref={(el) => {
                      optionRefs.current[idx] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectIndex(idx);
                    }}
                    className={`w-full px-2.5 py-1.5 text-left flex items-start justify-between gap-2.5 transition-colors cursor-pointer ${
                      isHighlighted
                        ? "bg-[#F3F4F6] dark:bg-[#232730]"
                        : "bg-transparent"
                    }`}
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      {opt.dotColor && (
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 mt-[5px] ${opt.dotColor}`}
                          aria-hidden="true"
                        />
                      )}
                      {opt.icon && (
                        <span className="shrink-0 mt-0.5 text-[#6B7280] dark:text-[#9CA3AF]">
                          {opt.icon}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div
                          className={`text-[12.5px] leading-snug truncate ${
                            isSelected
                              ? "font-medium text-[#111827] dark:text-[#F3F4F6]"
                              : "text-[#111827] dark:text-[#E5E7EB]"
                          }`}
                        >
                          {opt.label}
                        </div>
                        {opt.subtitle && (
                          <div className="text-[11px] leading-snug text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
                            {opt.subtitle}
                          </div>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-[#2563EB] dark:text-[#60A5FA] shrink-0 mt-0.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className={`inline-flex items-center justify-between gap-2 transition-colors disabled:opacity-45 disabled:pointer-events-none cursor-pointer ${triggerSizing} ${
          open && size !== "ghost" ? "border-[#2563EB] dark:border-[#2563EB]" : ""
        } ${className}`}
      >
        <span className="flex items-center gap-1.5 min-w-0 truncate">
          {selectedOption?.dotColor && (
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedOption.dotColor}`}
              aria-hidden="true"
            />
          )}
          {selectedOption?.icon && <span className="shrink-0">{selectedOption.icon}</span>}
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 text-[#6B7280] dark:text-[#9CA3AF] transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {menu}
    </>
  );
}
