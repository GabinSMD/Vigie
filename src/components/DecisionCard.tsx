import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Decision, DecisionOption } from '../data/api';
import {
  isOneTap,
  oneTapLabels,
  optionLabel,
  orderedOptions,
  type DecisionItem,
  type DecisionView,
} from '../data/decisionState';
import { SECRET_WARNING, TEXT_MAX } from '../data/ordre';
import { useAnswerSender } from '../data/ordres';
import { looksLikeSecret } from '../data/secrets';
import { useData } from '../data/source';
import { useStore, viewOf } from '../data/store';
import { clockFr, dateTimeFr, nextPilotPassFr } from '../lib/format';
import { ConfirmAnswerSheet } from '../sheets/ConfirmAnswerSheet';
import { ActionButton } from './ActionButton';
import { Icon } from './Icon';
import { StatusPill } from './StatusPill';

export { isDecision, type DecisionItem } from '../data/decisionState';

/** Avertissement permanent sous chaque champ texte (§ 7), partagé avec le refus 422 du Worker. */
export { SECRET_WARNING } from '../data/ordre';

/** Envoi : `true` si la réponse est partie (ou refusée par le Worker), sinon le message d'erreur à afficher. */
type Send = (optionId: string, text?: string, extra?: { message?: string; undoable?: boolean }) => Promise<true | string>;

interface Props {
  item: DecisionItem;
  /** Le bouton principal de la carte est plein (un seul par écran). */
  primary?: boolean;
  /** Hors ligne : actions désactivées. */
  disabled?: boolean;
  /** Sur la page d'un projet, le nom du projet est inutile. */
  showProject?: boolean;
  /** « À faire par toi » : au-delà de 3 options, seule la recommandée est montrée d'abord (§ 3.2). */
  compact?: boolean;
}

const KIND_LABEL: Record<Decision['kind'], string> = { choix: 'Décision', action: 'Action', validation: 'Livrable' };

function pill(d: Decision, view: DecisionView) {
  switch (view.phase) {
    case 'attente':
      return <StatusPill status="attention" label={d.blocking ? "Bloque l'agent" : 'Attend toi'} />;
    case 'envoyee':
      return <StatusPill status="neutre" glyph="sent" label="Envoyée" />;
    case 'repondu':
      return <StatusPill status="ok" label="Répondu" />;
    case 'expiree':
      return <StatusPill status="bloque" label="Pas partie" />;
    case 'refusee':
      return <StatusPill status="bloque" label="Refusée" />;
  }
}

/**
 * Carte « En attente de ta réponse » (docs/specs/en-attente-de-reponse.md § 3.2 et § 3.3),
 * partagée par « À faire par toi » et l'onglet Sessions d'un projet. En données réelles, la réponse
 * part vers `POST /api/ordres` ; en données fictives, elle reste locale (store).
 */
