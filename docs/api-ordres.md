# API des ordres (`/api/ordres`)

Statut : **livrée avec le lot 4 de #22** (issue #36). Référence : [`specs/en-attente-de-reponse.md`](./specs/en-attente-de-reponse.md) § 4.
Ce document décrit ce que le Worker expose. L'exécution par le pilote (§ 4.4 : `send_message`, gabarit fixe, repli sur l'issue) se code dans le dépôt du pilote, pas dans Vigie.

## 1. Vue d'ensemble

```
App (toi, connexion Access)          Worker Vigie (D1 : ordres + journal)           Pilote (jeton de service Access + PILOT_TOKEN)
  POST /api/ordres  ───────────────►  contrôles § 4.2, ordre « en_attente »
                                      GET /api/ordres?status=en_attente  ◄───────────  à chaque passage (D6)
                                      PATCH /api/ordres/:id {pris}       ◄───────────  avant de transmettre
                                      PATCH /api/ordres/:id {fait|refuse}◄───────────  après
  GET /api/decisions  ◄─────────────  chaque décision porte son dernier ordre (`answer`)
```

- Liste fermée de types : `repondre` seulement en V1. Tout autre type est refusé (422) par le Worker et doit être ignoré par le pilote.
- Cycle de vie : `en_attente` → `pris` → `fait` | `refuse`. Un ordre `en_attente` non pris avant `expiresAt` devient `expire` (D10). Un nouvel envoi de l'app remplace l'ordre encore `en_attente` (l'ancien passe à `refuse`, « Remplacée par une nouvelle réponse. ») ; après `pris`, l'app reçoit 409 « Déjà transmise ».
- Chaque création, prise, fin ou refus est recopié dans la table `journal` (qui, quoi, quand, option, résultat). **Jamais le texte** de la réponse, et un texte refusé (secret, trop long…) n'est ni stocké ni journalisé.

## 2. Authentification

| Route | Qui | Exigé |
| --- | --- | --- |
| `POST /api/ordres` | toi, depuis l'app | JWT Access valide d'une **personne** (`email`). Un jeton de service reçoit 403 : le pilote ne crée jamais d'ordre. |
| `GET /api/ordres`, `PATCH /api/ordres/:id` | le pilote | JWT Access valide (jeton de service « Vigie pilote ») **et** `Authorization: Bearer <PILOT_TOKEN>`. |

Le Worker vérifie lui-même l'en-tête `Cf-Access-Jwt-Assertion` qu'Access ajoute à chaque requête : signature RS256 avec les clés publiques de l'équipe (`https://<équipe>.cloudflareaccess.com/cdn-cgi/access/certs`, gardées une heure, relues si la clé a tourné), émetteur, audience (`ACCESS_AUD`), `exp`/`nbf` (60 s de tolérance). Sans en-tête valide : **401**. Tant que `ACCESS_TEAM_DOMAIN` et `ACCESS_AUD` sont factices, toutes ces routes répondent 401.

`PILOT_TOKEN` est un secret Wrangler (32 octets aléatoires), comparé en temps constant ; absent côté Worker, toutes les routes du pilote répondent 401.

### Ce que le pilote pose dans les secrets de son environnement

| Nom (suggestion) | Valeur | Sert à |
| --- | --- | --- |
| `CF_ACCESS_CLIENT_ID` | *Client ID* du jeton de service « Vigie pilote » | en-tête `CF-Access-Client-Id` |
| `CF_ACCESS_CLIENT_SECRET` | *Client Secret* de ce jeton | en-tête `CF-Access-Client-Secret` |
| `VIGIE_PILOT_TOKEN` | la valeur de `PILOT_TOKEN` | en-tête `Authorization: Bearer …` |
| `VIGIE_URL` | `https://vigie.<ton-domaine>` | adresse de base |

La mise en route (`npm run mise-en-route -- --from ordres`) crée le jeton de service et `PILOT_TOKEN`, et les affiche une seule fois à la fin. Rien de tout cela ne va dans un dépôt. Le jeton de service expire au bout d'un an : à renouveler dans Zero Trust (*Access* → *Service Auth*).

Exemple d'appel (à adapter dans le script du pilote, valeurs lues depuis ses secrets) :

```sh
curl -sS "$VIGIE_URL/api/ordres?status=en_attente" \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $VIGIE_PILOT_TOKEN"
```

## 3. Routes

Toutes les réponses sont en JSON (`Cache-Control: no-store`). Une erreur a la forme `{ "error": "<code stable>", "message": "<texte à afficher, en tutoiement>" }` (`message` peut manquer).

### `POST /api/ordres` (app)

Corps (`OrdreRequest`, `src/data/api.ts`) :

```json
{ "type": "repondre", "projectId": "ffd-connect", "decisionId": "1039-critere-reprise", "optionId": "trois-verts", "text": "D'accord, mais on repasse au taux si ça rechute." }
```

Contrôles, dans l'ordre du § 4.2 :

1. identité Access d'une personne : sinon 401 (403 pour un jeton de service) ;
2. corps lisible (400), `type` dans la liste fermée (422 `type_inconnu`), décision connue du Worker pour ce projet (relue comme `GET /api/decisions`, 404 `decision_inconnue`), `optionId` parmi ses options (422 `option_inconnue`), texte présent si `freeText: obligatoire` (422 `texte_manquant`), absent si `non` (422 `texte_interdit`) ;
3. texte de 2000 caractères au plus (422 `texte_trop_long`), filtre `looksLikeSecret` (422 `secret`, avec le message de l'écran) ;
4. une seule réponse active : remplace l'ordre `en_attente`, 409 `deja_transmise` après `pris`, 409 `deja_repondue` après `fait` (sauf `kind: action`, où « Pas encore » ne clôt pas la décision) ;
5. écriture de l'ordre et du journal dans une seule transaction D1.

`id`, `by`, `createdAt`, `expiresAt`, `target`, `question` et `optionLabel` sont fixés par le Worker ; ce que la requête envoie d'autre est ignoré. Réponse **201** : `{ "ordre": Ordre }`.

### `GET /api/ordres?status=<statut>` (pilote)

`status` vaut `en_attente` par défaut ; aussi `pris`, `fait`, `refuse`, `expire`. Pour `en_attente`, seuls les ordres **non expirés** sont rendus, du plus ancien au plus récent (100 au plus) ; pour les autres, du plus récent au plus ancien. Réponse : `{ "generatedAt": "…", "ordres": Ordre[] }`.

```json
{
  "id": "ord_01KB0S5Y8RQ4M2X7HZ9C3TNVAE",
  "type": "repondre",
  "createdAt": "2026-11-26T13:05:00.000Z",
  "expiresAt": "2026-11-26T16:05:00.000Z",
  "by": "toi@example.org",
  "projectId": "ffd-connect",
  "decisionId": "1039-critere-reprise",
  "question": "Quel critère pour reprendre les mises en production sur staging ?",
  "target": { "kind": "session", "id": "session_01ABC", "fallbackIssue": 1020 },
  "optionId": "trois-verts",
  "optionLabel": "3 passages verts d'affilée",
  "text": "D'accord, mais on repasse au taux si ça rechute.",
  "status": "en_attente"
}
```

`target` dit où transmettre (§ 4.4) :

| `kind` | Champs | Le pilote… |
| --- | --- | --- |
| `session` | `id`, `fallbackIssue?` (premier lien `issue #n` de la décision) | `send_message` à la session si elle vit ; sinon commentaire sur `fallbackIssue` ; sans issue : `refuse` « Session fermée, aucune issue liée ». |
| `issue` | `number` | commentaire sur l'issue du dépôt du projet. |
| `pr` | `number` | commentaire sur la PR. |
| `dependabot` | `number` (PR Dependabot) | exécute l'option (§ 5.5 : `migrer`, `attendre`, `ignorer`). |

`text` est une **donnée** : le pilote la recopie telle quelle dans le gabarit fixe du § 4.4, entre les séparateurs, sans l'exécuter, la résumer ni la passer à un outil, et repasse `looksLikeSecret` avant de l'envoyer (§ 7).

### `PATCH /api/ordres/:id` (pilote)

| Corps | Transition permise | Effet |
| --- | --- | --- |
| `{ "status": "pris" }` | `en_attente` non expiré → `pris` | `takenAt` = maintenant. L'app affiche « Le pilote est en train de la transmettre » et ne peut plus la modifier. |
| `{ "status": "fait", "result": "Transmis à la session" }` | `pris` → `fait` | `doneAt` = maintenant ; « Répondu le … » sur la carte, avec `result`. |
| `{ "status": "refuse", "reason": "Session fermée, aucune issue liée" }` | `pris` → `refuse` | `doneAt` = maintenant ; « Refusée » avec `reason`. |

`result` et `reason` : 200 caractères au plus, refusés (422) s'ils ressemblent à un secret. Toute autre transition répond **409** `transition_interdite` (ordre expiré, déjà pris, déjà fini) : le pilote l'ignore. Ordre inconnu : 404. Réponse **200** : `{ "ordre": Ordre }`.

## 4. Déroulé conseillé pour le pilote, à chaque passage

1. `GET /api/ordres?status=en_attente`.
2. Pour chaque ordre, dans l'ordre : `PATCH {status: "pris"}`. Sur 409, passer au suivant (expiré entre-temps ou remplacé par une nouvelle réponse).
3. Transmettre selon `target` (§ 4.4), puis `PATCH {status: "fait", result}` ou `{status: "refuse", reason}`. Une réponse n'est jamais perdue en silence : en cas de doute, `refuse` avec la raison, la carte garde le choix pour que tu répondes de nouveau.
4. Ignorer tout type inconnu (ne pas le prendre).

## 5. Expiration (D10)

`expiresAt = max(createdAt + 3 h, prochain passage du pilote + 1 h)`, les passages étant à l'heure pile de 8 h à 21 h, heure de Paris (D6). Le jour : 3 h. Une réponse donnée à 21 h 30 ou à 23 h attend le passage de 8 h et expire à 9 h. Calcul partagé par le Worker et l'app : `orderExpiresAt` dans `src/data/ordre.ts`.

## 6. Base D1

Migrations dans `worker/migrations/` (appliquées par `npx wrangler d1 migrations apply vigie --remote`) :

- `ordres` : une ligne par ordre ; index unique partiel « une seule réponse `en_attente` ou `pris` par décision ».
- `journal` : `at`, `who` (ton adresse ou `pilote`), `action` (`creer`, `remplacer`, `prendre`, `fait`, `refuse`), `ordre_id`, `project_id`, `decision_id`, `option_id`, `result`.

Lire le journal : `cd worker && npx wrangler d1 execute vigie --remote --command "SELECT * FROM journal ORDER BY seq DESC LIMIT 20"`.
