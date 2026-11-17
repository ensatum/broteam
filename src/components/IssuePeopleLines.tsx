import type { Developer, TrackerIssue } from '@shared/types';
import { issueRoleLabel, type IssueRole } from '@shared/rolePick';
import { RolePick } from './RolePick';

export default function IssuePeopleLines(props: {
  issue: TrackerIssue;
  people?: Developer[];
  disabled?: boolean;
  busy?: boolean;
  onChange?: (role: IssueRole, person: Developer | null) => void;
}) {
  const { issue } = props;
  return (
    <div className="mt-0.5 space-y-0 text-[10px] leading-snug">
      <RoleLine
        role="assignee"
        name={issue.assigneeDisplay}
        people={props.people || []}
        disabled={props.disabled || !props.onChange}
        busy={props.busy}
        onChange={(person) => props.onChange?.('assignee', person)}
      />
      <RoleLine
        role="reviewer"
        name={issue.reviewerDisplay}
        filledClass="text-green-600"
        people={props.people || []}
        disabled={props.disabled || !props.onChange}
        busy={props.busy}
        onChange={(person) => props.onChange?.('reviewer', person)}
      />
      <RoleLine
        role="qa"
        name={issue.qaDisplay}
        filledClass="text-green-600"
        people={props.people || []}
        disabled={props.disabled || !props.onChange}
        busy={props.busy}
        onChange={(person) => props.onChange?.('qa', person)}
      />
      <div className="text-slate-400">Автор: {issue.authorDisplay?.trim() || '—'}</div>
    </div>
  );
}

function RoleLine(props: {
  role: IssueRole;
  name?: string | null;
  filledClass?: string;
  people: Developer[];
  disabled?: boolean;
  busy?: boolean;
  onChange: (person: Developer | null) => void;
}) {
  const label = issueRoleLabel(props.role);
  const value = (props.name || '').trim();
  return (
    <RolePick
      role={props.role}
      current={value}
      people={props.people}
      disabled={props.disabled}
      busy={props.busy}
      className={`block w-full ${value ? props.filledClass || 'text-slate-400' : 'text-red-600'}`}
      onChange={props.onChange}
    >
      {value ? (
        <span>
          {label}: {value}
        </span>
      ) : (
        <span className="line-through">{label}</span>
      )}
    </RolePick>
  );
}