export function DecisionCard({ item, primary, disabled, showProject = true, compact }: Props) {
  const d = item.decision;
  const { state, dispatch } = useStore();
  const { live, findProject } = useData();
  const sender = useAnswerSender();
  const project = findProject(item.projectId);
  const view = viewOf(state, item);
  const titleId = useId();
  /* Réponse déjà partie que tu reprends (« Modifier », « Répondre à nouveau »). */
  const [editing, setEditing] = useState<{ optionId?: string; text?: string } | null>(null);
  const pri = primary ? 'btn pri' : 'btn';
  const where = showProject ? `${project?.name ?? item.projectId} · ` : '';
  const showForm = view.phase === 'attente' || editing !== null;

  const send: Send = async (optionId, text, extra = {}) => {
    /* « Modifier » : la réponse envoyée avant attend encore le pilote et reste valable si la nouvelle est refusée. */
    const keepPrevious = view.phase === 'envoyee' && view.editable;
    if (!live) {
      dispatch({ type: 'answer', itemId: item.id, optionId, text, ...extra });
    } else if (extra.undoable) {
      /* Oui/non en un tap (D13) : l'ordre ne part qu'à la fin des 5 s d'annulation. */
      sender.later(item, optionId, extra.message ?? 'Réponse envoyée.', keepPrevious);
    } else {
      const result = await sender.now(item, optionId, text, extra.message, keepPrevious);
      if (result.kind === 'error') return result.message;
    }
    setEditing(null);
    return true;
  };

  /* « Renvoyer » : l'erreur éventuelle est annoncée par le toast. */
  const [resending, setResending] = useState(false);
  const resend = async (a: NonNullable<DecisionView['answer']>) => {
    setResending(true);
    const result = await send(a.optionId, a.text, { message: 'Réponse renvoyée.' });
    setResending(false);
    if (result !== true) dispatch({ type: 'notify', message: result });
  };

  /* La réponse déjà partie reste valable tant que tu n'en envoies pas une autre. */
  const edit = () => setEditing({ optionId: view.answer?.optionId, text: view.answer?.text });

  return (
    <article className={d.blocking && view.phase === 'attente' ? 'ar dec urgent' : 'ar dec'} aria-labelledby={titleId}>
      <div className="row sp">
        <span className="k">
          {where}
          {KIND_LABEL[d.kind]}
        </span>
        {pill(d, editing ? { phase: 'attente', editable: false } : view)}
      </div>
      <h3 className="t" id={titleId}>
        {d.question}
      </h3>
      {d.context.map((line) => (
        <p key={line} className="det">
          {line}
        </p>
      ))}

      {showForm ? (
        <AnswerForm
          key={editing ? 'edit' : 'new'}
          item={item}
          titleId={titleId}
          pri={pri}
          live={live}
          disabled={disabled}
          compact={compact}
          initial={editing ?? undefined}
          onSend={send}
          onCancelEdit={editing ? () => setEditing(null) : undefined}
          projectUrl={project?.url}
        />
      ) : (
        <>
          <PhaseDetail decision={d} view={view} />
          <Tags decision={d} projectUrl={project?.url} />
          {view.phase === 'envoyee' && view.editable && (
            <div className="go">
              <ActionButton live={live} ready className={pri} disabled={disabled} onClick={edit}>
                Modifier
              </ActionButton>
            </div>
          )}
          {view.phase === 'expiree' && view.answer && (
            <div className="go">
              <ActionButton live={live} ready className={pri} disabled={disabled || resending} onClick={() => void resend(view.answer!)}>
                {resending ? 'Envoi…' : 'Renvoyer'}
              </ActionButton>
            </div>
          )}
          {view.phase === 'refusee' && (
            <div className="go">
              <ActionButton live={live} ready className={pri} disabled={disabled} onClick={edit}>
                Répondre à nouveau
              </ActionButton>
            </div>
          )}
        </>
      )}
    </article>
  );
}

/** Ce qui est affiché une fois la réponse partie (§ 3.3). */
function PhaseDetail({ decision, view }: { decision: Decision; view: DecisionView }) {
  const a = view.answer;
  if (!a) return null;
  const label = optionLabel(decision, a.optionId);
  const quote = a.text ? <p className="det quote strong-ink">{a.text}</p> : null;
  switch (view.phase) {
    case 'envoyee':
      return (
        <>
          <p className="det strong-ink">
            Ton choix : <b>{label}</b>
          </p>
          {quote}
          <p className="det">
            {view.editable
              ? `Le pilote la transmettra à son prochain passage (${nextPilotPassFr(a.createdAt)}).`
              : 'Le pilote est en train de la transmettre.'}
          </p>
        </>
      );
    case 'repondu':
      return (
        <>
          <p className="det strong-ink">
            Répondu le {dateTimeFr(a.doneAt ?? a.createdAt)} : <b>{label}</b>
          </p>
          {quote}
          {a.result && <p className="det">{a.result}</p>}
        </>
      );
    case 'expiree':
      return (
        <>
          <p className="det strong-ink">Le pilote ne l'a pas prise avant {clockFr(a.expiresAt)}.</p>
          <p className="det">
            Ton choix : <b className="strong-ink">{label}</b>
          </p>
          {quote}
        </>
      );
    case 'refusee':
      return (
        <>
          <p className="det strong-ink">{a.reason ?? 'Réponse refusée.'}</p>
          <p className="det">
            Ton choix : <b className="strong-ink">{label}</b>
          </p>
        </>
      );
    case 'attente':
      return null;
  }
}

