import { useEffect, useState } from 'react';

export type IssueStoryText = {
  description: string;
  commentText: string;
  commentUrl: string;
  commentAuthor: string;
  commentAt: string;
};

const cache = new Map<string, IssueStoryText>();
const listeners = new Set<() => void>();
let revision = 0;

export function readIssueStory(issueKey: string): IssueStoryText | null {
  return cache.get(issueKey) ?? null;
}

export function writeIssueStory(issueKey: string, story: IssueStoryText) {
  cache.set(issueKey, story);
}

export function invalidateIssueStories(issueKey?: string) {
  if (issueKey) cache.delete(issueKey);
  else cache.clear();
  revision += 1;
  listeners.forEach((listener) => listener());
}

export function useIssueStoryRevision(): number {
  const [rev, setRev] = useState(revision);
  useEffect(() => {
    const update = () => setRev(revision);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return rev;
}
