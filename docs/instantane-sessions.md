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
| `sessions[].questions[]` | `{id, title, detail, prRef}` | non | Questions oui/non posées par la session. Champs facultatifs proposés (options, recommandation, réversible, texte libre, liens) : voir [`specs/en-attente-de-reponse.md`](specs/en-attente-de-reponse.md) § 2.3, pas encore lus par l'app. |
| `sessions[].deliverables[]` | `{id, title}` | non | Livrables à valider. |

## Réponse de `GET /api/sessions`

```json
{ "snapshotAt": "2026-11-24T14:02:00Z", "snapshot": { "...": "le document ci-dessus" } }
```

Tant que le pilote n'a rien écrit : `{ "snapshotAt": null, "snapshot": null }` (l'app l'affiche, les PR restent à jour).