/** Étiquette réversible / irréversible et liens GitHub (nouvel onglet). */
function Tags({ decision, projectUrl }: { decision: Decision; projectUrl?: string }) {
  return (
    <div className="tags">
      {decision.reversible ? (
        <span className="tag">
          <span aria-hidden="true">↺</span> Réversible
        </span>
      ) : (
        <span className="tag irr">
          <span aria-hidden="true">⚠</span> Irréversible
        </span>
      )}
      {decision.links.map((l) => {
        const text = `${l.kind === 'pr' ? 'PR' : 'issue'} #${l.number}`;
        return projectUrl ? (
          <a key={text} className="tag-link" href={`${projectUrl}/${l.kind === 'pr' ? 'pull' : 'issues'}/${l.number}`} target="_blank" rel="noreferrer noopener">
            {text}
            <span className="sr-only"> (nouvel onglet)</span>
          </a>
        ) : (
          <span key={text} className="tag code">
            {text}
          </span>
        );
      })}
    </div>
  );
}

interface FormProps {
  item: DecisionItem;
  titleId: string;
  pri: string;
  live: boolean;
  disabled?: boolean;
  compact?: boolean;
  initial?: { optionId?: string; text?: string };
  onSend: Send;
  onCancelEdit?: () => void;
  projectUrl?: string;
}

