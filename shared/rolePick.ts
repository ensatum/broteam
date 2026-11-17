import type { Developer, ParticipantRole } from './types';

export type IssueRole = 'assignee' | 'reviewer' | 'qa';

export function issueRoleLabel(role: IssueRole): string {
  if (role === 'assignee') return 'Исполнитель';
  if (role === 'reviewer') return 'Ревьюер';
  return 'Тестировщик';
}

/** Assignee and reviewer offer developers first. Tester offers testers first. */
export function issueRoleBucket(role: IssueRole): ParticipantRole {
  return role === 'qa' ? 'qa' : 'developer';
}

export function trackerUserRef(person: Developer): string | null {
  const login = person.login.trim();
  if (login) return login;
  const uid = person.uid.trim();
  return uid || null;
}

export function roleIsSet(name: string | null | undefined): boolean {
  const value = (name || '').trim();
  return Boolean(value && value !== '—' && value !== '-');
}

export function personHoldsRole(person: Developer, current: string | null | undefined): boolean {
  const name = (current || '').trim();
  if (!roleIsSet(name)) return false;
  if (person.displayName.trim() === name) return true;
  return Boolean(person.login.trim()) && person.login.trim() === name;
}

export function splitRolePeople(people: Developer[], role: IssueRole): { primary: Developer[]; rest: Developer[] } {
  const bucket = issueRoleBucket(role);
  const list = people
    .filter((person) => person.id > 0 && trackerUserRef(person))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName, 'ru'));
  return {
    primary: list.filter((person) => person.role === bucket),
    rest: list.filter((person) => person.role !== bucket),
  };
}
