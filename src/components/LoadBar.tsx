export function LoadBar(props: { label: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] text-slate-500">{props.label}</div>
      <div className="h-1 overflow-hidden rounded bg-slate-200">
        <div className="bro-load-bar h-full w-1/3 rounded bg-sky-500" />
      </div>
    </div>
  );
}
