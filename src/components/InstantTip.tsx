import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type TipPlace = 'top' | 'bottom' | 'left' | 'right';

const EDGE = 8;

function horizontalNudge(anchorX: number, width: number): number {
  const left = anchorX - width / 2;
  if (left + width > window.innerWidth - EDGE) return window.innerWidth - EDGE - (left + width);
  if (left < EDGE) return EDGE - left;
  return 0;
}

function verticalNudge(anchorY: number, height: number): number {
  const top = anchorY - height / 2;
  if (top + height > window.innerHeight - EDGE) return window.innerHeight - EDGE - (top + height);
  if (top < EDGE) return EDGE - top;
  return 0;
}

function baseTransform(place: TipPlace): string {
  if (place === 'right') return 'translateY(-50%)';
  if (place === 'left') return 'translate(-100%, -50%)';
  if (place === 'bottom') return 'translateX(-50%)';
  return 'translate(-50%, -100%)';
}

export function InstantTip(props: {
  text: string;
  place?: TipPlace;
  className?: string;
  children: ReactNode;
}) {
  const place = props.place ?? 'top';
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [nudge, setNudge] = useState(0);
  const tipRef = useRef<HTMLSpanElement>(null);
  const horizontal = place === 'top' || place === 'bottom';

  useLayoutEffect(() => {
    const node = tipRef.current;
    if (!tip || !node) return;
    const next = horizontal ? horizontalNudge(tip.x, node.offsetWidth) : verticalNudge(tip.y, node.offsetHeight);
    setNudge((value) => (value === next ? value : next));
  }, [tip, horizontal, place, props.text]);

  const shift = nudge ? (horizontal ? ` translateX(${nudge}px)` : ` translateY(${nudge}px)`) : '';
  return (
    <>
      <span
        className={props.className}
        onMouseEnter={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setNudge(0);
          if (place === 'right') setTip({ x: box.right + 6, y: box.top + box.height / 2 });
          else if (place === 'left') setTip({ x: box.left - 6, y: box.top + box.height / 2 });
          else if (place === 'bottom') setTip({ x: box.left + box.width / 2, y: box.bottom + 6 });
          else setTip({ x: box.left + box.width / 2, y: box.top - 4 });
        }}
        onMouseLeave={() => {
          setTip(null);
          setNudge(0);
        }}
      >
        {props.children}
      </span>
      {tip &&
        createPortal(
          <span
            ref={tipRef}
            className="pointer-events-none fixed z-[9999] whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-white shadow-lg"
            style={{ left: tip.x, top: tip.y, transform: baseTransform(place) + shift }}
          >
            {props.text}
          </span>,
          document.body,
        )}
    </>
  );
}
