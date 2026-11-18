import { useEffect, useRef, useState } from 'react';
import { writeIssueStory } from '../issueStoryCache';
import { CheckSquareIcon, XIcon } from './Icons';
import { InstantTip } from './InstantTip';
import { MarkdownSurface, type MarkdownHandle } from './MarkdownSurface';

export function QuickComment(props: { issueKey: string }) {
  const surface = useRef<MarkdownHandle>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setOpen(false);
    setDraft('');
    setError('');
    setBusy(false);
  }, [props.issueKey]);

  async function send() {
    const text = (surface.current?.read() ?? draft).trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    try {
      const story = await window.api.addIssueComment(props.issueKey, text);
      writeIssueStory(props.issueKey, story);
      setDraft('');
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (busy) return;
    setDraft('');
    setError('');
    setOpen(false);
  }

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <div className="mt-1.5 flex justify-end">
        <button
          type="button"
          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50"
          onClick={() => {
            setError('');
            setOpen(true);
          }}
        >
          Быстрый комментарий
        </button>
      </div>
      {open && (
        <div className="mt-1.5">
          <div className="mb-1 text-[11px] font-medium text-slate-700">Комментарий на трекер</div>
          <MarkdownSurface
            ref={surface}
            draft={draft}
            onDraft={setDraft}
            resetKey={open}
            minRows={3}
            placeholder="Текст комментария"
            leading={
              <div className="flex flex-col overflow-hidden rounded-md border border-slate-300">
                <InstantTip text="Отправить" className="flex">
                  <button
                    type="button"
                    disabled={busy || !draft.trim()}
                    className="inline-flex h-6 w-6 items-center justify-center bg-emerald-600 text-white hover:bg-emerald-700 disabled:cursor-default disabled:bg-emerald-300"
                    onClick={() => void send()}
                  >
                    <CheckSquareIcon className="h-3.5 w-3.5" />
                  </button>
                </InstantTip>
                <InstantTip text="Отменить" className="flex">
                  <button
                    type="button"
                    disabled={busy}
                    className="inline-flex h-6 w-6 items-center justify-center bg-red-600 text-white hover:bg-red-700 disabled:cursor-default disabled:bg-red-300"
                    onClick={cancel}
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </InstantTip>
              </div>
            }
          />
          {error && <div className="mt-1 text-[10px] text-red-700">{error}</div>}
        </div>
      )}
    </div>
  );
}
