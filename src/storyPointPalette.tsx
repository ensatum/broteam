import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_STORY_POINT_COLORS,
  defaultStoryPointCopy,
  type StoryPointColors,
  type StoryPointCopy,
} from '@shared/storyPoints';

type PaletteValue = { colors: StoryPointColors; copy: StoryPointCopy };

type Palette = PaletteValue & {
  save: (next: PaletteValue) => Promise<PaletteValue>;
};

const PaletteContext = createContext<Palette>({
  colors: DEFAULT_STORY_POINT_COLORS,
  copy: defaultStoryPointCopy(),
  save: async (next) => next,
});

export function StoryPointPaletteProvider(props: { children: ReactNode }) {
  const [colors, setColors] = useState<StoryPointColors>(DEFAULT_STORY_POINT_COLORS);
  const [copy, setCopy] = useState<StoryPointCopy>(defaultStoryPointCopy);
  useEffect(() => {
    void window.api
      .getStoryPointPalette()
      .then((stored) => {
        setColors(stored.colors);
        setCopy(stored.copy);
      })
      .catch(() => {});
  }, []);
  const save = useCallback(async (next: PaletteValue) => {
    const stored = await window.api.saveStoryPointPalette(next);
    setColors(stored.colors);
    setCopy(stored.copy);
    return stored;
  }, []);
  const value = useMemo(() => ({ colors, copy, save }), [colors, copy, save]);
  return <PaletteContext.Provider value={value}>{props.children}</PaletteContext.Provider>;
}

export function useStoryPointColors(): StoryPointColors {
  return useContext(PaletteContext).colors;
}

export function useStoryPointCopy(): StoryPointCopy {
  return useContext(PaletteContext).copy;
}

export function useStoryPointPalette(): PaletteValue {
  const { colors, copy } = useContext(PaletteContext);
  return useMemo(() => ({ colors, copy }), [colors, copy]);
}

export function useSaveStoryPointPalette(): Palette['save'] {
  return useContext(PaletteContext).save;
}