function AnswerForm({ item, titleId, pri, live, disabled, compact, initial, onSend, onCancelEdit, projectUrl }: FormProps) {
  const d = item.decision;
  const [choice, setChoice] = useState<string | undefined>(initial?.optionId);
  const [text, setText] = useState(initial?.text ?? '');
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textId = useId();
  const warnId = useId();
  const reasonId = useId();

  const deliver = async (optionId: string, value?: string) => {
    setSending(true);
    setError(null);
    const result = await onSend(optionId, value);
    /* La carte a pu quitter la liste : React ignore alors ces mises à jour. */
    setSending(false);
    if (result !== true) setError(result);
  };

  /* Oui/non sans texte et réversible : un tap, toast « Annuler » 5 s (D13). */
  if (isOneTap(d)) {
    const labels = oneTapLabels(d);
    const message = (optionId: string) =>
      d.kind === 'validation' ? (optionId === 'oui' ? 'Livrable validé.' : 'Reprise demandée.') : 'Réponse envoyée.';
    return (
      <>
        <Tags decision={d} projectUrl={projectUrl} />
        <div className="go">
          <ActionButton live={live} ready className={pri} disabled={disabled} onClick={() => void onSend('oui', undefined, { message: message('oui'), undoable: true })}>
            {labels.yes}
          </ActionButton>
          <ActionButton live={live} ready disabled={disabled} onClick={() => void onSend('non', undefined, { message: message('non'), undoable: true })}>
            {labels.no}
          </ActionButton>
        </div>
        {onCancelEdit && (
          <button type="button" className="btn ghost" onClick={onCancelEdit}>
            Garder la réponse envoyée
          </button>
        )}
      </>
    );
  }

  const all = orderedOptions(d);
  const collapsible = compact && all.length > 3;
  const rec = all.find((o) => o.id === d.recommended);
  const visible = collapsible && !expanded ? (rec ? [rec] : all.slice(0, 3)) : all;
  const needsText = d.freeText === 'obligatoire';
  const trimmed = text.trim();
  const secret = trimmed !== '' && looksLikeSecret(trimmed);
  const missing = !choice
    ? needsText && !trimmed
      ? 'Choisis une option et écris ta réponse.'
      : 'Choisis une option.'
    : needsText && !trimmed
      ? 'Écris ta réponse : elle est obligatoire.'
      : secret
        ? 'Ressemble à un secret : pose-le dans un fichier sur penny et écris seulement où.'
        : null;
  const reason = missing;

  const submit = () => {
    if (!choice || missing || sending) return;
    if (!d.reversible) setConfirming(true);
    else void deliver(choice, trimmed || undefined);
  };

  return (
    <>
      <OptionGroup
        options={visible}
        labelledBy={titleId}
        recommended={d.kind === 'action' ? undefined : d.recommended}
        value={choice}
        onChange={setChoice}
      />
      {collapsible && !expanded && (
        <button type="button" className="btn ghost more" onClick={() => setExpanded(true)}>
          Voir les {all.length} options
        </button>
      )}

      {d.freeText !== 'non' && (
        <div className="answer-text">
          <label className="label" htmlFor={textId}>
            {needsText ? 'Ta réponse (obligatoire)' : 'Précision (facultatif)'}
          </label>
          <textarea
            id={textId}
            className="field short"
            rows={3}
            maxLength={TEXT_MAX}
            value={text}
            aria-describedby={warnId}
            aria-required={needsText || undefined}
            aria-invalid={secret || undefined}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="secret-warn" id={warnId}>
            <Icon name="warning" />
            <span>{SECRET_WARNING}</span>
          </p>
        </div>
      )}

      <Tags decision={d} projectUrl={projectUrl} />

      <div className="send">
        <ActionButton live={live} ready className={`${pri} big full`} disabled={disabled || sending || Boolean(missing)} onClick={submit} describedBy={reason ? reasonId : undefined}>
          {sending ? 'Envoi…' : 'Envoyer'}
        </ActionButton>
        {reason && (
          <p className="det reason" id={reasonId}>
            {reason}
          </p>
        )}
        {error && (
          <p className="det send-error" role="alert">
            <Icon name="warning" />
            <span>{error}</span>
          </p>
        )}
        {onCancelEdit && (
          <button type="button" className="btn ghost" onClick={onCancelEdit}>
            Garder la réponse envoyée
          </button>
        )}
      </div>

      <ConfirmAnswerSheet
        open={confirming}
        question={d.question}
        choice={choice ? optionLabel(d, choice) : ''}
        text={trimmed || undefined}
        onConfirm={() => {
          setConfirming(false);
          if (choice) void deliver(choice, trimmed || undefined);
        }}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}

interface GroupProps {
  options: DecisionOption[];
  labelledBy: string;
  /** Absent pour `kind: action` : l'option est seulement placée en premier. */
  recommended?: string;
  value?: string;
  onChange: (id: string) => void;
}

/** Boutons radio (`role="radiogroup"`), ligne entière cliquable, flèches pour changer (motif WAI-ARIA). */
function OptionGroup({ options, labelledBy, recommended, value, onChange }: GroupProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndex = Math.max(0, options.findIndex((o) => o.id === value));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = refs.current.findIndex((el) => el === document.activeElement);
    if (current < 0) return;
    const last = options.length - 1;
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? current === last ? 0 : current + 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? current === 0 ? last : current - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next]!.id);
  };

  return (
    <div className="opts" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const checked = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === focusIndex ? 0 : -1}
            className="opt"
            onClick={() => onChange(o.id)}
          >
            <span className="radio" aria-hidden="true" />
            <span className="grow">
              <span className="ol">{o.label}</span>
              {o.id === recommended && (
                <span className="rec">
                  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
                  </svg>
                  Recommandé
                </span>
              )}
              {o.detail && <span className="od">{o.detail}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
