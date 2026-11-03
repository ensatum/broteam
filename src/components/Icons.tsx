import { useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Children } from 'react';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Thinner stroke for small cell markers — reads sharper at ~12–14px */
const strokeCrisp = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Feather: settings */
export function GearIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** Feather: filter */
export function FilterIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

/** Feather: plus-circle */
export function PlusCircleIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

/** Feather: list */
export function ListIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

export function MenuIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function GearButton({
  title,
  onClick,
  className = '',
  variant = 'default',
  color,
}: {
  title: string;
  onClick: (e: MouseEvent) => void;
  className?: string;
  /** ghost = column headers (gray→black); onTone = developer row (tone→black) */
  variant?: 'default' | 'ghost' | 'onTone';
  /** Icon color for onTone (e.g. darkened row background) */
  color?: string;
}) {
  const base =
    variant === 'onTone'
      ? 'cursor-pointer inline-flex h-4 w-4 items-center justify-center rounded bg-transparent text-[color:var(--gear-color,#94a3b8)] hover:text-black shrink-0'
      : variant === 'ghost'
        ? 'cursor-pointer inline-flex h-4 w-4 items-center justify-center rounded bg-transparent text-slate-400 hover:text-black shrink-0'
        : 'cursor-pointer inline-flex h-5 w-5 items-center justify-center rounded bg-transparent text-slate-500 hover:text-black shrink-0';
  return (
    <button
      type="button"
      title={title}
      className={`${base} ${className}`}
      style={color ? ({ ['--gear-color']: color } as CSSProperties) : undefined}
      onClick={onClick}
    >
      <GearIcon className="h-3.5 w-3.5" />
    </button>
  );
}

/** Feather: edit — note editor action */
export function NoteIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

/** Feather: slash */
export function SlashIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

/** Feather: compass */
export function CompassIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}

/** Feather: zap */
export function ZapIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

/** Feather: paperclip */
export function PaperclipIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

/** Feather: star */
export function StarIcon({
  className = 'h-3.5 w-3.5',
  filled = false,
}: {
  className?: string;
  filled?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

/** Feather: file-text — note presence marker in cells */
export function FileTextIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

/** Feather: refresh-cw */
export function RefreshIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

/** Feather: inbox */
export function InboxIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

/** Feather: briefcase */
export function BriefcaseIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

/** Feather: toggle-left */
export function ToggleLeftIcon({ className = 'h-4 w-4', filled = false }: { className?: string; filled?: boolean }) {
  if (filled) {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        <rect x="1" y="5" width="22" height="14" rx="7" ry="7" fill="currentColor" />
        <circle cx="8" cy="12" r="3" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <rect x="1" y="5" width="22" height="14" rx="7" ry="7" />
      <circle cx="8" cy="12" r="3" />
    </svg>
  );
}

/** Feather: toggle-right */
export function ToggleRightIcon({ className = 'h-4 w-4', filled = false }: { className?: string; filled?: boolean }) {
  if (filled) {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        <rect x="1" y="5" width="22" height="14" rx="7" ry="7" fill="currentColor" />
        <circle cx="16" cy="12" r="3" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <rect x="1" y="5" width="22" height="14" rx="7" ry="7" />
      <circle cx="16" cy="12" r="3" />
    </svg>
  );
}

/** Feather: pause-circle */
export function PauseCircleIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="10" y1="15" x2="10" y2="9" />
      <line x1="14" y1="15" x2="14" y2="9" />
    </svg>
  );
}

/** Feather play, filled. */
export function PlayIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

/** Feather: play-circle */
export function PlayCircleIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" />
    </svg>
  );
}

/** Feather: x-circle */
export function XCircleIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

/** Feather: terminal */
export function TerminalIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

/** Feather: activity */
export function ActivityIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

/** Feather: bell */
export function BellIcon({
  className = 'h-4 w-4',
  fill,
  stroke: strokeColor,
}: {
  className?: string;
  fill?: string;
  stroke?: string;
}) {
  if (fill) {
    const outline = strokeColor
      ? { stroke: strokeColor, strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
      : { stroke: 'none' };
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        <path fill={fill} {...outline} d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9z" />
        <path fill={fill} {...outline} d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

/** Feather: shuffle */
export function ShuffleIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  );
}

/** Feather: bell-off */
export function BellOffIcon({
  className = 'h-4 w-4',
  crisp = false,
  bold = false,
}: {
  className?: string;
  crisp?: boolean;
  bold?: boolean;
}) {
  const pen = bold ? { ...stroke, strokeWidth: 2.5 } : crisp ? strokeCrisp : stroke;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...pen}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <path d="M18 8a6 6 0 0 0-9.33-5" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

/** Feather: info */
export function InfoIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

/** Feather: arrow-up */
export function ArrowUpIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

/** Feather: arrow-down */
export function ArrowDownIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

/** Feather: arrow-left */
export function ArrowLeftIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

/** Feather: arrow-right */
export function ArrowRightIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/** Feather: save */
export function SaveIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

/** Feather: crosshair */
export function CrosshairIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="22" y1="12" x2="18" y2="12" />
      <line x1="6" y1="12" x2="2" y2="12" />
      <line x1="12" y1="6" x2="12" y2="2" />
      <line x1="12" y1="22" x2="12" y2="18" />
    </svg>
  );
}

