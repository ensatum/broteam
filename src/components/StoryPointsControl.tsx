import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nearestStoryPoint, STORY_POINT_MARKS } from '@shared/storyPoints';
import { BatteryChargingIcon, CheckIcon, heatStyle } from './Icons';

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
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
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
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-slate-50 px-1 text-[11px] font-bold leading-none text-slate-600">
      {saved}
    </span>
  );

  if (props.disabled) {
    return <span className="inline-flex h-4 shrink-0 items-center justify-center">{mark}</span>;
  }

  const index = Math.max(0, STORY_POINT_MARKS.indexOf(draft as (typeof STORY_POINT_MARKS)[number]));

  return (
    <>
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
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="fixed z-[10050] flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1 py-1 shadow-lg"
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Стереть Story Points"
              disabled={busy || saved == null}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-red-600 hover:bg-red-50 disabled:cursor-default disabled:text-slate-300 disabled:hover:bg-transparent"
              onClick={() => void commit(null)}
            >
              <BatteryChargingIcon className="h-3.5 w-3.5" />
            </button>
            <div className="w-40">
              <input
                type="range"
                min={0}
                max={STORY_POINT_MARKS.length - 1}
                step={1}
                value={index}
                disabled={busy}
                aria-valuetext={String(draft)}
                className="block h-4 w-full cursor-pointer accent-slate-600"
                onChange={(event) => setDraft(STORY_POINT_MARKS[Number(event.target.value)] ?? STORY_POINT_MARKS[0])}
              />
              <div className="flex justify-between px-0.5 text-[9px] leading-none text-slate-400">
                {STORY_POINT_MARKS.map((point) => (
                  <button
                    key={point}
                    type="button"
                    className={`bg-transparent p-0 ${point === draft ? 'font-bold text-slate-700' : ''}`}
                    onClick={() => setDraft(point)}
                  >
                    {point}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              aria-label="Записать Story Points"
              disabled={busy || draft === saved}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50 disabled:cursor-default disabled:text-slate-300 disabled:hover:bg-transparent"
              onClick={() => void commit(draft)}
            >
              <CheckIcon className="h-3.5 w-3.5" />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
