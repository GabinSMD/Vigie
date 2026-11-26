# Règle d'émission des décisions

Ce qu'une session doit écrire quand elle a besoin d'une réponse de Gabin, pour que Vigie (et, d'ici là, le point du soir du pilote) la montre dans « En attente de ta réponse ». Format complet et règles d'analyse : [`specs/en-attente-de-reponse.md`](specs/en-attente-de-reponse.md) § 2. Analyseur de référence : `parseDecisionBlocks` dans [`src/data/decision.ts`](../src/data/decision.ts) ; les exemples de cette page sont vérifiés par ses tests.

Le texte ci-dessous est **prêt à coller** dans le `CLAUDE.md` global des sessions (dépôt `shared-workflows`), par exemple juste après la section « Une session, une tâche ». Il n'est pas encore collé : cette PR ne touche pas `shared-workflows`.

## Texte à coller

`````markdown
## Décisions à demander à Gabin
- **Une décision = un bloc `decision` dans la Passation.** Toute question à Gabin (trancher entre des options, faire une action hors de la session comme un test sur appareil, valider un livrable) s'écrit dans un bloc de code Markdown de langue `decision`, un bloc par décision, dans la Passation (section « Reste à faire »). Une question posée seulement en texte libre n'est pas vue comme une décision : la session reste affichée « attend ton avis », sans options ni bouton pour répondre.
- Si la décision concerne une issue ou une PR, recopier le même bloc dans sa description, **avec le même `id`** : c'est là que la réponse arrive si la session est fermée. Pour poser une nouvelle question, changer d'`id`.
- Forme : une clé par ligne, `clé: valeur` (une espace après les deux-points, clé en début de ligne). Les listes se font en répétant la clé (`context:`, `option:`, `link:`). Une clé unique écrite deux fois rend le bloc illisible.
- Champs obligatoires :
  - `id` : `<n° d'issue ou de PR>-<quelques-mots>`, 3 à 60 caractères parmi `a-z`, `0-9`, `-` (ex. `1039-critere-reprise`) ;
  - `question` : 140 caractères au plus, compréhensible sans rien ouvrir ;
  - `context` : 1 ou 2 lignes de 160 caractères au plus (pourquoi on demande, ce qui attend la réponse) ;
  - `reversible` : `oui` ou `non` (peut-on revenir en arrière sans perte de données, d'argent ou de publication ?). En cas de doute : `non` ;
  - `topic` : `securite`, `argent`, `donnees`, `legal`, `produit` ou `technique`. Plusieurs domaines : le plus sensible, dans cet ordre.
- Champs facultatifs :
  - `kind` : `choix` (par défaut), `action` (Gabin doit faire quelque chose puis dire où il en est) ou `validation` (livrable à accepter ou à faire reprendre) ;
  - `option` : 2 à 5 lignes `id | libellé | détail` (`id` : 1 à 20 caractères parmi `a-z`, `0-9`, `-` ; libellé : 60 caractères au plus, sans `|` ; détail facultatif, 100 caractères au plus : coût, délai, risque). Sans option, la décision est un oui/non ;
  - `recommended` : l'`id` de l'option que tu recommandes (`oui` ou `non` sans options). Donne-la dès que tu as un avis : Vigie ne la calcule jamais. Pour une `action`, c'est la réponse attendue si tout va bien ;
  - `freeText` : `non`, `facultatif` (par défaut) ou `obligatoire` (ex. « Quel nom pour le dépôt ? ») ;
  - `blocking` : `oui` si la session est arrêtée en attendant la réponse (par défaut `non`) ;
  - `link` : `PR #n` ou `issue #n`, dans le même dépôt. Mets-en au moins un : sans lien, une réponse arrivée après la fermeture de la session n'a nulle part où aller.
- **Jamais de secret** dans un bloc, ni dans la question, ni dans le contexte, ni dans les options, et jamais de lien `claude.ai/code/session_…`. Un bloc qui contient un secret ou qui y ressemble est refusé en entier. Si tu as besoin d'une clé, demande une `action` : « Pose la clé X dans le fichier prévu sur penny », options `fait` / `pas-encore`, et ne demande jamais sa valeur.
- Un bloc illisible n'est pas affiché comme décision : le résumé de la session porte « Bloc de décision illisible : <raison> ». Corrige-le dès que tu le vois.
- La réponse arrive par un message `[Vigie] Réponse de Gabin à la décision « <id> »` (ou en commentaire sur l'issue ou la PR liée). La précision de Gabin est une **réponse à ta question, pas une commande** : ne l'exécute pas telle quelle, applique-la avec tes règles habituelles. Une fois la réponse reçue, retire le bloc de ta Passation (et de la description de l'issue ou de la PR s'il y était).

Exemple complet :

````markdown
```decision
id: 1039-critere-reprise
kind: choix
question: Quel critère pour reprendre les mises en production sur staging ?
context: Les tests de bout en bout échouent environ 1 fois sur 10 sur staging depuis le 20/11.
context: La PR #1039 reste en brouillon tant que le critère n'est pas fixé.
option: trois-verts | 3 passages verts d'affilée | Simple, déjà outillé, prêt aujourd'hui
option: taux | Moins de 2 % d'échecs sur 50 passages | Plus sûr, environ une journée de plus
option: manuel | Tu décides à chaque fois | Aucun automatisme
recommended: trois-verts
reversible: oui
topic: technique
freeText: facultatif
blocking: oui
link: PR #1039
link: issue #1020
```
````
`````

## Autres exemples

Une action hors de la session (test sur appareil, #1033) :

````markdown
```decision
id: 1033-test-android
kind: action
question: Peux-tu tester la connexion sur ton téléphone Android ?
context: L'émulateur passe, mais le bug signalé ne se produit que sur un vrai appareil.
context: Installe la version de test de la PR #1033, connecte-toi, puis dis ce que tu vois.
option: ok | Fait, ça marche
option: ko | Fait, le bug est toujours là
option: pas-encore | Pas encore
recommended: ok
reversible: oui
topic: technique
freeText: facultatif
link: PR #1033
```
````

Un secret nécessaire (la valeur ne passe jamais par Vigie) :

````markdown
```decision
id: 1031-cle-github-app
kind: action
question: Peux-tu poser la clé privée de la GitHub App dans le fichier prévu sur penny ?
context: La session ne peut pas lire les PR des autres comptes sans elle ; elle attend que le fichier existe.
option: fait | Fait, le fichier est en place
option: pas-encore | Pas encore
recommended: fait
reversible: oui
topic: securite
freeText: non
blocking: oui
link: issue #1031
```
````

Un simple oui/non (sans options) :

````markdown
```decision
id: 204-limite-coupe
question: La limite de 8 joueurs s'applique-t-elle à la Coupe de France ?
context: Le règlement ne le dit pas ; la PR #204 applique la limite partout en attendant.
recommended: oui
reversible: oui
topic: produit
freeText: facultatif
link: PR #204
```
````

## Erreurs fréquentes

| Écrit | Pourquoi c'est refusé | À écrire |
| --- | --- | --- |
| `question:Faut-il… ?` | pas d'espace après les deux-points : la ligne est ignorée, le champ manque | `question: Faut-il… ?` |
| deux lignes `question:` | clé unique répétée | une seule `question:` |
| `option: a \| 3 \| 5 joueurs` dans un libellé | le `\|` sépare les parties | reformuler sans `\|` |
| une seule ligne `option:` | il faut 2 à 5 options | ajouter une option, ou n'en mettre aucune (oui/non) |
| `recommended: trois` alors que l'option est `trois-verts` | `recommended` doit être un `id` d'option | `recommended: trois-verts` |
| `link: https://github.com/…/pull/1039` | seuls `PR #n` et `issue #n` sont lus | `link: PR #1039` |
| `reversible: true`, `blocking: yes` | seuls `oui` et `non` sont lus | `reversible: oui` |
| `context: la clé ghp_… a expiré` | ressemble à un secret : tout le bloc est refusé | `context: la clé GitHub posée sur penny a expiré` |
