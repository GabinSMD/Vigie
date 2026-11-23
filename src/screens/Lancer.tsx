import { useId, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { findProject, projects } from '../data/mock';
import { ROLES, remainingSessions, useStore, type Role } from '../data/store';
import { plural } from '../lib/format';

type Mode = 'issue' | 'texte';

const DEFAULT_PROJECT = 'ecole-saas';

/** Lancer une session : depuis une issue en file, ou avec une consigne libre. */
export function Lancer() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { state, dispatch } = useStore();
  const textId = useId();

  /* ?projet=ecole-saas&issue=450 : arrivée depuis l'onglet Issues d'un projet. */
  const initialProject = findProject(params.get('projet') ?? undefined) ?? findProject(DEFAULT_PROJECT)!;
  const askedIssue = params.get('issue');
  const initialIssue =
    initialProject.issues.find((i) => i.number === `#${askedIssue}`)?.number ?? initialProject.issues[0]?.number ?? null;

  const [mode, setMode] = useState<Mode>('issue');
  const [projectId, setProjectId] = useState(initialProject.id);
  const [issue, setIssue] = useState<string | null>(initialIssue);
  const [role, setRole] = useState<Role>('Développeur');
  const [text, setText] = useState('');

  const project = findProject(projectId)!;
  const remaining = remainingSessions(state);
  const { sessionCap } = state.settings;

  const pickProject = (id: string) => {
    setProjectId(id);
    setIssue(findProject(id)?.issues[0]?.number ?? null);
  };

  const launch = () => {
    if (remaining === 0) return;
    let what: string;
    if (mode === 'issue') {
      if (!issue) {
        dispatch({ type: 'notify', message: 'Choisis une issue, ou passe en texte libre.' });
        return;
      }
      const title = project.issues.find((i) => i.number === issue)?.title;
      what = title ? `Issue ${issue} : ${title}` : `Issue ${issue}`;
    } else {
      const trimmed = text.trim();
      if (!trimmed) {
        dispatch({ type: 'notify', message: 'Écris une consigne ou dicte-la avant de lancer.' });
        return;
      }
      what = trimmed.slice(0, 80);
    }
    dispatch({ type: 'launch', session: { projectId, role, what } });
    navigate('/');
  };

  return (
    <>
      <header className="head">
        <h1 className="h1">Lancer du travail</h1>
      </header>
      <div style={{ padding: '0 16px 12px' }}>
        <div className="seg" role="group" aria-label="Point de départ">
          <button type="button" aria-pressed={mode === 'issue'} onClick={() => setMode('issue')}>
            Depuis une issue
          </button>
          <button type="button" aria-pressed={mode === 'texte'} onClick={() => setMode('texte')}>
            Texte libre
          </button>
        </div>
      </div>

      <div className="body" style={{ gap: 16 }}>
        <fieldset>
          <legend className="k">Projet</legend>
          <div className="chips">
            {projects.map((p) => (
              <button key={p.id} type="button" className="chip" aria-pressed={p.id === projectId} onClick={() => pickProject(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        </fieldset>

        {mode === 'issue' ? (
          <fieldset>
            <legend className="k">Issue</legend>
            {project.issues.length === 0 ? (
              <p className="det">Pas d'issue en file pour {project.name} dans la démo. Passe en texte libre pour lancer une session.</p>
            ) : (
              <div className="list">
                {project.issues.map((i) => {
                  const on = i.number === issue;
                  return (
                    <button key={i.number} type="button" className="li" aria-pressed={on} onClick={() => setIssue(i.number)}>
                      <span className="pill p-neu code">{i.number}</span>
                      <span className="t grow" style={{ fontSize: 16 }}>
                        {i.title}
                      </span>
                      {on && <Icon name="check" />}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="k" htmlFor={textId}>
              Consigne pour la session
            </label>
            <textarea id={textId} className="field" value={text} onChange={(e) => setText(e.target.value)} />
            <p className="det">Ne colle jamais de clé ni de jeton dans la consigne.</p>
            <button
              type="button"
              className="btn full"
              style={{ minHeight: 56 }}
              onClick={() => dispatch({ type: 'notify', message: 'La dictée arrive bientôt : écris la consigne pour l’instant.' })}
            >
              <Icon name="mic" className="" />
              Dicter la consigne
            </button>
          </div>
        )}

        <fieldset>
          <legend className="k">Rôle</legend>
          <div className="chips">
            {ROLES.map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={r === role} onClick={() => setRole(r)}>
                {r}
              </button>
            ))}
          </div>
        </fieldset>

        {remaining > 0 ? (
          <div className="guard att">
            <Icon name="warning" />
            <div>
              <b>Plafond du jour : {plural(remaining, 'session restante', 'sessions restantes')}</b>
              <span className="det strong-ink">
                {state.sessionsToday} sessions lancées sur {sessionCap} permises aujourd'hui.
              </span>
            </div>
          </div>
        ) : (
          <div className="guard blk">
            <Icon name="blocked" />
            <div>
              <b>
                Plafond atteint : {state.sessionsToday} sur {sessionCap}
              </b>
              <span className="det strong-ink">
                <Link to="/reglages">Augmente le plafond dans les réglages</Link> pour lancer une session.
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="footer-actions">
        <button type="button" className="btn pri big full" disabled={remaining === 0} onClick={launch}>
          Lancer la session
        </button>
      </div>
    </>
  );
}
