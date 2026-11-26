# Instantané des sessions

Ce que le **pilote** écrit dans KV et que le Worker relit (`GET /api/sessions`). Un seul document JSON, remplacé en entier à chaque passage du pilote : toutes les heures, de 8 h à 21 h, heure de Paris (D6). L'instantané peut donc avoir jusqu'à une heure de retard en journée, et davantage la nuit : l'app affiche toujours son heure.

- Clé KV : `snapshot`, dans l'espace `VIGIE_SNAPSHOT`.
- Type TypeScript de référence : [`src/data/snapshot.ts`](../src/data/snapshot.ts) (`SessionSnapshot`).
- Dates en **ISO 8601 UTC** (`2026-11-24T14:02:00Z`). L'app les transforme en « il y a 12 min » et affiche « Données de 15 h 02 » (heure de Paris) pour l'âge de l'instantané.
- Pas de coût affiché en V1 (D7). Le champ `costUsd` est facultatif : le pilote peut le remplir s'il le lit, l'app l'ignore.
- Jamais de clé, de jeton ni de mot de passe dans l'instantané, y compris dans `summary` ou `events`.

## Forme

```json
{
  "version": 1,
  "generatedAt": "2026-11-24T14:02:00Z",
  "sessions": [
    {
      "id": "session_01ABC",
      "projectId": "ecole-saas",
      "role": "Développeur",
      "ref": "#450",
      "title": "Session de l'issue #450",
      "status": "attention",
      "statusLabel": "Attend ton avis",
      "line": "Le code est prêt, la branche reste à pousser.",
      "summary": "Le code est prêt en local. La session attend que la branche soit poussée.",
      "waitingFor": "Pousser la branche, ou dire à la session quoi faire.",
      "events": [
        { "kind": "attente", "title": "En attente de la branche", "at": "2026-11-24T13:50:00Z" }
      ],
      "linkedPr": "#466",
      "disconnected": { "lastSeen": "2026-11-24T13:44:00Z" },
      "costUsd": 0.6,
      "questions": [
        { "id": "q1", "title": "La limite de 8 joueurs s'applique-t-elle à la Coupe de France ?", "detail": "en brouillon", "prRef": "#204" }
      ],
      "deliverables": [{ "id": "d1", "title": "Maquette « Amirauté » livrée" }]
    }
  ]
}
```

## Champs

| Champ | Type | Obligatoire | Sens |
| --- | --- | --- | --- |
| `version` | `1` | oui | Version du format. Le Worker refuse (502) toute autre valeur. |
| `generatedAt` | ISO 8601 | oui | Moment où le pilote a écrit l'instantané. |
| `sessions[].id` | texte | oui | Identifiant stable de la session. |
| `sessions[].projectId` | texte | oui | Un `id` de `config/projets.json`. |
| `sessions[].role` | texte | oui | « Développeur », « Relecteur », « Chef de projet »… |
| `sessions[].ref` | `#123` | non | Issue liée. |
| `sessions[].title` | texte | oui | Titre court. |
| `sessions[].status` | `ok` \| `attention` \| `bloque` \| `neutre` | oui | Même énumération que `Status` dans `src/data/types.ts`. |
| `sessions[].statusLabel` | texte | oui | Le mot affiché à côté de la pastille (« Terminée », « En cours »…). |
| `sessions[].line` | texte | oui | Une ligne de résumé pour les listes. |
| `sessions[].summary` | texte | oui | Résumé de la session. |
| `sessions[].waitingFor` | texte | non | Ce qu'elle attend de toi ; **sa présence** met la session dans « À faire par toi ». |
| `sessions[].events[]` | `{kind, title, at}` | oui (peut être vide) | Du plus récent au plus ancien. `kind` : `fait`, `reussi`, `attente`, `perdu`, `envoye`. |
| `sessions[].linkedPr` | `#466` | non | PR liée dans le même projet. |
| `sessions[].disconnected` | `{lastSeen}` | non | Présent si la session ne répond plus ; elle apparaît alors comme blocage. |
| `sessions[].costUsd` | nombre | non | Coût en dollars, **non affiché** en V1. |
| `sessions[].questions[]` | `{id, title, detail, prRef, …}` | non | Questions posées par la session. Les quatre premiers champs sont obligatoires ; les autres sont facultatifs et viennent d'un bloc `decision` (voir [Questions et décisions](#questions-et-décisions)). |
| `sessions[].deliverables[]` | `{id, title}` | non | Livrables à valider. |

## Questions et décisions

