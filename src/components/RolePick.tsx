import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Developer } from '@shared/types';
import { personHoldsRole, roleIsSet, splitRolePeople, type IssueRole } from '@shared/rolePick';

const EDGE = 8;

export function RolePick(props: {
  role: IssueRole;
  current: string | null | undefined;
  people: Developer[];
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  children: ReactNode;
  onChange: (person: Developer | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const groups = splitRolePeople(props.people, props.role);
  const held = roleIsSet(props.current);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const maxHeight = Math.max(120, window.innerHeight - EDGE * 2);
      let left = anchor.left;
      let top = anchor.bottom + 4;
      if (left + width > window.innerWidth - EDGE) left = window.innerWidth - EDGE - width;
      if (left < EDGE) left = EDGE;
      if (top + Math.min(height, maxHeight) > window.innerHeight - EDGE) top = anchor.top - 4 - Math.min(height, maxHeight);
      if (top < EDGE) top = EDGE;
      setPos({ left, top, maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, props.people, props.current, props.role]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (props.disabled) {
    return <span className={props.className}>{props.children}</span>;
  }

  const pick = (person: Developer | null) => {
    if (person == null && !held) return;
    if (person && personHoldsRole(person, props.current)) return;
    setOpen(false);
    props.onChange(person);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={props.busy}
        className={`min-w-0 cursor-pointer bg-transparent p-0 text-left disabled:opacity-50 ${props.className ?? ''}`}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (!props.busy) setOpen((value) => !value);
        }}
      >
        {props.children}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[10050] w-52 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-xs text-slate-800 shadow-lg"
            style={{
              left: pos?.left ?? -9999,
              top: pos?.top ?? 0,
              maxHeight: pos?.maxHeight ?? 320,
              visibility: pos ? 'visible' : 'hidden',
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <MenuItem disabled={!held} onPick={() => pick(null)}>
              Нет
            </MenuItem>
            {(groups.primary.length > 0 || groups.rest.length > 0) && <div className="my-1 border-t border-slate-200" />}
            {groups.primary.map((person) => (
              <MenuItem
                key={person.id}
                disabled={personHoldsRole(person, props.current)}
                onPick={() => pick(person)}
              >
                {person.displayName}
              </MenuItem>
            ))}
            {groups.primary.length > 0 && groups.rest.length > 0 && <div className="my-1 border-t border-slate-200" />}
            {groups.rest.map((person) => (
              <MenuItem
                key={person.id}
                disabled={personHoldsRole(person, props.current)}
                onPick={() => pick(person)}
              >
                {person.displayName}
              </MenuItem>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function MenuItem(props: { disabled: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      className="block w-full truncate px-2 py-1 text-left hover:bg-slate-50 disabled:cursor-default disabled:text-slate-300 disabled:hover:bg-transparent"
      onClick={props.onPick}
    >
      {props.children}
    </button>
  );
}
