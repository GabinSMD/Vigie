# Vigie

Tour de contrôle : panneau de pilotage de projets menés par des agents IA, pensé mobile d'abord (390 px).
Tu décides, tu valides, tu fusionnes : l'application rassemble ce qui attend ton avis.

## Démarrer

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # tests (composants, parcours, contrastes AA)
npm run build      # vérification des types + build dans dist/
```

## Ce que contient ce premier livrable

- **Socle** : jetons du design system (`src/styles/tokens.css`), thème clair « plein soleil » et thème sombre (suit le système), composants `StatusPill`, `ProjectCard`, `ActionRow`, `TabBar`, `ActionSheet`.
- **Écrans** : « À faire par toi », Projets, Projet (Sessions, PR, Issues, Coût), Session, Pull request, Lancer du travail, Réglages.
- **États** : chargement, vide, hors ligne, erreur d'accès et session déconnectée.
- **Données fictives** (`src/data/mock.ts`) : aucune donnée réelle, aucun secret. Les décisions (fusionner, envoyer une consigne, répondre, valider) ne changent qu'un état local.
- **Lancer du travail** : depuis une issue en file ou avec une consigne libre, choix du projet et du rôle ; le plafond de sessions du jour bloque le lancement. `#/lancer?projet=ecole-saas&issue=458` présélectionne une issue.
- **Réglages** : plafonds de sessions et de coût (global et par projet), fusion automatique par projet (activée après confirmation), notification push et seuil d'alerte. Les valeurs se reportent sur les jauges de Projets et Projet.

### Voir les états de démonstration

| État | Adresse |
| --- | --- |
| Chargement | `#/?etat=chargement` |
| Vide | `#/?etat=vide` |
| Hors ligne | `#/?etat=horsligne` |
| Erreur d'accès GitHub | `#/?etat=erreur` |
| Session déconnectée | `#/projets/streambox/sessions/stream-lastfm` |

## Données réelles (étape 1, lecture seule)

Sans configuration, l'app utilise les données fictives. Avec `VITE_API_URL` (`/` en production : le Worker sert l'app et l'API sur le même nom d'hôte), elle lit le Worker (`worker/`) : PR, CI et issues via une GitHub App en lecture seule, sessions via l'instantané que le pilote écrit dans KV. Les réponses aux décisions partent vers `POST /api/ordres` (file D1 que le pilote lit, voir [`docs/api-ordres.md`](docs/api-ordres.md)) ; les autres actions restent désactivées (« Bientôt »), « Fusionner » ouvre la PR sur GitHub, les coûts sont masqués.

- Conception : [`docs/conception-donnees-reelles.md`](docs/conception-donnees-reelles.md)
- Format de l'instantané : [`docs/instantane-sessions.md`](docs/instantane-sessions.md)
- Mise en route (GitHub App, KV, Access, déploiement) : `npm run mise-en-route` depuis ton Mac, guide dans [`docs/mise-en-route.md`](docs/mise-en-route.md)
- Projets suivis : [`config/projets.json`](config/projets.json) · tests du Worker : `cd worker && npm test`

## Règles de conception tenues dans le code

- Un état s'affiche toujours avec une couleur, une icône et un mot (`StatusPill`, frise des événements).
- Une seule couleur d'accent ; un seul bouton plein par écran.
- Interrupteurs sur toute la ligne, `role="switch"` + `aria-checked`, avec un mot écrit (Oui/Non, Auto/Manuelle).
- Cibles tactiles d'au moins 44 px, bouton principal de 52 px.
- Contrastes AA vérifiés par un test sur les jetons (`src/styles/contrast.test.ts`).
- Feuilles modales : `role="dialog"`, Échap ferme, focus piégé puis rendu au déclencheur.
- Tutoiement partout ; jamais de clé ni de jeton affiché, même fictif.

## Sources

Maquettes validées : prototype, design system et planches publiés sur claude.ai (liens dans la PR d'origine).