Une session qui attend une décision de Gabin l'écrit dans sa Passation sous forme de **bloc `decision`** (règle d'émission : [`regle-emission-decision.md`](regle-emission-decision.md) ; format complet : [`specs/en-attente-de-reponse.md`](specs/en-attente-de-reponse.md) § 2). Le pilote lit ces blocs avec les règles du § 2.2 (analyseur de référence : `parseDecisionBlocks` dans [`src/data/decision.ts`](../src/data/decision.ts)) et les recopie dans `questions[]` (`toSnapshotQuestion`). Il ne crée jamais de question à partir d'un texte libre, n'ajoute ni option ni recommandation, et un bloc invalide n'est pas recopié : la session garde son `waitingFor` et son `summary` porte « Bloc de décision illisible : <raison> ».

Les champs ajoutés sont **tous facultatifs** : un pilote qui ne les remplit pas produit exactement l'instantané v1, et `version` reste `1`. **Une question sans `options` reste une question oui/non.**

| Champ de `questions[]` | Type | Obligatoire | Sens |
| --- | --- | --- | --- |
| `id` | texte | oui | Identifiant du bloc (`[a-z0-9-]{3,60}`, ex. `1039-critere-reprise`), stable et unique dans le projet. |
| `title` | texte | oui | La question (champ `question` du bloc, 140 car. max). |
| `detail` | texte | oui | Première ligne du contexte (ou un complément court, comme en v1). |
| `prRef` | `#123` ou vide | oui | Premier lien PR, sinon premier lien issue, sinon chaîne vide. |
| `kind` | `choix` \| `action` \| `validation` | non | Absent : `choix`. |
| `context` | 1 ou 2 textes | non | Pourquoi on demande, et ce qui attend la réponse (160 car. max par ligne). |
| `options[]` | `{id, label, detail?}`, 2 à 5 | non | **Absent : oui/non** (options implicites `oui` et `non`). |
| `recommended` | id d'option | non | Option recommandée par l'agent (ou `oui`/`non` sans options). |
| `reversible` | booléen | non | Peut-on revenir en arrière sans perte ? |
| `topic` | `securite` \| `argent` \| `donnees` \| `legal` \| `produit` \| `technique` | non | Domaine, pour le tri. |
| `freeText` | `non` \| `facultatif` \| `obligatoire` | non | Absent : `facultatif`. |
| `links[]` | `{kind: "pr" \| "issue", number}` | non | Liens vers le même dépôt. |
| `blocking` | booléen | non | La session est arrêtée en attendant la réponse. |
| `askedAt` | ISO 8601 | non | Première fois que le pilote a vu la question. |

Exemple d'une question complète :

```json
{
  "id": "1039-critere-reprise",
  "title": "Quel critère pour reprendre les mises en production sur staging ?",
  "detail": "Les tests de bout en bout échouent environ 1 fois sur 10 sur staging depuis le 20/11.",
  "prRef": "#1039",
  "kind": "choix",
  "context": [
    "Les tests de bout en bout échouent environ 1 fois sur 10 sur staging depuis le 20/11.",
    "La PR #1039 reste en brouillon tant que le critère n'est pas fixé."
  ],
  "options": [
    { "id": "trois-verts", "label": "3 passages verts d'affilée", "detail": "Simple, déjà outillé, prêt aujourd'hui" },
    { "id": "taux", "label": "Moins de 2 % d'échecs sur 50 passages", "detail": "Plus sûr, environ une journée de plus" },
    { "id": "manuel", "label": "Tu décides à chaque fois", "detail": "Aucun automatisme" }
  ],
  "recommended": "trois-verts",
  "reversible": true,
  "topic": "technique",
  "freeText": "facultatif",
  "links": [{ "kind": "pr", "number": 1039 }, { "kind": "issue", "number": 1020 }],
  "blocking": true,
  "askedAt": "2026-11-26T09:12:00Z"
}
```

Aucun secret ni lien `claude.ai/code/session_…` : un bloc qui en contient (ou qui y ressemble : préfixes `ghp_`, `sk-`, `AKIA`…, longue chaîne de lettres et de chiffres, `password=`) est refusé en entier et n'est jamais recopié. L'app actuelle n'affiche encore que `title`, `detail` et `prRef` ; les autres champs seront lus par le lot 3 (écran).

## Réponse de `GET /api/sessions`

```json
{ "snapshotAt": "2026-11-24T14:02:00Z", "snapshot": { "...": "le document ci-dessus" } }
```

Tant que le pilote n'a rien écrit : `{ "snapshotAt": null, "snapshot": null }` (l'app l'affiche, les PR restent à jour).
