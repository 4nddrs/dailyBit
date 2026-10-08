import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  OTHER_REASON_LABEL,
  TASK_SCORE_LEVELS,
  TASK_SCORE_LEVEL_LABELS,
  TASK_SCORE_LEVEL_COLORS,
  TASK_SCORE_REASONS,
  TASK_SCORE_REASON_LIMIT,
} from '../../utils/taskScore';
import type { TaskScoreLevel } from '../../types';

export interface KeyboardScoreBarProps {
  // "Harshad · 4/66": the selected task's position, or null when unknown.
  positionLabel: string | null;
  // The level chosen for the selected task, or null while still at the level step.
  level: TaskScoreLevel | null;
  // True once a level is chosen and its numbered reasons are shown.
  reasonStep: boolean;
  // True while the "Other (write your own)" input is active.
  otherOpen: boolean;
  customReason: string;
  onCustomReasonChange: (value: string) => void;
  onCustomSubmit: () => void;
  onCustomCancel: () => void;
  error: string | null;
}

// A keycap, so the numbers read as shortcuts rather than as text.
function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-line bg-canvas px-1 font-sans text-[11px] font-semibold leading-none text-fg-muted">
      {children}
    </kbd>
  );
}

// Fixed legend for the keyboard-only scoring flow. One line: position + the
// five levels + the shortcuts. Only once a level is picked does a second line
// appear underneath, with that level's numbered reasons and "Other". Every key
// is handled by the window listener in `LeadView`; only Enter/Escape inside the
// custom-reason input live here.
export function KeyboardScoreBar({
  positionLabel,
  level,
  reasonStep,
  otherOpen,
  customReason,
  onCustomReasonChange,
  onCustomSubmit,
  onCustomCancel,
  error,
}: KeyboardScoreBarProps) {
  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (otherOpen) {
      customInputRef.current?.focus();
    }
  }, [otherOpen]);

  const reasons = level ? TASK_SCORE_REASONS[level] : [];
  const levelLabel = level ? TASK_SCORE_LEVEL_LABELS[level] : '';
  const levelColor = level ? TASK_SCORE_LEVEL_COLORS[level] : undefined;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas-inset shadow-[0_-6px_16px_-12px_rgba(0,0,0,0.8)]"
      role="region"
      aria-label="Keyboard scoring"
    >
      <div className="mx-auto w-full max-w-screen-2xl px-4 py-2 md:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Score</span>
          {positionLabel ? (
            <span className="rounded-md border border-line bg-canvas px-2 py-0.5 text-xs font-medium tabular-nums text-fg">
              {positionLabel}
            </span>
          ) : null}
          <span className="hidden h-4 w-px bg-line sm:block" aria-hidden="true" />

          <span className="flex flex-wrap items-center gap-1.5">
            {TASK_SCORE_LEVELS.map((option, index) => {
              const active = level === option;
              return (
                <span
                  key={option}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium"
                  style={
                    active
                      ? {
                          borderColor: TASK_SCORE_LEVEL_COLORS[option],
                          backgroundColor: 'rgb(var(--color-canvas))',
                        }
                      : { borderColor: 'transparent' }
                  }
                >
                  <Kbd>{index + 1}</Kbd>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: TASK_SCORE_LEVEL_COLORS[option] }}
                    aria-hidden="true"
                  />
                  <span
                    className={active ? '' : 'text-fg-muted'}
                    style={active ? { color: TASK_SCORE_LEVEL_COLORS[option] } : undefined}
                  >
                    {TASK_SCORE_LEVEL_LABELS[option]}
                  </span>
                </span>
              );
            })}
          </span>

          <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-fg-muted lg:flex">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span>move</span>
            <span aria-hidden="true">·</span>
            <Kbd>Enter</Kbd>
            <span>next</span>
            <span aria-hidden="true">·</span>
            <Kbd>Esc</Kbd>
            <span>cancel</span>
          </span>
        </div>

        {reasonStep && level ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
            <span className="mr-1 text-xs text-fg-muted">
              Reason for{' '}
              <span className="font-medium" style={levelColor ? { color: levelColor } : undefined}>
                {levelLabel}
              </span>
            </span>
            {reasons.map((reason, index) => (
              <span
                key={reason}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2 py-1 text-xs text-fg"
              >
                <Kbd>{index + 1}</Kbd>
                {reason}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-line px-2 py-1 text-xs text-fg-muted">
              <Kbd>{reasons.length + 1}</Kbd>
              {OTHER_REASON_LABEL}
            </span>
          </div>
        ) : null}

        {otherOpen ? (
          <div className="mt-2">
            <input
              ref={customInputRef}
              className="w-full rounded-md border border-line bg-canvas px-3 py-1.5 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-accent-emphasis focus:ring-1 focus:ring-accent-emphasis"
              type="text"
              value={customReason}
              maxLength={TASK_SCORE_REASON_LIMIT}
              onChange={(event) => onCustomReasonChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onCustomSubmit();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  onCustomCancel();
                }
              }}
              placeholder="Write your reason and press Enter"
              aria-label="Custom score reason"
            />
          </div>
        ) : null}

        {error ? (
          <p className="mt-2 text-xs font-medium text-danger-fg" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
