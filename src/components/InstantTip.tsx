import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type TipPlace = 'top' | 'bottom' | 'left' | 'right';

const EDGE = 8;
const GAP = 6;

type Anchor = { left: number; top: number; right: number; bottom: number; width: number; height: number };

function anchorOf(box: DOMRect): Anchor {
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
}

function opposite(place: TipPlace): TipPlace {
  if (place === 'top') return 'bottom';
  if (place === 'bottom') return 'top';
  if (place === 'left') return 'right';
  return 'left';
}

function tipOrigin(anchor: Anchor, place: TipPlace, width: number, height: number) {
  if (place === 'bottom') {
    return { left: anchor.left + anchor.width / 2 - width / 2, top: anchor.bottom + GAP };
  }
  if (place === 'left') {
    return { left: anchor.left - GAP - width, top: anchor.top + anchor.height / 2 - height / 2 };
  }
  if (place === 'right') {
    return { left: anchor.right + GAP, top: anchor.top + anchor.height / 2 - height / 2 };
  }
  return { left: anchor.left + anchor.width / 2 - width / 2, top: anchor.top - GAP - height };
}

function fits(left: number, top: number, width: number, height: number) {
  return (
    left >= EDGE &&
    top >= EDGE &&
    left + width <= window.innerWidth - EDGE &&
    top + height <= window.innerHeight - EDGE
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function placeInstantTip(anchor: Anchor, prefer: TipPlace, width: number, height: number) {
  const order: TipPlace[] = [prefer, opposite(prefer), 'top', 'bottom', 'left', 'right'];
  const seen = new Set<TipPlace>();
  for (const place of order) {
    if (seen.has(place)) continue;
    seen.add(place);
    const raw = tipOrigin(anchor, place, width, height);
    if (fits(raw.left, raw.top, width, height)) return raw;
  }
  const raw = tipOrigin(anchor, prefer, width, height);
  return {
    left: clamp(raw.left, EDGE, window.innerWidth - EDGE - width),
    top: clamp(raw.top, EDGE, window.innerHeight - EDGE - height),
  };
}

function TipBubble(props: { text: string; anchor: Anchor; place: TipPlace }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const next = placeInstantTip(props.anchor, props.place, node.offsetWidth, node.offsetHeight);
    setPos((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next));
  }, [props.anchor, props.place, props.text]);
  return createPortal(
    <span
      ref={ref}
      className="pointer-events-none fixed z-[10050] max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)] overflow-hidden whitespace-pre-line break-words rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium leading-snug text-white shadow-lg"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      {props.text}
    </span>,
    document.body,
  );
}

export function InstantTip(props: {
  text: string;
  place?: TipPlace;
  className?: string;
  children: ReactNode;
}) {
  const place = props.place ?? 'top';
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const text = props.text.trim();
  useEffect(() => {
    if (!anchor) return;
    const hide = () => setAnchor(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [anchor]);
  return (
    <>
      <span
        data-instant-tip=""
        className={props.className}
        onMouseEnter={(event) => {
          if (!text) return;
          setAnchor(anchorOf(event.currentTarget.getBoundingClientRect()));
        }}
        onMouseLeave={() => setAnchor(null)}
      >
        {props.children}
      </span>
      {anchor && text && <TipBubble text={text} anchor={anchor} place={place} />}
    </>
  );
}

function anchorVisible(box: Anchor) {
  return box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth;
}

function titledAt(x: number, y: number): HTMLElement | null {
  const stack = document.elementsFromPoint(x, y);
  for (const node of stack) {
    if (!(node instanceof Element)) continue;
    if (node.closest('[data-instant-tip]')) return null;
    const host = node.closest('[title]');
    if (!(host instanceof HTMLElement)) continue;
    if (!host.getAttribute('title')?.trim()) continue;
    return host;
  }
  for (const node of document.querySelectorAll('button:disabled[title], input:disabled[title]')) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest('[data-instant-tip]')) continue;
    const box = node.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
    if (!node.getAttribute('title')?.trim()) continue;
    return node;
  }
  return null;
}

/** Browser `title` tips are delayed and can leave the window. This shows the same text at once, inside the window. */
export function InstantTitleLayer() {
  const [tip, setTip] = useState<{ text: string; anchor: Anchor } | null>(null);
  const held = useRef<{ el: HTMLElement; title: string; obs: MutationObserver } | null>(null);

  useEffect(() => {
    const release = () => {
      const item = held.current;
      if (!item) return;
      item.obs.disconnect();
      held.current = null;
      if (item.el.isConnected && !item.el.hasAttribute('title')) item.el.setAttribute('title', item.title);
    };
    const show = (el: HTMLElement) => {
      if (held.current?.el === el) return;
      const text = (el.getAttribute('title') || '').trim();
      if (!text) return;
      release();
      const title = el.getAttribute('title') || text;
      el.removeAttribute('title');
      const obs = new MutationObserver(() => {
        const next = el.getAttribute('title');
        if (!next || held.current?.el !== el) return;
        held.current.title = next;
        el.removeAttribute('title');
        const trimmed = next.trim();
        setTip(trimmed ? { text: trimmed, anchor: anchorOf(el.getBoundingClientRect()) } : null);
      });
      obs.observe(el, { attributes: true, attributeFilter: ['title'] });
      held.current = { el, title, obs };
      const anchor = anchorOf(el.getBoundingClientRect());
      setTip(anchorVisible(anchor) ? { text, anchor } : null);
    };
    const hide = () => {
      release();
      setTip(null);
    };
    const sync = (x: number, y: number) => {
      const heldEl = held.current?.el;
      if (heldEl) {
        const box = heldEl.getBoundingClientRect();
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return;
      }
      const el = titledAt(x, y);
      if (el) {
        show(el);
        return;
      }
      if (held.current) hide();
    };
    const onMove = (event: PointerEvent) => sync(event.clientX, event.clientY);
    const onLeave = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      hide();
    };
    const onScroll = () => {
      const el = held.current?.el;
      if (!el) return;
      const anchor = anchorOf(el.getBoundingClientRect());
      const text = held.current?.title.trim() || '';
      setTip(text && anchorVisible(anchor) ? { text, anchor } : null);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', hide);
      release();
    };
  }, []);

  if (!tip) return null;
  return <TipBubble text={tip.text} anchor={tip.anchor} place="top" />;
}
