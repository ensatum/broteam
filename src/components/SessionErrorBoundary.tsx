import { Component, type ReactNode } from 'react';
import { sessionLog } from '../sessionLog';

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class SessionErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    sessionLog('error', 'react render', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-4 rounded-xl border border-red-200 bg-white p-4 text-sm text-slate-800">
        <h1 className="text-base font-semibold text-red-800">Ошибка отрисовки</h1>
        <p className="mt-1 text-slate-600">
          Окно не закрылось. Текст ошибки записан в короткий лог сессии.
        </p>
        <pre className="mt-3 max-h-[50vh] overflow-auto whitespace-pre-wrap text-xs text-slate-700">
          {this.state.error.stack || this.state.error.message}
        </pre>
      </div>
    );
  }
}
