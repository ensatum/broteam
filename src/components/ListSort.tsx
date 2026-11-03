import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TrackerIssue } from '@shared/types';

export type ListSortKey = 'created' | 'activity' | 'number' | 'assignee' | 'reviewer' | 'qa';
export type ListSortDir = 'asc' | 'desc';
export type ListSort = { key: ListSortKey; dir: ListSortDir };

const STORAGE_KEY = 'broteam.listSort';

const OPTIONS: Array<{ key: ListSortKey; label: string; title?: string; hint?: string }> = [
  { key: 'created', label: 'Создана' },
  { key: 'activity', label: 'Активность' },
  { key: 'number', label: 'Номер' },
  { key: 'assignee', label: 'Исполнитель' },
  { key: 'reviewer', label: 'Ревьюер' },
  { key: 'qa', label: 'QA', title: 'Тестировщик, поле QA', hint: 'тестировщик' },
];

export function defaultSortDir(key: ListSortKey): ListSortDir {
  return key === 'created' || key === 'activity' ? 'desc' : 'asc';
}

export function loadListSort(): ListSort {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { key: 'number', dir: 'asc' };
    const parsed = JSON.parse(raw) as Partial<ListSort>;
    const key = OPTIONS.some((opt) => opt.key === parsed.key) ? (parsed.key as ListSortKey) : 'number';
    const dir = parsed.dir === 'asc' || parsed.dir === 'desc' ? parsed.dir : defaultSortDir(key);
    return { key, dir };
  } catch {
    return { key: 'number', dir: 'asc' };
  }
}

export function saveListSort(sort: ListSort) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sort));
}

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function issueNumber(key: string): number {
  const match = /-(\d+)$/.exec(key);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function activityMs(issue: TrackerIssue): number | null {
  const times = [issue.statusStartTime, issue.lastCommentUpdatedAt, issue.updatedAt]
    .map((iso) => timeOf(iso))
    .filter((t): t is number => t != null);
  if (!times.length) return null;
  return Math.max(...times);
}

function cmpMissingLast(a: number | null, b: number | null, dir: ListSortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

function cmpText(a: string, b: string, dir: ListSortDir): number {
  const left = a.trim();
  const right = b.trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const cmp = left.localeCompare(right, 'ru', { sensitivity: 'base' });
  return dir === 'asc' ? cmp : -cmp;
}

export function sortIssues(
  issues: TrackerIssue[],
  sort: ListSort,
  createdAt: (issue: TrackerIssue) => string | null | undefined,
): TrackerIssue[] {
  const copy = [...issues];
  copy.sort((a, b) => {
    let cmp = 0;
    if (sort.key === 'created') cmp = cmpMissingLast(timeOf(createdAt(a)), timeOf(createdAt(b)), sort.dir);
    else if (sort.key === 'activity') cmp = cmpMissingLast(activityMs(a), activityMs(b), sort.dir);
    else if (sort.key === 'number') {
      const delta = issueNumber(a.key) - issueNumber(b.key);
      cmp = sort.dir === 'asc' ? delta : -delta;
    } else if (sort.key === 'assignee') cmp = cmpText(a.assigneeDisplay || '', b.assigneeDisplay || '', sort.dir);
    else if (sort.key === 'reviewer') cmp = cmpText(a.reviewerDisplay || '', b.reviewerDisplay || '', sort.dir);
    else cmp = cmpText(a.qaDisplay || '', b.qaDisplay || '', sort.dir);
    return cmp || a.key.localeCompare(b.key);
  });
  return copy;
}

export function ListSortButton(props: {
  sort: ListSort;
  onChange: (next: ListSort) => void;
}) {
  return (
    <SortMenu
      sort={props.sort}
      options={OPTIONS}
      defaultDir={defaultSortDir}
      onChange={props.onChange}
    />
  );
}

export function SortMenu<K extends string>(props: {
  sort: { key: K; dir: ListSortDir };
  options: Array<{ key: K; label: string; title?: string; hint?: string }>;
  defaultDir: (key: K) => ListSortDir;
  onChange: (next: { key: K; dir: ListSortDir }) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = props.options.find((opt) => opt.key === props.sort.key) || props.options[0];
  const arrow = props.sort.dir === 'asc' ? '↑' : '↓';

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = rootRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const rect = anchor.getBoundingClientRect();
      const height = menu.offsetHeight;
      const width = menu.offsetWidth;
      const gap = 4;
      const spaceBelow = window.innerHeight - rect.bottom;
      const up = spaceBelow < height + gap && rect.top > spaceBelow;
      const top = up ? Math.max(8, rect.top - height - gap) : rect.bottom + gap;
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, props.options.length]);

  return (
    <div ref={rootRef} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <div className="inline-flex items-center rounded-md border border-slate-200 bg-white text-[11px] text-slate-700">
        <button
          type="button"
          className="px-1.5 py-0.5 hover:bg-slate-50"
          title="Сменить направление сортировки"
          onClick={() =>
            props.onChange({
              ...props.sort,
              dir: props.sort.dir === 'asc' ? 'desc' : 'asc',
            })
          }
        >
          {current.label} {arrow}
        </button>
        <button
          type="button"
          className="border-l border-slate-200 px-1 py-0.5 text-slate-500 hover:bg-slate-50"
          title="Поле сортировки"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          ▾
        </button>
      </div>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[200] w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            style={{ top: -9999, left: 0 }}
          >
            {props.options.map((opt) => {
              const active = opt.key === props.sort.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  title={opt.title}
                  className={`flex w-full items-center justify-between gap-2 px-2.5 py-1 text-left text-xs hover:bg-slate-50 ${
                    active ? 'font-semibold text-slate-900' : 'text-slate-600'
                  }`}
                  onClick={() => {
                    props.onChange(
                      active
                        ? { key: opt.key, dir: props.sort.dir === 'asc' ? 'desc' : 'asc' }
                        : { key: opt.key, dir: props.defaultDir(opt.key) },
                    );
                    setOpen(false);
                  }}
                >
                  <span>
                    {opt.label}
                    {opt.hint && <span className="ml-1 font-normal text-slate-400">{opt.hint}</span>}
                  </span>
                  {active && <span>{arrow}</span>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
