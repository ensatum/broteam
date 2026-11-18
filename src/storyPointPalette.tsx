import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_STORY_POINT_COLORS, type StoryPointColors } from '@shared/storyPoints';

type Palette = {
  colors: StoryPointColors;
  save: (colors: StoryPointColors) => Promise<void>;
};

const PaletteContext = createContext<Palette>({
  colors: DEFAULT_STORY_POINT_COLORS,
  save: async () => {},
});

export function StoryPointPaletteProvider(props: { children: ReactNode }) {
  const [colors, setColors] = useState<StoryPointColors>(DEFAULT_STORY_POINT_COLORS);
  useEffect(() => {
    void window.api.getStoryPointColors().then(setColors).catch(() => {});
  }, []);
  const save = useCallback(async (next: StoryPointColors) => {
    setColors(await window.api.saveStoryPointColors(next));
  }, []);
  const value = useMemo(() => ({ colors, save }), [colors, save]);
  return <PaletteContext.Provider value={value}>{props.children}</PaletteContext.Provider>;
}

export function useStoryPointColors(): StoryPointColors {
  return useContext(PaletteContext).colors;
}

export function useSaveStoryPointColors(): Palette['save'] {
  return useContext(PaletteContext).save;
}