/** Feather: bookmark */
export function BookmarkIcon({
  className = 'h-3.5 w-3.5',
  filled = false,
}: {
  className?: string;
  filled?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Feather: clock */
export function ClockIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

/** Feather: copy */
export function CopyIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/** Feather: help-circle */
export function HelpCircleIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/** Feather: message-square */
export function MessageSquareIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Feather: clipboard */
export function ClipboardIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}

/** Feather: shield — missing reviewer. */
export function ShieldIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/** Feather: user-check — missing tester in a table cell. */
export function UserCheckIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <polyline points="17 11 19 13 23 9" />
    </svg>
  );
}

/** Feather: eye-off. Crisp stroke so the mark stays sharp when the cell scales it. */
export function EyeOffIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

/** Feather: x */
export function XIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/** Feather: anchor */
export function AnchorIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <circle cx="12" cy="5" r="3" />
      <line x1="12" y1="22" x2="12" y2="8" />
      <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
    </svg>
  );
}

/** Feather: table */
export function TableIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
    </svg>
  );
}

/** Feather: edit */
export function EditIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

/** Feather: check-circle */
export function CheckCircleIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

/** Feather: check-square */
export function CheckSquareIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

/** Feather: eye */
export function EyeIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Feather: hash */
export function HashIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" />
      <line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  );
}

/** Feather: trash-2 */
export function TrashIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

/** Feather: users */
export function UsersIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/** Feather: columns */
export function ColumnsIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7m0-18H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7m0-18v18" />
    </svg>
  );
}

/** Feather: minus */
export function MinusIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Feather: plus */
export function PlusIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Feather: move */
export function MoveIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <polyline points="5 9 2 12 5 15" />
      <polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" />
      <polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
    </svg>
  );
}

/** Feather: user */
export function UserIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...strokeCrisp} aria-hidden>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/** Feather: download */
export function DownloadIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/** Feather: upload */
export function UploadIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...stroke} aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

