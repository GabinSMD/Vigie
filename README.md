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
- **Écrans** : « À faire par toi », Projets, Projet (Sessions, PR, Issues, Coût), Session, Pull request.
- **États** : chargement, vide, hors ligne, erreur d'accès et session déconnectée.
- **Données fictives** (`src/data/mock.ts`) : aucune donnée réelle, aucun secret. Les décisions (fusionner, envoyer une consigne, répondre, valider) ne changent qu'un état local.
- Les onglets « Lancer » et « Réglages » existent mais affichent « Cet écran arrive bientôt ».

### Voir les états de démonstration

| État | Adresse |
| --- | --- |
| Chargement | `#/?etat=chargement` |
| Vide | `#/?etat=vide` |
| Hors ligne | `#/?etat=horsligne` |
| Erreur d'accès GitHub | `#/?etat=erreur` |
| Session déconnectée | `#/projets/streambox/sessions/stream-lastfm` |

## Règles de conception tenues dans le code

- Un état s'affiche toujours avec une couleur, une icône et un mot (`StatusPill`, frise des événements).
- Une seule couleur d'accent ; un seul bouton plein par écran.
- Cibles tactiles d'au moins 44 px, bouton principal de 52 px.
- Contrastes AA vérifiés par un test sur les jetons (`src/styles/contrast.test.ts`).
- Feuilles modales : `role="dialog"`, Échap ferme, focus piégé puis rendu au déclencheur.
- Tutoiement partout ; jamais de clé ni de jeton affiché, même fictif.

## Sources

Maquettes validées : prototype, design system et planches publiés sur claude.ai (liens dans la PR d'origine).
