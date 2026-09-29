import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export interface SelectMenuOption {
  value: string;
  label: string;
  // Optional accent color: draws a dot beside the label and tints the trigger text.
  color?: string;
  // Draws a divider above this option (e.g. a trailing "Other" entry).
  separated?: boolean;
}

const triggerClass =
  'flex w-full items-center gap-2 rounded-md border border-line bg-canvas-inset px-3 py-1.5 text-left text-sm text-fg outline-none transition focus:border-accent-emphasis focus:ring-1 focus:ring-accent-muted disabled:cursor-not-allowed disabled:opacity-50';

// Site-styled single-select dropdown (the native option popup can't be styled).
// The button keeps focus while the list is open; the active option is exposed
// through aria-activedescendant. Escape closes only the list.
export const SelectMenu = forwardRef<
  HTMLButtonElement,
  {
    options: SelectMenuOption[];
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    ariaLabel?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    className?: string;
  }
>(function SelectMenu({ options, value, onChange, placeholder, ariaLabel, disabled, autoFocus, className = '' }, ref) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  function setTriggerRef(node: HTMLButtonElement | null) {
    triggerRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  }

  useEffect(() => {
    if (autoFocus) {
      triggerRef.current?.focus();
    }
  }, [autoFocus]);

  // Close the list on a click anywhere outside this menu.
  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  // Keep the active option visible while moving with the keyboard.
  useEffect(() => {
    if (open && activeIndex >= 0) {
      listRef.current?.children[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [open, activeIndex]);

  function openList() {
    if (disabled) {
      return;
    }
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function select(index: number) {
    const option = options[index];
    setOpen(false);
    if (option) {
      onChange(option.value);
    }
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case 'Escape':
        // Only the list closes: keep the event away from the popover's own Escape handler.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        break;
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, options.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        select(activeIndex >= 0 ? activeIndex : 0);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        ref={setTriggerRef}
        type="button"
        className={triggerClass}
        style={selected?.color ? { color: selected.color } : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${baseId}-opt-${activeIndex}` : undefined}
        aria-label={ariaLabel ? `${ariaLabel}: ${selected?.label ?? placeholder}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
      >
        {selected?.color ? (
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: selected.color }} aria-hidden="true" />
        ) : null}
        <span className={`min-w-0 flex-1 truncate ${selected ? (selected.color ? 'font-medium' : '') : 'text-fg-muted'}`}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="score-popover absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-md border border-line bg-canvas py-1 shadow-lg"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <li
                key={option.value}
                id={`${baseId}-opt-${index}`}
                role="option"
                aria-selected={isSelected}
                className={`flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm ${
                  option.separated ? 'mt-1 border-t border-line pt-2' : ''
                } ${isActive ? 'bg-accent-muted' : 'hover:bg-canvas-subtle'} ${isSelected ? 'font-medium' : ''} text-fg`}
                onMouseEnter={() => setActiveIndex(index)}
                // Keep focus on the trigger so the click doesn't blur it before selecting.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(index)}
              >
                {option.color ? (
                  <span
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: option.color }}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="min-w-0 flex-1" style={option.color ? { color: option.color } : undefined}>
                  {option.label}
                </span>
                <svg
                  className={`mt-0.5 h-4 w-4 shrink-0 text-accent-fg ${isSelected ? '' : 'invisible'}`}
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m4.5 10.5 3.5 3.5 7.5-8" />
                </svg>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
});
