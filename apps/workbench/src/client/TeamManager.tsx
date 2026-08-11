import { useState } from 'react';
import { Bot, Plus, ShieldCheck, Trash2, UserRound, UsersRound } from 'lucide-react';
import type { ActorIdentityView, PackDescription } from './types.js';

interface TeamManagerProps {
  actors: ActorIdentityView[];
  currentActor: ActorIdentityView;
  roles: PackDescription['manifest']['roles'];
  busy: boolean;
  onActivate(actorId: string): void;
  onSave(actor: ActorIdentityView): void;
  onRemove(actorId: string): void;
}

function ActorEditor({ actor, roles, busy, onSave }: {
  actor?: ActorIdentityView;
  roles: TeamManagerProps['roles'];
  busy: boolean;
  onSave(actor: ActorIdentityView): void;
}) {
  const [id, setId] = useState(actor?.id ?? '');
  const [displayName, setDisplayName] = useState(actor?.displayName ?? '');
  const [kind, setKind] = useState<ActorIdentityView['kind']>(actor?.kind ?? 'human');
  const [workspaceRole, setWorkspaceRole] = useState<ActorIdentityView['workspaceRole']>(actor?.workspaceRole ?? 'member');
  const [roleIds, setRoleIds] = useState<string[]>(actor?.roleIds ?? []);
  const valid = id.trim() && displayName.trim();

  const toggleRole = (roleId: string) => {
    setRoleIds((current) => current.includes(roleId)
      ? current.filter((item) => item !== roleId)
      : [...current, roleId]);
  };

  return <section className="team-editor">
    <header><span><strong>{actor ? 'Edit identity' : 'Add identity'}</strong><small>Workspace access and Pack responsibilities</small></span><ShieldCheck size={18} /></header>
    <div className="team-form">
      <label><span>Identity ID</span><input value={id} disabled={Boolean(actor)} placeholder="team.member" onChange={(event) => setId(event.target.value)} /></label>
      <label><span>Display name</span><input value={displayName} placeholder="Team member" onChange={(event) => setDisplayName(event.target.value)} /></label>
      <div className="team-form-row">
        <label><span>Identity kind</span><select value={kind} onChange={(event) => setKind(event.target.value as ActorIdentityView['kind'])}><option value="human">Human</option><option value="service">Service</option><option value="agent">Agent</option></select></label>
        <label><span>Workspace role</span><select value={workspaceRole} onChange={(event) => setWorkspaceRole(event.target.value as ActorIdentityView['workspaceRole'])}><option value="member">Member</option><option value="owner">Owner</option><option value="service">Service</option></select></label>
      </div>
      <fieldset><legend>Pack responsibilities</legend>{roles.length ? <div className="role-options">{roles.map((role) => <label key={role.id}><input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => toggleRole(role.id)} /><span><strong>{role.label}</strong><small>{role.id}</small></span></label>)}</div> : <p>This Pack does not declare approval roles.</p>}</fieldset>
      <button className="button primary" disabled={busy || !valid} onClick={() => onSave({ id: id.trim(), displayName: displayName.trim(), kind, workspaceRole, roleIds })}><ShieldCheck size={15} />Save identity</button>
    </div>
  </section>;
}

export function TeamManager({ actors, currentActor, roles, busy, onActivate, onSave, onRemove }: TeamManagerProps) {
  const [selectedId, setSelectedId] = useState(currentActor.id);
  const selected = actors.find((actor) => actor.id === selectedId);
  const owner = currentActor.workspaceRole === 'owner';

  return <div className="team-view">
    <aside className="team-list">
      <header><span><strong>Workspace identities</strong><small>{actors.length} configured</small></span>{owner ? <button className="icon-control" aria-label="Add identity" onClick={() => setSelectedId('__new__')}><Plus size={16} /></button> : null}</header>
      {actors.map((actor) => <button key={actor.id} className={selected?.id === actor.id ? 'selected' : ''} onClick={() => setSelectedId(actor.id)}>
        <span className="team-avatar">{actor.kind === 'human' ? <UserRound size={16} /> : <Bot size={16} />}</span>
        <span><strong>{actor.displayName}</strong><small>{actor.workspaceRole} · {actor.roleIds.length} Pack role{actor.roleIds.length === 1 ? '' : 's'}</small></span>
        {actor.id === currentActor.id ? <em>Active</em> : null}
      </button>)}
    </aside>
    <main className="team-detail">
      <div className="view-heading"><span className="view-symbol"><UsersRound size={21} /></span><span><strong>Team identities</strong><small>Attribute approvals and tool decisions to the people, services, and agents responsible for them.</small></span></div>
      {selected ? <div className="team-actions">
        <button className="button secondary" disabled={busy || selected.id === currentActor.id} onClick={() => onActivate(selected.id)}><UserRound size={15} />Use this identity</button>
        {owner && selected.id !== currentActor.id ? <button className="button ghost danger" disabled={busy} onClick={() => onRemove(selected.id)}><Trash2 size={15} />Remove</button> : null}
      </div> : null}
      {owner ? <ActorEditor key={selected?.id ?? '__new__'} {...(selected ? { actor: selected } : {})} roles={roles} busy={busy} onSave={onSave} /> : <section className="team-readonly"><ShieldCheck size={22} /><strong>Owner access required</strong><p>You can switch identities, but only a workspace owner can change the team directory.</p></section>}
    </main>
  </div>;
}