/** Feather: calendar */
export function CalendarIcon({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      {...strokeCrisp}
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function IconActionButton({
  title,
  onClick,
  className = '',
  disabled,
  children,
  tone = 'brand',
  size = 'md',
}: {
  title: string;
  onClick: (e: MouseEvent) => void;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
  tone?: 'brand' | 'muted';
  size?: 'sm' | 'md';
}) {
  const toneClass =
    tone === 'muted'
      ? 'text-slate-400 hover:text-slate-600'
      : 'text-[#3647d2] hover:text-[#2a38b0]';
  const box = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={`cursor-pointer inline-flex ${box} items-center justify-center rounded bg-transparent ${toneClass} shrink-0 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function BookmarkToggleButton({
  active,
  title,
  onClick,
  className = '',
}: {
  active: boolean;
  title?: string;
  onClick: (e: MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title || (active ? 'Снять закладку' : 'Добавить закладку')}
      className={`cursor-pointer inline-flex h-4 w-4 items-center justify-center rounded bg-transparent shrink-0 ${
        active ? 'text-red-800 hover:text-red-900' : 'text-slate-400 hover:text-slate-600'
      } ${className}`}
      onClick={onClick}
    >
      <BookmarkIcon className="h-3.5 w-3.5" filled={active} />
    </button>
  );
}

/** Right-side icon stack for issue list cards: up to 4 icons per column, left-aligned. */
export function IssueListIconStack({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  if (!items.length) return null;
  const perCol = 4;
  const columns: ReactNode[][] = [];
  for (let i = 0; i < items.length; i += perCol) {
    columns.push(items.slice(i, i + perCol));
  }
  return (
    <div className="flex gap-px shrink-0">
      {columns.map((col, idx) => (
        <div key={idx} className="flex flex-col items-start gap-px">
          {col}
        </div>
      ))}
    </div>
  );
}

function roleToneClass(tone: 'warn' | 'muted') {
  return tone === 'warn' ? 'text-red-700' : 'text-slate-500';
}

/** Missing reviewer (shield) or tester (user-check). Faded until hover, then fully opaque. */
export function MissingRoleMark({
  kind,
  tone,
  title,
}: {
  kind: 'reviewer' | 'tester';
  tone: 'warn' | 'muted';
  title?: string;
}) {
  const Icon = kind === 'reviewer' ? ShieldIcon : UserCheckIcon;
  return (
    <span
      title={title}
      className={`bro-fade-mark inline-flex h-4 w-4 shrink-0 items-center justify-center ${roleToneClass(tone)}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

/** Clock without frame — muted gray */
export function ClockBadge({
  title,
  size = 'sm',
  className = '',
}: {
  tone?: 'stale' | 'overdue';
  title?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const sizeClass = size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]';
  const iconClass = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <span
      title={title ?? 'Нет активности более недели'}
      className={`bro-fade-mark inline-flex items-center justify-center bg-transparent text-slate-500 ${sizeClass} ${className}`}
    >
      <ClockIcon className={iconClass} />
    </span>
  );
}

/** clipboard note marker — #5e80e7 at 50% opacity (table cells) */
export function NoteMarkerBadge({
  title = 'Есть заметка',
  size = 'sm',
  className = '',
}: {
  title?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const sizeClass = size === 'sm' ? 'h-[15px] w-[15px]' : 'h-[18px] w-[18px]';
  const iconClass = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center bg-transparent text-red-800 ${sizeClass} ${className}`}
    >
      <ClipboardIcon className={iconClass} />
    </span>
  );
}

/** Note edit/create control — clipboard; blue when note exists, gray when empty */
export function NoteClipboardButton({
  hasNote,
  title,
  onClick,
  className = '',
}: {
  hasNote: boolean;
  title?: string;
  onClick: (e: MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title || (hasNote ? 'Изменить заметку' : 'Добавить заметку')}
      className={`cursor-pointer inline-flex h-4 w-4 items-center justify-center rounded bg-transparent shrink-0 ${
        hasNote
          ? 'text-red-800 hover:text-red-900'
          : 'text-slate-300 hover:text-slate-400'
      } ${className}`}
      onClick={onClick}
    >
      <ClipboardIcon className="h-3.5 w-3.5" />
    </button>
  );
}

/** Past-sprint marker — same red as bookmark */
export function PastSprintBadge({
  title = 'Задача из прошлого спринта',
  size = 'sm',
  className = '',
}: {
  title?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const sizeClass = size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]';
  const iconClass = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center bg-transparent text-[#1a91db] ${sizeClass} ${className}`}
    >
      <CalendarIcon className={iconClass} />
    </span>
  );
}

export type CellBadgeKind = 'bookmark' | 'note' | 'reviewer' | 'tester' | 'time' | 'sprint' | 'changes';

function CellIconButton(props: {
  title: string;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean } | null>(null);
  return (
    <>
      <button
        type="button"
        className={`pointer-events-auto relative z-[2] inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center p-0 cursor-pointer rounded-sm ${props.className || ''}`}
        onMouseEnter={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const below = rect.top < 36;
          setTip({
            x: rect.left + rect.width / 2,
            y: below ? rect.bottom + 6 : rect.top - 6,
            below,
          });
        }}
        onMouseLeave={() => setTip(null)}
        onClick={(e) => {
          e.stopPropagation();
          setTip(null);
          props.onClick?.();
        }}
      >
        {props.children}
      </button>
      {tip &&
        createPortal(
          <div
            className={`pointer-events-none fixed z-50 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white shadow ${
              tip.below ? '' : '-translate-y-full'
            }`}
            style={{ left: tip.x, top: tip.y }}
          >
            {props.title}
          </div>,
          document.body,
        )}
    </>
  );
}

export type CellBadgeModel = {
  missingReviewer: boolean;
  missingTester: boolean;
  reviewerTone: 'warn' | 'muted';
  testerTone: 'warn' | 'muted';
  hasNote: boolean;
  timeWarn: 'stale' | 'overdue' | null;
  bookmarked: boolean;
  pastSprint: boolean;
  changes?: boolean;
};

/**
 * Top-left: bookmark, clipboard note. Top-right: R, T. Bottom-right: clock, calendar.
 */
export function CellBadgeStack(props: {
  model: CellBadgeModel;
  className?: string;
  onPick?: (kind: CellBadgeKind) => void;
}) {
  const { model } = props;
  const topRight: ReactNode[] = [];
  const bottom: ReactNode[] = [];
  const topLeft: ReactNode[] = [];
  const pick = (kind: CellBadgeKind) => props.onPick?.(kind);

  if (model.bookmarked) {
    topLeft.push(
      <CellIconButton key="bm" title="Есть задачи с закладкой" className="text-red-800" onClick={() => pick('bookmark')}>
        <BookmarkIcon className="h-3.5 w-3.5" filled />
      </CellIconButton>,
    );
  }
  if (model.hasNote) {
    topLeft.push(
      <CellIconButton key="note" title="Есть заметка к задаче" className="text-red-800" onClick={() => pick('note')}>
        <ClipboardIcon className="h-3.5 w-3.5" />
      </CellIconButton>,
    );
  }
  if (model.missingReviewer) {
    topRight.push(
      <CellIconButton
        key="R"
        title="Есть задачи без ревьюера"
        className={`bro-fade-mark ${roleToneClass(model.reviewerTone)}`}
        onClick={() => pick('reviewer')}
      >
        <ShieldIcon className="bro-role-icon h-3.5 w-3.5" />
      </CellIconButton>,
    );
  }
  if (model.missingTester) {
    topRight.push(
      <CellIconButton
        key="T"
        title="Есть задачи без тестировщика"
        className={`bro-fade-mark ${roleToneClass(model.testerTone)}`}
        onClick={() => pick('tester')}
      >
        <UserCheckIcon className="bro-role-icon h-3.5 w-3.5" />
      </CellIconButton>,
    );
  }
  if (model.timeWarn) {
    bottom.push(
      <CellIconButton
        key="clock"
        title={
          model.timeWarn === 'stale'
            ? 'Есть задачи без активности больше 7 дней'
            : 'Есть просроченные задачи'
        }
        className="bro-fade-mark text-slate-500"
        onClick={() => pick('time')}
      >
        <ClockIcon className="h-3.5 w-3.5" />
      </CellIconButton>,
    );
  }
  if (model.pastSprint) {
    bottom.push(
      <CellIconButton key="past" title="Есть задачи из другого спринта" className="text-[#1a91db]" onClick={() => pick('sprint')}>
        <CalendarIcon className="h-3.5 w-3.5" />
      </CellIconButton>,
    );
  }
  if (!topLeft.length && !topRight.length && !bottom.length) return null;

  const micro: ReactNode[] = [];
  if (model.bookmarked) {
    micro.push(
      <span key="bm" title="Закладка" className="text-red-800">
        <BookmarkIcon className="h-2 w-2" filled />
      </span>,
    );
  }
  if (model.hasNote) {
    micro.push(
      <span key="note" title="Есть заметка к задаче" className="text-red-800">
        <ClipboardIcon className="h-2 w-2" />
      </span>,
    );
  }
  if (model.missingReviewer) {
    micro.push(
      <span key="R" title="Есть задачи без ревьюера" className={roleToneClass(model.reviewerTone)}>
        <ShieldIcon className="h-2 w-2" />
      </span>,
    );
  }
  if (model.missingTester) {
    micro.push(
      <span key="T" title="Есть задачи без тестировщика" className={roleToneClass(model.testerTone)}>
        <UserCheckIcon className="h-2 w-2" />
      </span>,
    );
  }
  if (model.timeWarn) {
    micro.push(
      <span
        key="clock"
        title={
          model.timeWarn === 'stale'
            ? 'Есть задачи без активности больше 7 дней'
            : 'Есть просроченные задачи'
        }
        className="text-slate-500"
      >
        <ClockIcon className="h-2 w-2" />
      </span>,
    );
  }
  if (model.pastSprint) {
    micro.push(
      <span key="past" title="Задача из прошлого спринта" className="text-[#1a91db]">
        <CalendarIcon className="h-2 w-2" />
      </span>,
    );
  }

  return (
    <>
      <div className={`bro-badges-roomy absolute inset-0 pointer-events-none z-[2] ${props.className || ''}`}>
        {topLeft.length > 0 && (
          <div className="bro-corner-tl absolute top-px left-0.5 flex flex-row items-center gap-px">{topLeft}</div>
        )}
        {topRight.length > 0 && (
          <div className="bro-corner-tr absolute top-px right-px flex flex-row items-center gap-px">{topRight}</div>
        )}
        {bottom.length > 0 && (
          <div className="bro-corner-br absolute bottom-px right-px flex flex-row items-center gap-px">
            {bottom}
          </div>
        )}
      </div>
      <div className="bro-badges-tight pointer-events-none absolute bottom-0.5 right-0.5 top-0.5 z-[1] w-[1.05rem] flex-row flex-wrap content-center items-center justify-end gap-px">
        {micro}
      </div>
    </>
  );
}
