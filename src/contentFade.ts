type Phase = 'idle' | 'dim' | 'out' | 'hold' | 'in';

const hosts: { table: HTMLElement | null; list: HTMLElement | null; spinner: HTMLElement | null } = {
  table: null,
  list: null,
  spinner: null,
};

let phase: Phase = 'idle';
let spinnerOn = false;
let token = 0;
let queued: (() => void) | null = null;
let job: Promise<void> | null = null;

const PHASE = ['bro-dim', 'bro-out', 'bro-hold', 'bro-in'] as const;

function paintHost(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove(...PHASE);
  if (phase !== 'idle') el.classList.add(`bro-${phase}`);
}

function paintSpinner() {
  const el = hosts.spinner;
  if (!el) return;
  const show = spinnerOn && phase !== 'idle' && phase !== 'in';
  el.classList.toggle('hidden', !show);
  el.classList.toggle('flex', show);
}

function paint() {
  paintHost(hosts.table);
  paintHost(hosts.list);
  paintSpinner();
}

export function attachFadeHost(which: 'table' | 'list' | 'spinner', node: HTMLElement | null) {
  hosts[which] = node;
  paint();
}

export function reapplyFade() {
  paint();
}

function holdAfter(ms: number, my: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (token !== my) return;
      phase = 'hold';
      paint();
      resolve();
    }, ms);
  });
}

export function startContentFade(spinner: boolean): Promise<void> {
  if (spinner) spinnerOn = true;
  if (job && (phase === 'dim' || phase === 'out' || phase === 'hold')) {
    paint();
    return job;
  }
  const my = ++token;
  phase = 'dim';
  paint();
  job = new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (token !== my) return;
        phase = 'out';
        paint();
        void holdAfter(200, my).then(() => {
          if (token !== my) return;
          job = null;
          resolve();
        });
      });
    });
  });
  return job;
}

export function revealContentFade() {
  const my = ++token;
  phase = 'hold';
  spinnerOn = false;
  paint();
  requestAnimationFrame(() => {
    if (token !== my) return;
    phase = 'in';
    paint();
    window.setTimeout(() => {
      if (token !== my) return;
      phase = 'idle';
      paint();
    }, 200);
  });
}

export function fadeThen(apply: () => void) {
  queued = apply;
  if (job && (phase === 'dim' || phase === 'out' || phase === 'hold')) return;
  void startContentFade(false).then(() => {
    const fn = queued;
    queued = null;
    fn?.();
    window.setTimeout(() => revealContentFade(), 0);
  });
}

export function setApiCount(total: number) {
  const node = document.getElementById('bro-api-count');
  if (node) node.textContent = `Запросов к API: ${total}`;
}
