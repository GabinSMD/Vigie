# Brancher Vigie sur les vraies données — note de conception

Statut : **décisions D1 à D9 validées le 24/11/2026**. Rien n'est branché.

## 1. Ce qu'il faut remplacer

Aujourd'hui tout vient de `src/data/mock.ts`, et chaque décision ne change qu'un état local (`src/data/store.tsx`).

| Ce que l'app affiche | Source réelle |
| --- | --- |
| Projets (dépôts suivis) | Liste fixe que tu tiens (fichier de config) |
| Sessions, état, résumé, événements, « attend ton avis » | Sessions Claude Code (cloud) |
| PR, CI, brouillon, garde-fous | GitHub |
| Issues en file | GitHub (issues ouvertes, dont `[session-suivante]`) |
| Questions, livrables à valider | Sessions Claude Code (ce qu'elles demandent) |
| Coût du jour, par session et par projet | **Inconnu** : voir § 6 |
| Plafonds, fusion auto, alertes (Réglages) | Stockage propre à Vigie |

| Ce que l'app fait | Effet réel |
| --- | --- |
| Fusionner une PR | Fusion GitHub |
| Envoyer une consigne / répondre oui-non | Message envoyé à une session |
| Valider un livrable | Message à la session, ou fermeture d'issue |
| Lancer une session | Création d'une session Claude Code |
| Reprendre une session déconnectée | Relance de la session |
| Fusion automatique, plafonds | Règles que le pilote applique |

## 2. Contrainte principale : l'accès aux sessions

**Vérifié le 24/11/2026 : hypothèse confirmée.** La documentation officielle des sessions cloud (<https://code.claude.com/docs/en/claude-code-on-the-web>) ne décrit aucune API HTTP publique pour lister ou lire les sessions : elles se gèrent depuis claude.ai/code, l'application mobile, ou la CLI (`claude --teleport` pour les reprendre, `claude -p "…" --cloud <id>` pour leur envoyer un message). La recherche renvoie bien une API « Sessions » sur platform.claude.com, mais c'est celle des *Managed Agents* (`GET /v1/sessions`, clé d'API) : un autre produit, qui ne liste pas les sessions Claude Code cloud. Ce qui marche aujourd'hui, c'est ce qu'utilise le pilote : les outils `claude-code-remote` (`list_sessions`, `list_events`, `get_session`, `send_message`, `create_session`), disponibles **depuis une session Claude Code**.

Conséquence : Vigie ne doit pas parler directement aux sessions. Le **pilote** (qui tourne déjà et a ces droits) sert d'intermédiaire.

## 3. Architecture proposée

```
           lit (à chaque passage)                     écrit l'instantané
 Pilote ─────────────────────────► sessions Claude ─┐
   │  ▲                                              ├──► Stockage Vigie (instantané + file d'ordres)
   │  │ prend les ordres en file                     │            ▲
   │  └──────────────────────────────────────────────┘            │ lit / dépose un ordre
   │ exécute : consigne, lancement, reprise                         │
   ▼                                                         App Vigie (navigateur)
 GitHub ◄──── lecture directe (PR, CI, issues) ──── Worker Vigie ──┘
```

1. **Instantané des sessions** : à chaque tour, le pilote écrit un JSON par projet (sessions, état, résumé, derniers événements, ce qu'elles attendent) dans le stockage de Vigie. Vigie le lit et affiche « Données de 14 h 02 » (l'état hors-ligne existe déjà).
2. **GitHub en direct** : un petit serveur (Worker) lit PR, CI et issues avec un accès en lecture seule limité aux dépôts suivis.
3. **Ordres en file** : un bouton de Vigie (consigne, lancement…) dépose un ordre signé dans une file ; le pilote le prend à son prochain passage (au plus une heure plus tard en journée), l'exécute, et note le résultat. L'app montre « Envoyé, en attente du pilote » puis « Fait ».
4. **Fusion** : seule action qui touche GitHub en écriture. Voir décision D4.

Pourquoi ce découpage : aucun jeton Claude ne quitte le pilote ; Vigie ne détient qu'un accès GitHub en lecture (plus, éventuellement, la fusion) ; si Vigie est compromise, au pire on lit tes PR ou on dépose un ordre que le pilote peut refuser.

## 4. Hébergement — recommandation : Cloudflare

| | Cloudflare (Pages + Worker + KV/D1) | Homelab |
| --- | --- | --- |
| Accessible depuis le téléphone, partout | Oui | Il faut l'exposer (tunnel) |
| Authentification | Cloudflare Access, sans code à écrire | À monter |
| Disponibilité | Indépendante de la maison | Dépend du courant et de la box |
| Coût | Offre gratuite suffisante pour un seul utilisateur | Déjà payé |
| Le pilote peut y écrire | Oui (API) | Oui, si exposé |

Recommandation : **Cloudflare**, Pages pour l'app, un Worker pour l'API, **KV** pour l'instantané et **D1** pour la file d'ordres et les réglages.

## 5. Sécurité

- **Connexion à l'app** : Cloudflare Access devant tout le domaine, une seule adresse autorisée (la tienne), code par e-mail ou connexion GitHub. Pas de mot de passe géré par Vigie.
- **Accès GitHub** : une GitHub App dédiée « Vigie », installée sur les seuls dépôts suivis, permissions *lecture* sur contents, pull requests, issues, checks. La clé privée vit dans les secrets du Worker, jamais dans le dépôt ni dans l'app.
- **Écriture vers le stockage par le pilote** : un jeton Cloudflare limité à ce KV/D1, rangé dans les secrets de l'environnement du pilote.
- **Ordres** : chaque ordre a un type parmi une liste fermée, un identifiant unique, une date d'expiration plus longue que l'écart entre deux passages du pilote (ex. 3 h, et les ordres déposés la nuit attendent le passage de 8 h) ; le pilote ignore tout ordre expiré, inconnu ou en double. Une consigne libre est transmise comme texte, jamais exécutée.
- **Aucun secret à l'écran** : la règle actuelle (« jamais de clé ni de jeton affiché ») reste ; le blocage « clé API » dit toujours où poser la clé, pas la clé.
- **Journal** : chaque ordre et chaque fusion sont gardés dans D1 (qui, quoi, quand, résultat).

## 6. Coûts : point ouvert

**Vérifié le 24/11/2026 : hypothèse nuancée.** La documentation officielle dit seulement qu'une session cloud « compte dans les limites de ton forfait » et qu'il n'y a pas de facturation séparée de la VM : pas de coût par session côté produit. Côté outils, un indice disait que `get_session` (`claude-code-remote`) renvoie `external_metadata.usage.cost_usd`. Sur la session qui a codé cette étape, `get_session` renvoie bien `external_metadata` (modèle, jetons de contexte, limites de débit…) mais **sans** champ `usage` ni `cost_usd` : le champ n'a pas été observé. Il peut n'exister que pour certaines sessions ou après un tour terminé ; **le pilote doit le vérifier sur ses propres lectures** avant de s'y fier. L'instantané prévoit donc un `costUsd` facultatif (voir `docs/instantane-sessions.md`), ignoré par l'écran. Trois pistes, de la plus simple à la plus juste :
1. masquer l'onglet Coût et les jauges tant qu'aucune source fiable n'existe ;
2. une estimation (durée ou tours de session × forfait) clairement marquée « estimé » ;
3. les chiffres de la console d'utilisation, s'il existe une API accessible à ton compte.

Recommandation : **1** pour la première version. Les plafonds de **sessions par jour** restent, eux, appliqués par le pilote.

## 7. Découpage en étapes

1. **Lecture seule** : config des projets, Worker + GitHub App (PR, CI, issues), instantané des sessions écrit par le pilote, Cloudflare Access. Les boutons d'action restent désactivés avec « Bientôt ».
2. **Ordres sans risque** : consigne, réponse oui/non, validation de livrable, reprise : via la file.
3. **Lancement de sessions** : via la file, plafond du jour vérifié par le pilote *et* par le Worker.
4. **Fusion** depuis Vigie, puis fusion automatique par projet (garde-fous : pas brouillon, CI verte, branche principale).

Chaque étape fait l'objet d'une issue et d'une PR séparées.

## 8. Décisions

| # | Décision | Choix | Statut |
| --- | --- | --- | --- |
| D1 | Hébergement | Cloudflare (Pages + Worker + KV/D1) | Validé |
| D2 | Connexion à l'app | Cloudflare Access, ta seule adresse | Validé |
| D3 | Accès GitHub | GitHub App « Vigie », lecture seule, dépôts suivis seulement | Validé |
| D4 | Qui fusionne | Étape 4 seulement ; d'ici là, le bouton ouvre la PR sur GitHub | Validé |
| D5 | Passer par le pilote pour les sessions | Oui (aucun jeton Claude hors du pilote) | Validé |
| D6 | Fréquence de l'instantané | À chaque passage du pilote (toutes les heures, de 8 h à 21 h, heure de Paris). Révisé le 25/11/2026 : une tâche programmée ne peut pas tourner plus d'une fois par heure | Validé |
| D7 | Coûts | Masqués en V1 | Validé |
| D8 | Projets suivis au départ | `SIMOND-ANCE-BROS/ecole-saas`, `SIMOND-ANCE-BROS/FFD-Connect`, `GabinSMD/treizero`, `GabinSMD/StreamBox`, `GabinSMD/Vigie`, `GabinSMD/souhaits`, `GabinSMD/waterline`, `DentiSync/dentisync` | Validé |
| D9 | Nom de domaine | Sous-domaine `vigie.` d'un domaine perso géré chez Cloudflare (domaine exact à préciser au déploiement) | Validé |

Conséquence de D8 : les dépôts sont répartis sur trois comptes GitHub (`GabinSMD`, `SIMOND-ANCE-BROS`, `DentiSync`). La GitHub App « Vigie » devra être installée sur chacun, limitée aux dépôts listés ; le Worker garde un identifiant d'installation par compte.

Les deux hypothèses « à vérifier » l'ont été le 24/11/2026 (§ 2 et § 6) : aucune ne change l'architecture. La seule inconnue restante : le champ `cost_usd` de `get_session`, à confirmer par le pilote.
