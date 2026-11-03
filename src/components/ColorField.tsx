import { useEffect, useRef, useState } from 'react';

type Props = {
  value: string;
  onChange: (hex: string) => void;
  className?: string;
  size?: 'sm' | 'md';
};

function normalizeHex(raw: string): string | null {
  const v = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
  return null;
}

function hexToHsl(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lig - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Swatch opens hue / saturation / lightness sliders. Hex is a separate field. No eyedropper. */
export default function ColorField({ value, onChange, className = '', size = 'md' }: Props) {
  const hex = normalizeHex(value) || '#64748b';
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const swatchRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [h, s, l] = hexToHsl(hex);
  const swatch =
    size === 'sm'
      ? 'h-5 w-5 shrink-0 rounded border border-slate-300'
      : 'h-8 w-8 shrink-0 rounded border border-slate-300';

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popRef.current?.contains(target) || swatchRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function openPicker() {
    const rect = swatchRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.min(rect.left, window.innerWidth - 240);
      const top = Math.min(rect.bottom + 4, window.innerHeight - 240);
      setPos({ top, left });
    }
    setOpen((valueOpen) => !valueOpen);
  }

  function setHsl(nextH: number, nextS: number, nextL: number) {
    onChange(hslToHex(nextH, nextS, nextL));
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <button
        ref={swatchRef}
        type="button"
        className={swatch}
        style={{ backgroundColor: hex }}
        title="Выбрать цвет"
        aria-label="Выбрать цвет"
        onClick={openPicker}
      />
      {open && (
        <div
          ref={popRef}
          className="fixed z-[80] w-56 space-y-2 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
          style={{ top: pos.top, left: pos.left }}
        >
          <input
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-mono"
            value={value}
            spellCheck={false}
            aria-label="Цвет (hex)"
            title="Цвет в формате #rrggbb"
            onChange={(e) => {
              const next = e.target.value;
              onChange(next);
              const normalized = normalizeHex(next);
              if (normalized && normalized !== next) onChange(normalized);
            }}
            onBlur={() => {
              const normalized = normalizeHex(value);
              if (normalized) onChange(normalized);
            }}
          />
          <label className="block text-[10px] text-slate-500">
            Оттенок
            <input
              type="range"
              min={0}
              max={360}
              value={h}
              className="w-full"
              onChange={(e) => setHsl(Number(e.target.value), s, l)}
            />
          </label>
          <label className="block text-[10px] text-slate-500">
            Бесцветный — насыщенный
            <input
              type="range"
              min={0}
              max={100}
              value={s}
              className="w-full"
              onChange={(e) => setHsl(h, Number(e.target.value), l)}
            />
          </label>
          <label className="block text-[10px] text-slate-500">
            Тёмный — яркий
            <input
              type="range"
              min={0}
              max={100}
              value={l}
              className="w-full"
              onChange={(e) => setHsl(h, s, Number(e.target.value))}
            />
          </label>
        </div>
      )}
    </span>
  );
}
