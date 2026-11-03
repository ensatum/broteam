export default function WorkVeil(props: { show: boolean; requests: number }) {
  if (!props.show) return null;
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-white/35">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
      <div className="mt-2 text-[11px] font-medium text-sky-800">Запросов: {props.requests}</div>
    </div>
  );
}
