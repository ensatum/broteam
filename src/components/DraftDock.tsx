import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Developer, LocalDraft } from '@shared/types';
import { applyMarkdownHotkey, handleRichHotkey, hotkeyId, htmlToMarkdown } from '../draftFormat';
import { renderMarkdown } from '../markdown';
import {
  CheckCircleIcon,
  CheckSquareIcon,
  EditIcon,
  EyeIcon,
  HashIcon,
  HelpCircleIcon,
  PlusCircleIcon,
  StarIcon,
  TrashIcon,
  UsersIcon,
  XIcon,
} from './Icons';

const SORT_KEY = 'broteam.draftSort';
const FAVORITES_KEY = 'broteam.draftFavoritesOnly';
const DONE_KEY = 'broteam.draftDoneOnly';

type Props = {
  onError: (msg: string | null) => void;
  onSnapshotContentChange: () => void;
  onOpenChange: (open: boolean) => void;
};

type PendingSel = { which: 'composer' | 'edit'; start: number; end: number };

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() || '';
}

function plainTitle(text: string): string {
  let line = text.trim();
  line = line.replace(/^#{1,6}\s+/, '');
  line = line.replace(/^>\s+/, '');
  line = line.replace(/^(?:[-*]|\d+\.)\s+/, '');
  line = line.replace(/<u>([\s\S]*?)<\/u>/gi, '$1');
  line = line.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  line = line.replace(/`([^`]+)`/g, '$1');
  line = line.replace(/~~([^~]+)~~/g, '$1');
  line = line.replace(/\*\*([^*]+)\*\*/g, '$1');
  line = line.replace(/__([^_]+)__/g, '$1');
  line = line.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
  line = line.replace(/(^|[^_])_([^_\n]+)_/g, '$1$2');
  return line.replace(/\s+/g, ' ').trim();
}

function fullText(row: LocalDraft): string {
  if (!row.body.trim()) return row.title;
  if (!row.title.trim() || row.body.startsWith(row.title)) return row.body;
  return `${row.title}\n${row.body}`;
}

function peopleOf(row: LocalDraft): number[] {
  return row.peopleIds || [];
}

export default function DraftDock(props: Props) {
  const { onError } = props;
  const [rows, setRows] = useState<LocalDraft[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [composerView, setComposerView] = useState<'preview' | 'markdown'>('markdown');
  const [draftText, setDraftText] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftView, setDraftView] = useState<'preview' | 'markdown'>('preview');
  const [editText, setEditText] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleMenuId, setPeopleMenuId] = useState<number | null>(null);
  useEffect(() => {
    if (peopleMenuId == null) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-people-menu]')) return;
      setPeopleMenuId(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [peopleMenuId]);
  const listRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLElement | null>(null);
  const aboveRef = useRef<HTMLDivElement>(null);
  const composerArea = useRef<HTMLTextAreaElement>(null);
  const editArea = useRef<HTMLTextAreaElement>(null);
  const composerPreviewRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const skipComposer = useRef(false);
  const skipEdit = useRef(false);
  const pendingSel = useRef<PendingSel | null>(null);
  const [bodyLayout, setBodyLayout] = useState<{
    height: number;
    scroll: boolean;
    rowH: number;
  } | null>(null);
  const [newestFirst, setNewestFirst] = useState(() => {
    try {
      return localStorage.getItem(SORT_KEY) !== 'asc';
    } catch {
      return true;
    }
  });
  const [favoritesOnly, setFavoritesOnly] = useState(() => {
    try {
      return localStorage.getItem(FAVORITES_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [doneOnly, setDoneOnly] = useState(() => {
    try {
      return localStorage.getItem(DONE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const reload = useCallback(
    async (quiet = false) => {
      if (!quiet) setBusy(true);
      onError(null);
      try {
        const [drafts, devs] = await Promise.all([
          window.api.listDrafts(),
          window.api.listDevelopers(),
        ]);
        setRows(drafts);
        setDevelopers(devs);
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!quiet) setBusy(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    localStorage.setItem(SORT_KEY, newestFirst ? 'desc' : 'asc');
  }, [newestFirst]);

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, favoritesOnly ? '1' : '0');
  }, [favoritesOnly]);

  useEffect(() => {
    localStorage.setItem(DONE_KEY, doneOnly ? '1' : '0');
  }, [doneOnly]);

  async function toggleDone(row: LocalDraft) {
    const next = !row.done;
    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, done: next } : item)));
    onError(null);
    try {
      await window.api.setDraftDone(row.id, next);
    } catch (e) {
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, done: row.done } : item)));
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggleFavorite(row: LocalDraft) {
    const next = !row.favorite;
    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, favorite: next } : item)));
    onError(null);
    try {
      await window.api.setDraftFavorite(row.id, next);
    } catch (e) {
      setRows((current) =>
        current.map((item) => (item.id === row.id ? { ...item, favorite: row.favorite } : item)),
      );
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const delta = Date.parse(a.createdAt) - Date.parse(b.createdAt);
      return newestFirst ? -delta : delta;
    });
    return copy;
  }, [rows, newestFirst]);

  const visible = useMemo(() => {
    const query = peopleQuery.trim().toLowerCase();
    return sorted.filter((row) => {
      if (favoritesOnly && !row.favorite) return false;
      if (doneOnly ? !row.done : row.done) return false;
      if (!query) return true;
      return peopleOf(row).some((id) => {
        const person = developers.find((item) => item.id === id);
        if (!person) return false;
        return (
          person.displayName.toLowerCase().includes(query) ||
          person.login.toLowerCase().includes(query)
        );
      });
    });
  }, [sorted, peopleQuery, developers, favoritesOnly, doneOnly]);

  function openComposer() {
    props.onOpenChange(true);
    setCreating(true);
    setComposerView('markdown');
    setDraftText('');
  }

  function closeComposer() {
    setCreating(false);
    setDraftText('');
  }

  function composerSource(): string {
    if (composerView === 'preview' && composerPreviewRef.current) {
      return htmlToMarkdown(composerPreviewRef.current);
    }
    return draftText;
  }

  async function addDraft() {
    const text = composerSource().replace(/\s+$/, '');
    const title = firstLine(text);
    if (!title) {
      onError('Заметка не может быть пустой');
      return;
    }
    setBusy(true);
    onError(null);
    try {
      const created = await window.api.createDraft(title, text);
      closeComposer();
      props.onSnapshotContentChange();
      await reload();
      setOpenId(created.id);
      setEditText(text);
      setEditing(false);
      setDraftView('preview');
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleOpen(row: LocalDraft) {
    if (openId === row.id) {
      setOpenId(null);
      setEditing(false);
      setPeopleMenuId(null);
      return;
    }
    setOpenId(row.id);
    setEditText(fullText(row));
    setEditing(false);
    setDraftView('preview');
    setPeopleMenuId(null);
  }

  function editSource(): string {
    if (editing && draftView === 'preview' && previewRef.current) {
      return htmlToMarkdown(previewRef.current);
    }
    return editText;
  }

  async function commitEdit(row: LocalDraft) {
    const text = editSource().replace(/\s+$/, '');
    const title = firstLine(text);
    if (!title) {
      onError('Заметка не может быть пустой');
      return;
    }
    const changed = text !== fullText(row).replace(/\s+$/, '');
    setBusy(true);
    onError(null);
    try {
      if (changed) {
        await window.api.updateDraft(row.id, title, text);
        props.onSnapshotContentChange();
        setEditText(text);
        await reload();
      }
      setEditing(false);
      setDraftView('preview');
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeDraft(id: number, titleLabel: string) {
    const ok = window.confirm(`Удалить заметку «${titleLabel.trim() || 'без заголовка'}»?`);
    if (!ok) return;
    setBusy(true);
    onError(null);
    try {
      await window.api.deleteDraft(id);
      if (openId === id) {
        setOpenId(null);
        setEditing(false);
      }
      props.onSnapshotContentChange();
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function changePeople(row: LocalDraft, peopleIds: number[]) {
    onError(null);
    try {
      await window.api.setDraftPeople(row.id, peopleIds);
      props.onSnapshotContentChange();
      await reload(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  function onMarkdownKey(
    event: KeyboardEvent<HTMLTextAreaElement>,
    value: string,
    setValue: (next: string) => void,
    which: PendingSel['which'],
  ) {
    const key = hotkeyId(event);
    if (!key) return;
    if (key !== 'Tab' && !['b', 'i', 'u', 's', 'e'].includes(key)) return;
    const next = applyMarkdownHotkey(
      value,
      event.currentTarget.selectionStart,
      event.currentTarget.selectionEnd,
      key,
      event.shiftKey,
    );
    if (!next) return;
    event.preventDefault();
    setValue(next.value);
    pendingSel.current = { which, start: next.start, end: next.end };
  }

  const openIndex = visible.findIndex((row) => row.id === openId);
  const before = openIndex > 0 ? visible.slice(0, openIndex) : [];
  const opened = openIndex >= 0 ? visible[openIndex] : null;
  const after = openIndex >= 0 ? visible.slice(openIndex + 1) : [];

  useLayoutEffect(() => {
    const pending = pendingSel.current;
    if (!pending) return;
    const area = pending.which === 'composer' ? composerArea.current : editArea.current;
    if (area) {
      area.selectionStart = pending.start;
      area.selectionEnd = pending.end;
    }
    pendingSel.current = null;
  });

  useLayoutEffect(() => {
    const fill = (node: HTMLDivElement | null, text: string, skip: { current: boolean }) => {
      if (!node) return;
      if (skip.current) {
        skip.current = false;
        return;
      }
      node.innerHTML = renderMarkdown(text);
    };
    if (creating && composerView === 'preview') fill(composerPreviewRef.current, draftText, skipComposer);
    if (editing && draftView === 'preview' && opened) fill(previewRef.current, editText, skipEdit);
  }, [creating, composerView, draftText, editing, draftView, editText, opened]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const text = textRef.current;
    if (!list || !text || openId == null || !opened) {
      setBodyLayout(null);
      return;
    }
    const measure = () => {
      const index = visible.findIndex((row) => row.id === openId);
      const chromeEl = list.querySelector<HTMLElement>('[data-draft-open-chrome]');
      const collapsed = list.querySelector<HTMLElement>('[data-draft-collapsed]');
      const rowH = collapsed?.offsetHeight || chromeEl?.offsetHeight || 32;
      const hasBefore = index > 0;
      const hasAfter = index >= 0 && index < visible.length - 1;
      const chrome = chromeEl?.offsetHeight ?? 32;
      const listStyle = getComputedStyle(list);
      const pad = parseFloat(listStyle.paddingTop) + parseFloat(listStyle.paddingBottom);
      const gap = 4;
      const gaps = (hasBefore ? gap : 0) + (hasAfter ? gap : 0);
      const neighbors = (hasBefore ? rowH : 0) + (hasAfter ? rowH : 0);
      const max = Math.max(32, list.clientHeight - pad - chrome - neighbors - gaps - 6);
      text.style.height = 'auto';
      text.style.overflowY = 'hidden';
      const full = text.scrollHeight;
      const scroll = full > max + 1;
      const height = scroll ? max : full;
      text.style.height = `${height}px`;
      text.style.overflowY = scroll ? 'auto' : 'hidden';
      setBodyLayout((prev) =>
        prev && prev.height === height && prev.scroll === scroll && prev.rowH === rowH
          ? prev
          : { height, scroll, rowH },
      );
      if (scroll && aboveRef.current) aboveRef.current.scrollTop = aboveRef.current.scrollHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [openId, opened, editText, draftView, editing, visible]);

  const bodyStyle: { height?: number; overflowY: 'auto' | 'hidden' } = bodyLayout
    ? { height: bodyLayout.height, overflowY: bodyLayout.scroll ? 'auto' : 'hidden' }
    : { overflowY: 'hidden' };

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="shrink-0">
        <div className="flex h-8 items-center gap-1 border-b border-slate-200 px-1.5">
          <FavoriteButton
            active={favoritesOnly}
            title="Избранные"
            onClick={() => setFavoritesOnly((value) => !value)}
          />
          <DoneButton
            done={doneOnly}
            title={doneOnly ? 'Готовые' : 'Не готовые'}
            onClick={() => setDoneOnly((value) => !value)}
          />
          <span className="shrink-0 px-1 text-xs font-semibold text-slate-800">
            Заметки
            <span className="ml-1.5 text-[11px] font-normal text-slate-400">{visible.length}</span>
          </span>
          <label className="relative min-w-0 flex-1">
            <HelpCircleIcon className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-300" />
            <input
              value={peopleQuery}
              onChange={(event) => setPeopleQuery(event.target.value)}
              placeholder="Участник"
              className="h-6 w-full rounded border border-slate-200 bg-white pl-5 pr-1.5 text-[11px] outline-none"
            />
          </label>
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
            title="Сортировка по дате создания"
            onClick={() => setNewestFirst((value) => !value)}
          >
            Дата {newestFirst ? '↓' : '↑'}
          </button>
          <button
            type="button"
            title={creating ? 'Скрыть форму' : 'Новая заметка'}
            aria-pressed={creating}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white hover:bg-sky-700"
            onClick={() => (creating ? closeComposer() : openComposer())}
          >
            <PlusCircleIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {creating && (
          <div className="relative shrink-0 border-b border-slate-100 px-3 py-2">
            <button
              type="button"
              title="Закрыть без сохранения"
              className="absolute right-2 top-1.5 inline-flex h-5 w-5 items-center justify-center text-slate-400 hover:text-slate-700"
              onClick={closeComposer}
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
            {composerView === 'markdown' ? (
              <textarea
                ref={composerArea}
                className="min-h-[72px] w-full resize-y bg-transparent pr-6 text-xs outline-none"
                placeholder="Текст заметки"
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
                onKeyDown={(event) => onMarkdownKey(event, draftText, setDraftText, 'composer')}
                disabled={busy}
                autoFocus
              />
            ) : (
              <div
                ref={composerPreviewRef}
                className="markdown-body min-h-[72px] w-full pr-6 text-xs outline-none"
                contentEditable={!busy}
                suppressContentEditableWarning
                onInput={() => {
                  if (!composerPreviewRef.current) return;
                  skipComposer.current = true;
                  setDraftText(htmlToMarkdown(composerPreviewRef.current));
                }}
                onKeyDown={(event) => {
                  if (!handleRichHotkey(event.nativeEvent)) return;
                  if (!composerPreviewRef.current) return;
                  skipComposer.current = true;
                  setDraftText(htmlToMarkdown(composerPreviewRef.current));
                }}
              />
            )}
            <div className="mt-1 flex items-center justify-end gap-1.5">
              <ModeSwitch className="mr-auto" value={composerView} onChange={setComposerView} />
              <button
                type="button"
                className="rounded bg-slate-900 px-2.5 py-1 text-xs text-white hover:bg-slate-800"
                disabled={busy}
                onClick={() => void addDraft()}
              >
                Сохранить
              </button>
            </div>
          </div>
        )}
        <div
          ref={listRef}
          className={`flex min-h-0 flex-1 flex-col gap-1 px-2 py-1.5 ${
            bodyLayout?.scroll ? 'overflow-hidden' : 'overflow-auto'
          }`}
        >
          {visible.length === 0 && !busy && !creating ? (
            <div className="px-1 py-2 text-xs text-slate-400">
              {peopleQuery.trim()
                ? 'Ничего не найдено'
                : favoritesOnly
                  ? 'Нет избранных'
                  : doneOnly
                    ? 'Нет готовых'
                    : 'Пока нет заметок'}
            </div>
          ) : openId == null || !opened ? (
            visible.map((row) => (
              <CollapsedDraft
                key={row.id}
                row={row}
                developers={developers}
                menuOpen={peopleMenuId === row.id}
                onOpen={() => toggleOpen(row)}
                onToggleMenu={() => setPeopleMenuId((current) => (current === row.id ? null : row.id))}
                onCloseMenu={() => setPeopleMenuId(null)}
                onChangePeople={(ids) => void changePeople(row, ids)}
                onDelete={() => void removeDraft(row.id, row.title)}
                onToggleFavorite={() => void toggleFavorite(row)}
                onToggleDone={() => void toggleDone(row)}
              />
            ))
          ) : (
            <>
              {before.length > 0 && (
                <div
                  ref={aboveRef}
                  className="flex shrink-0 flex-col gap-1 overflow-y-auto"
                  style={bodyLayout?.scroll ? { height: bodyLayout.rowH } : undefined}
                >
                  {before.map((row) => (
                    <CollapsedDraft
                      key={row.id}
                      row={row}
                      developers={developers}
                      menuOpen={peopleMenuId === row.id}
                      onOpen={() => toggleOpen(row)}
                      onToggleMenu={() =>
                        setPeopleMenuId((current) => (current === row.id ? null : row.id))
                      }
                      onCloseMenu={() => setPeopleMenuId(null)}
                      onChangePeople={(ids) => void changePeople(row, ids)}
                      onDelete={() => void removeDraft(row.id, row.title)}
                      onToggleFavorite={() => void toggleFavorite(row)}
                      onToggleDone={() => void toggleDone(row)}
                    />
                  ))}
                </div>
              )}
              <div className="shrink-0 rounded border border-slate-400 text-xs">
                <div data-draft-open-chrome className="rounded-t border-b border-slate-200 bg-slate-50 transition-colors hover:bg-slate-100">
                  <div data-draft-open-header className="flex h-8 w-full items-center gap-1 px-2">
                    <FavoriteButton
                      active={opened.favorite}
                      title={opened.favorite ? 'Избранное' : 'В избранное'}
                      onClick={() => void toggleFavorite(opened)}
                    />
                    <DoneButton
                      done={opened.done}
                      title="В готовые"
                      onClick={() => void toggleDone(opened)}
                    />
                    <button
                      type="button"
                      title={editing ? 'Сохранить' : 'Редактировать'}
                      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-white ${
                        editing
                          ? 'border-emerald-600 bg-emerald-600 hover:border-emerald-700 hover:bg-emerald-700'
                          : 'border-sky-600 bg-sky-600 hover:border-sky-700 hover:bg-sky-700'
                      }`}
                      onClick={() => {
                        if (editing) void commitEdit(opened);
                        else setEditing(true);
                      }}
                    >
                      {editing ? (
                        <CheckSquareIcon className="h-3.5 w-3.5" />
                      ) : (
                        <EditIcon className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {editing && <ModeSwitch value={draftView} onChange={setDraftView} />}
                    <button
                      type="button"
                      className="min-w-0 flex-1 self-stretch"
                      title="Свернуть"
                      onClick={() => toggleOpen(opened)}
                    />
                    <PeopleButton
                      row={opened}
                      developers={developers}
                      menuOpen={peopleMenuId === opened.id}
                      onToggle={() =>
                        setPeopleMenuId((current) => (current === opened.id ? null : opened.id))
                      }
                      onClose={() => setPeopleMenuId(null)}
                      onChange={(ids) => void changePeople(opened, ids)}
                    />
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-slate-400"
                      title="Свернуть"
                      onClick={() => toggleOpen(opened)}
                    >
                      {new Date(opened.createdAt).toLocaleDateString('ru-RU')}
                    </button>
                    <button
                      type="button"
                      title="Удалить"
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-red-300 bg-white text-red-600 hover:border-red-400 hover:bg-red-50"
                      disabled={busy}
                      onClick={() => void removeDraft(opened.id, opened.title)}
                    >
                      <TrashIcon className="h-3 w-3" />
                    </button>
                  </div>
                  <PeopleBadges
                    row={opened}
                    developers={developers}
                    onRemove={(id) =>
                      void changePeople(
                        opened,
                        peopleOf(opened).filter((personId) => personId !== id),
                      )
                    }
                  />
                </div>
                <div className="draft-body px-2 py-1.5">
                  {editing && draftView === 'markdown' ? (
                    <textarea
                      ref={(node) => {
                        editArea.current = node;
                        textRef.current = node;
                      }}
                      className="w-full resize-none bg-transparent text-xs leading-snug outline-none"
                      style={bodyStyle}
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                      onKeyDown={(event) => onMarkdownKey(event, editText, setEditText, 'edit')}
                      disabled={busy}
                    />
                  ) : editing ? (
                    <div
                      ref={(node) => {
                        previewRef.current = node;
                        textRef.current = node;
                      }}
                      className="markdown-body w-full text-xs leading-snug outline-none"
                      style={bodyStyle}
                      contentEditable={!busy}
                      suppressContentEditableWarning
                      onInput={() => {
                        if (!previewRef.current) return;
                        skipEdit.current = true;
                        setEditText(htmlToMarkdown(previewRef.current));
                      }}
                      onKeyDown={(event) => {
                        if (!handleRichHotkey(event.nativeEvent)) return;
                        if (!previewRef.current) return;
                        skipEdit.current = true;
                        setEditText(htmlToMarkdown(previewRef.current));
                      }}
                    />
                  ) : (
                    <div
                      ref={(node) => {
                        textRef.current = node;
                      }}
                      className="markdown-body w-full text-xs leading-snug"
                      style={bodyStyle}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(editText) }}
                    />
                  )}
                </div>
              </div>
              {after.length > 0 && (
                <div
                  className="flex shrink-0 flex-col gap-1 overflow-y-auto"
                  style={bodyLayout?.scroll ? { height: bodyLayout.rowH } : undefined}
                >
                  {after.map((row) => (
                    <CollapsedDraft
                      key={row.id}
                      row={row}
                      developers={developers}
                      menuOpen={peopleMenuId === row.id}
                      onOpen={() => toggleOpen(row)}
                      onToggleMenu={() =>
                        setPeopleMenuId((current) => (current === row.id ? null : row.id))
                      }
                      onCloseMenu={() => setPeopleMenuId(null)}
                      onChangePeople={(ids) => void changePeople(row, ids)}
                      onDelete={() => void removeDraft(row.id, row.title)}
                      onToggleFavorite={() => void toggleFavorite(row)}
                      onToggleDone={() => void toggleDone(row)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ModeSwitch(props: {
  value: 'preview' | 'markdown';
  onChange: (value: 'preview' | 'markdown') => void;
  className?: string;
}) {
  const item = (active: boolean) =>
    `inline-flex items-center justify-center ${active ? 'bg-slate-300 text-slate-700' : 'text-slate-500 hover:bg-slate-50'}`;
  return (
    <div className={`inline-flex h-6 overflow-hidden rounded-md border border-slate-300 ${props.className || ''}`}>
      <button type="button" title="Просмотр" className={`${item(props.value === 'preview')} h-full w-6`} onClick={() => props.onChange('preview')}>
        <EyeIcon className="h-3.5 w-3.5" />
      </button>
      <button type="button" title="Markdown" className={`${item(props.value === 'markdown')} h-full w-6`} onClick={() => props.onChange('markdown')}>
        <HashIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function PeopleBadges(props: {
  row: LocalDraft;
  developers: Developer[];
  onRemove: (id: number) => void;
}) {
  const people = peopleOf(props.row)
    .map((id) => props.developers.find((person) => person.id === id))
    .filter((person): person is Developer => Boolean(person));
  if (!people.length) return null;
  return (
    <div className="flex flex-wrap gap-1 px-2 pb-1">
      {people.map((person) => (
        <span
          key={person.id}
          className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500"
        >
          <span className="max-w-28 truncate">{person.displayName}</span>
          <button type="button" title="Убрать" className="text-slate-400 hover:text-slate-700" onClick={() => props.onRemove(person.id)}>
            <XIcon className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
    </div>
  );
}

function PeopleButton(props: {
  row: LocalDraft;
  developers: Developer[];
  menuOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (ids: number[]) => void;
}) {
  const attached = new Set(peopleOf(props.row));
  const choices = props.developers
    .filter((person) => !attached.has(person.id))
    .slice()
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'));
  return (
    <div className="relative shrink-0" data-people-menu>
      <button
        type="button"
        title="Прикрепить участников"
        className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
        onClick={props.onToggle}
      >
        <UsersIcon className="h-3.5 w-3.5" />
      </button>
      {props.menuOpen && (
        <div className="absolute right-0 top-7 z-30 max-h-40 w-44 overflow-auto rounded border border-slate-200 bg-white py-1 shadow-lg">
          {choices.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-slate-400">Никого нет</div>
          ) : (
            choices.map((person) => (
              <button
                key={person.id}
                type="button"
                className="block w-full truncate px-2 py-1 text-left text-[11px] hover:bg-slate-50"
                onClick={() => {
                  props.onChange([...peopleOf(props.row), person.id]);
                  props.onClose();
                }}
              >
                {person.displayName}
                {person.role === 'contact' ? <span className="ml-1 text-slate-400">контакт</span> : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DoneButton(props: { done: boolean; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={props.title}
      aria-pressed={props.done}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ${
        props.done ? 'text-emerald-600' : 'text-slate-300 hover:text-slate-400'
      }`}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick();
      }}
    >
      <CheckCircleIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function FavoriteButton(props: { active: boolean; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={props.title}
      aria-pressed={props.active}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ${
        props.active ? 'text-amber-500' : 'text-slate-300 hover:text-slate-400'
      }`}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick();
      }}
    >
      <StarIcon className="h-3.5 w-3.5" filled={props.active} />
    </button>
  );
}

function CollapsedDraft(props: {
  row: LocalDraft;
  developers: Developer[];
  menuOpen: boolean;
  onOpen: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onChangePeople: (ids: number[]) => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  onToggleDone: () => void;
}) {
  const when = new Date(props.row.createdAt).toLocaleDateString('ru-RU');
  return (
    <div data-draft-collapsed className="shrink-0 rounded border border-slate-200 bg-slate-50 text-xs transition-colors hover:bg-slate-100">
      <div className="flex h-8 items-center gap-1 px-2">
        <FavoriteButton
          active={props.row.favorite}
          title={props.row.favorite ? 'Избранное' : 'В избранное'}
          onClick={props.onToggleFavorite}
        />
        <DoneButton
          done={props.row.done}
          title="В готовые"
          onClick={props.onToggleDone}
        />
        <button type="button" className="min-w-0 flex-1 truncate text-left font-medium text-slate-900" onClick={props.onOpen}>
          {plainTitle(props.row.title) || 'Без заголовка'}
        </button>
        <PeopleButton
          row={props.row}
          developers={props.developers}
          menuOpen={props.menuOpen}
          onToggle={props.onToggleMenu}
          onClose={props.onCloseMenu}
          onChange={props.onChangePeople}
        />
        <button type="button" className="shrink-0 text-[10px] text-slate-400" onClick={props.onOpen}>
          {when}
        </button>
        <button
          type="button"
          title="Удалить"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-red-300 bg-white text-red-600 hover:border-red-400 hover:bg-red-50"
          onClick={props.onDelete}
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </div>
      <PeopleBadges
        row={props.row}
        developers={props.developers}
        onRemove={(id) => props.onChangePeople(peopleOf(props.row).filter((personId) => personId !== id))}
      />
    </div>
  );
}
