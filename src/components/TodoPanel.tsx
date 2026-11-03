import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Developer, DeveloperTodo } from '@shared/types';
import { IconActionButton, NoteIcon } from './Icons';

type Props = {
  width: number;
  developerId: number;
  developerName: string;
  todos: DeveloperTodo[];
  developers: Developer[];
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onError: (msg: string | null) => void;
  embedded?: boolean;
};

type EditorState = {
  mode: 'create' | 'edit';
  todoId: number | null;
  title: string;
  body: string;
  assigneeId: number;
  anchor: { top: number; left: number };
};

export default function TodoPanel(props: Props) {
  const { width, developerId, developerName, todos, developers, readOnly } = props;
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditor(null);
  }, [developerId]);

  useEffect(() => {
    if (!editor) return;
    const onDoc = () => setEditor(null);
    window.addEventListener('click', onDoc);
    return () => window.removeEventListener('click', onDoc);
  }, [editor]);

  function openCreate(e: MouseEvent) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setEditor({
      mode: 'create',
      todoId: null,
      title: '',
      body: '',
      assigneeId: developerId,
      anchor: { top: r.bottom + 4, left: Math.max(8, r.right - 420) },
    });
  }

  function openEdit(e: MouseEvent, todo: DeveloperTodo) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setEditor({
      mode: 'edit',
      todoId: todo.id,
      title: todo.title,
      body: todo.body,
      assigneeId: todo.developerId,
      anchor: { top: r.bottom + 4, left: Math.max(8, r.right - 420) },
    });
  }

  async function saveEditor() {
    if (!editor) return;
    if (!editor.title.trim() && !editor.body.trim()) {
      props.onError('Укажите заголовок или текст задумки');
      return;
    }
    setBusy(true);
    props.onError(null);
    try {
      if (editor.mode === 'create') {
        await window.api.createDeveloperTodo(editor.assigneeId, editor.title, editor.body);
      } else if (editor.todoId != null) {
        await window.api.updateDeveloperTodo(editor.todoId, {
          title: editor.title,
          body: editor.body,
          developerId: editor.assigneeId,
        });
      }
      setEditor(null);
      await props.onChanged();
    } catch (e) {
      props.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeTodo(todo: DeveloperTodo) {
    const ok = window.confirm(
      `Удалить задумку «${todo.title.trim() || 'без заголовка'}»?`,
    );
    if (!ok) return;
    setBusy(true);
    props.onError(null);
    try {
      await window.api.deleteDeveloperTodo(todo.id);
      if (editor?.todoId === todo.id) setEditor(null);
      await props.onChanged();
    } catch (e) {
      props.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      style={props.embedded ? undefined : { width }}
      className={
        props.embedded
          ? 'flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-white'
          : 'flex min-h-0 max-h-full w-full flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white'
      }
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-3 py-2 shrink-0">
        <div>
          <div className="font-semibold text-sm">{developerName}</div>
          <div className="text-[11px] text-slate-500">TODO · {todos.length}</div>
        </div>
        <button className="text-xs text-slate-500 hover:text-slate-800" onClick={props.onClose}>
          Закрыть
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-2 text-xs">
        {!readOnly && (
          <button
            type="button"
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            disabled={busy}
            onClick={openCreate}
          >
            Добавить
          </button>
        )}

        {todos.length === 0 ? (
          <div className="text-slate-500">Нет задумок</div>
        ) : (
          todos.map((todo) => (
            <div key={todo.id} className="rounded-md border border-slate-200 px-2 py-1.5">
              <div className="flex items-start gap-1.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 text-[12px]">
                    {todo.title.trim() || (
                      <span className="text-slate-400 font-normal">Без заголовка</span>
                    )}
                  </div>
                  {todo.body.trim() && (
                    <div className="mt-0.5 whitespace-pre-wrap text-[11px] text-slate-600">
                      {todo.body}
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-slate-400">
                    создан {new Date(todo.createdAt).toLocaleString('ru-RU')}
                    {' · '}
                    изменён {new Date(todo.updatedAt).toLocaleString('ru-RU')}
                  </div>
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-0 shrink-0">
                    <IconActionButton
                      tone="muted"
                      title="Редактировать"
                      onClick={(e) => openEdit(e, todo)}
                    >
                      <NoteIcon />
                    </IconActionButton>
                    <button
                      type="button"
                      title="Удалить"
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-red-500 hover:text-red-700 text-xs"
                      onClick={() => void removeTodo(todo)}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {editor && (
        <TodoEditorPopup
          title={editor.mode === 'create' ? 'Новая задумка' : 'Редактирование задумки'}
          pos={editor.anchor}
          draftTitle={editor.title}
          draftBody={editor.body}
          assigneeId={editor.assigneeId}
          developers={developers}
          busy={busy}
          onTitleChange={(v) => setEditor({ ...editor, title: v })}
          onBodyChange={(v) => setEditor({ ...editor, body: v })}
          onAssigneeChange={(id) => setEditor({ ...editor, assigneeId: id })}
          onSave={() => void saveEditor()}
          onClose={() => setEditor(null)}
        />
      )}
    </aside>
  );
}

function TodoEditorPopup(props: {
  title: string;
  pos: { top: number; left: number };
  draftTitle: string;
  draftBody: string;
  assigneeId: number;
  developers: Developer[];
  busy: boolean;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onAssigneeChange: (id: number) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(props.pos);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = props.pos.left;
    let top = props.pos.top;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, props.pos.top - rect.height - 8);
    }
    if (left < 8) left = 8;
    setPos({ top, left });
  }, [props.pos]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] w-[420px] max-w-[calc(100vw-16px)] rounded-lg border border-slate-300 bg-white p-2 shadow-xl"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 text-[11px] font-semibold text-slate-700">{props.title}</div>
      <input
        className="mb-1.5 w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
        placeholder="Заголовок"
        value={props.draftTitle}
        onChange={(e) => props.onTitleChange(e.target.value)}
        disabled={props.busy}
        autoFocus
      />
      <textarea
        className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs min-h-[96px]"
        placeholder="Текст"
        value={props.draftBody}
        onChange={(e) => props.onBodyChange(e.target.value)}
        disabled={props.busy}
      />
      <label className="mt-1.5 block text-[10px] text-slate-500">
        Назначить
        <select
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
          value={props.assigneeId}
          onChange={(e) => props.onAssigneeChange(Number(e.target.value))}
          disabled={props.busy}
        >
          {props.developers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.displayName}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-2.5 py-1 text-[11px]"
          onClick={props.onClose}
          disabled={props.busy}
        >
          Отмена
        </button>
        <button
          type="button"
          className="rounded bg-slate-900 px-2.5 py-1 text-[11px] text-white disabled:opacity-50"
          onClick={props.onSave}
          disabled={props.busy}
        >
          Сохранить
        </button>
      </div>
    </div>,
    document.body,
  );
}
