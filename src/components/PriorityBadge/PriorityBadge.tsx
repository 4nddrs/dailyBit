import { PRIORITY_LEVEL_COLORS, PRIORITY_LEVEL_LABELS, isPriorityLevel } from '../../utils/priority';

// Compact "! High" pill for a lead question or assignment. Shared by Lead View
// and the read-only views (Developer View, Report Preview). Renders nothing
// when there is no priority or the stored value isn't a level this build knows.
export function PriorityBadge({ priority }: { priority?: unknown }) {
  if (!isPriorityLevel(priority)) {
    return null;
  }

  const color = PRIORITY_LEVEL_COLORS[priority];
  const label = PRIORITY_LEVEL_LABELS[priority];

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
      title={`Priority: ${label}`}
    >
      <span aria-hidden="true">!</span>
      {label}
      <span className="sr-only"> priority</span>
    </span>
  );
}
