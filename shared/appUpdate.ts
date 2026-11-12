export type AppUpdatePhase = 'version' | 'size' | 'download' | 'install';

export type AppUpdateProgress = {
  phase: AppUpdatePhase;
  message: string;
  received: number;
  total: number;
};
