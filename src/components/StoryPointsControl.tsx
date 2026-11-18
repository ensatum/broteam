import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  nearestStoryPoint,
  storyPointBrief,
  storyPointColor,
  storyPointDetail,
  STORY_POINT_MARKS,
  type StoryPointColors,
} from '@shared/storyPoints';
import { hexTint } from '@shared/types';
import { BatteryChargingIcon, BatteryIcon, CheckIcon, heatStyle } from './Icons';
import { InstantTip } from './InstantTip';
import { useStoryPointColors } from '../storyPointPalette';

export function PointsSumBadge(props: { sum: number; tasks: number }) {
  const colors = useStoryPointColors();
  const color = storyPointColor(Math.round(props.sum / props.tasks), colors);
  const wash = hexTint(color, 0.1);
  return (
    <InstantTip text="Story Points" className="pointer-events-auto inline-flex">
      <span className="bro-points-sum" style={{ color, backgroundColor: wash, borderColor: wash }}>
        {props.sum}
      </span>
    </InstantTip>
  );
}

const EDGE = 8;

export function StoryPointsControl(props: {
  value: number | null | undefined;
  disabled?: boolean;
  onApply: (points: number | null) => Promise<void>;
  onError?: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => nearestStoryPoint(props.value));
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const colors = useStoryPointColors();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const saved = typeof props.value === 'number' ? props.value : null;

  useEffect(() => {
    if (!open) setDraft(nearestStoryPoint(props.value));
  }, [props.value, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!anchor || !pop) return;
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      let left = anchor.left + anchor.width / 2 - width / 2;
      let top = anchor.top - 4 - height;
      if (top < EDGE) top = anchor.bottom + 4;
      if (left + width > window.innerWidth - EDGE) left = window.innerWidth - EDGE - width;
      if (left < EDGE) left = EDGE;
      if (top + height > window.innerHeight - EDGE) top = Math.max(EDGE, window.innerHeight - EDGE - height);
      setPos({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, draft]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (busy) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setDraft(nearestStoryPoint(props.value));
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      setDraft(nearestStoryPoint(props.value));
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, busy, props.value]);

  if (props.value === undefined) return null;

  const commit = async (points: number | null) => {
    if (busy) return;
    if (points == null && saved == null) return;
    if (points != null && points === saved) return;
    setBusy(true);
    props.onError?.(null);
    try {
      await props.onApply(points);
      setOpen(false);
    } catch (error) {
      props.onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const mark = saved == null ? (
    <BatteryChargingIcon className="h-3.5 w-3.5" />
  ) : (
    <span
      className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-slate-50 px-1 text-[11px] font-bold leading-none"
      style={{ color: storyPointColor(saved, colors) }}
    >
      {saved}
    </span>
  );

  if (props.disabled) {
    return (
      <InstantTip text="Story Points" className="inline-flex">
        <span className="inline-flex h-4 shrink-0 items-center justify-center">{mark}</span>
      </InstantTip>
    );
  }

  return (
    <>
      <InstantTip text="Story Points" className="inline-flex">
      <button
        ref={anchorRef}
        type="button"
        className="inline-flex h-4 shrink-0 cursor-pointer items-center justify-center bg-transparent p-0"
        style={saved == null ? heatStyle(1) : undefined}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (busy) return;
          if (open) {
            setDraft(nearestStoryPoint(props.value));
            setOpen(false);
            return;
          }
          setDraft(nearestStoryPoint(props.value));
          setOpen(true);
        }}
      >
        {mark}
      </button>
      </InstantTip>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="fixed z-[10050] rounded-md border border-slate-200 bg-white px-1 py-1 shadow-lg"
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <InstantTip
              text={storyPointDetail(draft)}
              place="top"
              className="mb-1 block max-w-56 cursor-default px-1 text-center text-[10px] leading-snug text-slate-600"
            >
              {storyPointBrief(draft)}
            </InstantTip>
            <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Стереть Story Points"
              disabled={busy || saved == null}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-red-600 hover:bg-red-50 disabled:cursor-default disabled:text-slate-300 disabled:hover:bg-transparent"
              onClick={() => void commit(null)}
            >
              <BatteryIcon className="h-3.5 w-3.5" />
            </button>
            <StorySlider value={draft} disabled={busy} onChange={setDraft} colors={colors} />
            <button
              type="button"
              aria-label="Записать Story Points"
              disabled={busy || draft === saved}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50 disabled:cursor-default disabled:text-slate-300 disabled:hover:bg-transparent"
              onClick={() => void commit(draft)}
            >
              <CheckIcon className="h-3.5 w-3.5" />
            </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function StorySlider(props: {
  value: number;
  colors: StoryPointColors;
  disabled?: boolean;
  onChange: (point: number) => void;
}) {
  const count = STORY_POINT_MARKS.length;
  const index = Math.max(0, STORY_POINT_MARKS.indexOf(props.value as (typeof STORY_POINT_MARKS)[number]));
  const color = storyPointColor(props.value, props.colors);
  const trackRef = useRef<HTMLDivElement>(null);
  const pick = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const next = Math.round(((clientX - rect.left) / rect.width) * count - 0.5);
    const clamped = Math.max(0, Math.min(count - 1, next));
    props.onChange(STORY_POINT_MARKS[clamped] ?? STORY_POINT_MARKS[0]);
  };
  return (
    <div
      ref={trackRef}
      className="relative w-44 select-none"
      onPointerDown={(event) => {
        if (props.disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pick(event.clientX);
      }}
      onPointerMove={(event) => {
        if (props.disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        pick(event.clientX);
      }}
    >
      <div
        className="pointer-events-none absolute top-[5px] h-1 rounded bg-slate-200"
        style={{ left: `${50 / count}%`, right: `${50 / count}%` }}
      >
        <div className="h-full rounded" style={{ width: `${(index / (count - 1)) * 100}%`, backgroundColor: color }} />
      </div>
      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
        {STORY_POINT_MARKS.map((point, item) => (
          <div key={point} className="flex flex-col items-center">
            <span
              className={`h-3 w-3 rounded-full ${item === index ? 'border border-white' : ''}`}
              style={item === index ? { backgroundColor: color } : undefined}
            />
            <span
              className={`mt-0.5 text-[9px] leading-none ${point === props.value ? 'font-bold' : 'text-slate-400'}`}
              style={point === props.value ? { color } : undefined}
            >
              {point}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
