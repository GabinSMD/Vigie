# Mise en route de Vigie (données réelles, étape 1)

Guide pour Gabin. Le code du Worker et de l'app est prêt ; il ne manque que tes comptes, les secrets et le déploiement. Un script fait presque tout : **tu le lances depuis ton Mac**, il te guide, et tu n'as que quelques clics à faire.

Ce que tu obtiens à la fin : Vigie sur `https://vigie.<ton-domaine>`, accessible avec ta seule adresse, qui affiche tes PR, la CI et les issues des 8 dépôts suivis (`config/projets.json`), et les sessions dès que le pilote écrit son instantané. Tout est en **lecture seule** : les boutons d'action affichent « Bientôt », « Fusionner » ouvre la PR sur GitHub, les coûts sont masqués.

Un seul Worker Cloudflare sert **l'app et l'API** (`/api/*`) sur le même nom d'hôte : pas de projet Pages, pas de CORS, et Cloudflare Access protège les deux d'un coup.

---

## 1. Lancer le script

Prérequis : Node 22, un domaine géré chez Cloudflare (D9), un navigateur connecté à GitHub (compte `GabinSMD`, propriétaire des organisations `SIMOND-ANCE-BROS` et `DentiSync`).

```sh
git pull
npm ci
npm run mise-en-route
```

Pour voir ce qu'il va faire sans rien toucher : `npm run mise-en-route -- --dry-run`.

Le script s'arrête proprement en cas de problème. Relance-le : les étapes déjà faites sont sautées (l'état est gardé dans `.vigie-setup/`, ignoré par git, droits 0600, supprimé à la fin). Pour refaire une étape précise : `npm run mise-en-route -- --from <étape>` (`--help` donne la liste : `questions`, `github-app`, `cle`, `installations`, `cloudflare`, `access`, `deploiement`, `secrets`, `verification`, `nettoyage`).

## 2. Ce que tu fais à la main pendant le script

Le script te le demande au bon moment ; voici la liste pour savoir à quoi t'attendre.

1. **Trois réponses** : l'adresse de Vigie (ex. `vigie.mondomaine.fr`), la zone Cloudflare (ex. `mondomaine.fr`), et la seule adresse e-mail autorisée.
2. **Créer la GitHub App** : le navigateur s'ouvre sur GitHub avec le formulaire déjà rempli (nom `Vigie`, webhook désactivé, permissions **toutes en lecture seule** : contents, pull requests, issues, checks, metadata ; installable sur n'importe quel compte). Clique sur **Create GitHub App**. Si le nom `Vigie` est pris, change-le sur la page (ex. `Vigie-Gabin`) avant de cliquer.
3. **Installer l'App** sur `GabinSMD`, `SIMOND-ANCE-BROS` et `DentiSync`, avec **Only select repositories** et seulement ces dépôts (décision D8) :

   | Compte | Dépôts |
   | --- | --- |
   | `GabinSMD` | `treizero`, `StreamBox`, `Vigie`, `souhaits`, `waterline` |
   | `SIMOND-ANCE-BROS` | `ecole-saas`, `FFD-Connect` |
   | `DentiSync` | `dentisync` |

   Pour une organisation, un propriétaire doit approuver l'installation. Le script attend les trois installations, puis compare les dépôts autorisés avec `config/projets.json` : s'il en manque un ou s'il y en a un de trop, il te donne le lien de la page de réglage et vérifie de nouveau.
4. **Te connecter à Cloudflare** : si `wrangler` n'est pas connecté, le navigateur s'ouvre pour `wrangler login`. Si tu as plusieurs comptes Cloudflare, choisis celui qui porte ta zone.
5. **Créer un jeton API Cloudflare pour Access** (voir ci-dessous) et le coller quand le script le demande. Il ne s'affiche pas, n'est jamais écrit sur le disque et sert à une seule chose : créer l'application Access.
6. **À la fin**, si tu veux garder la clé privée de l'App, tape `afficher` pour la voir une seule fois et range-la dans ton gestionnaire de mots de passe. Sinon, rien à faire : tu pourras en générer une nouvelle sur la page de l'App.

### Créer le jeton API Cloudflare (Access)

1. Cloudflare → icône de profil → **Mon profil** → **Jetons API** → **Créer un jeton** → **Créer un jeton personnalisé**.
2. Nom : `Vigie mise en route`.
3. Autorisations : **Compte** → **Access: Apps and Policies** → **Modifier**. Rien d'autre.
4. Ressources du compte : **Inclure** → ton compte (celui de la zone), pas « Tous les comptes ».
5. Durée de vie (TTL) : **courte**, par exemple jusqu'à demain.
6. **Créer le jeton**, copie-le, colle-le dans le script.
7. Après la mise en route : **révoque le jeton** (Jetons API → … → Supprimer). Il ne sert plus.

## 3. Ce que fait le script, dans l'ordre

1. **Questions de départ.** Rien n'est écrit en dur dans le code.
2. **GitHub App par manifeste.** Petit serveur sur `127.0.0.1` (port libre), page qui poste le manifeste à GitHub, récupération du `code` à la redirection (le paramètre `state` est vérifié contre la falsification), puis `POST /app-manifests/{code}/conversions` : identifiant, nom court et clé privée de l'App. La clé va dans `.vigie-setup/` (droits 0600).
3. **Conversion de la clé** PKCS#1 → PKCS#8 avec `node:crypto` (pas besoin d'openssl).
4. **Installations.** Ouvre `https://github.com/apps/<nom>/installations/new`, interroge `GET /app/installations` (JWT de l'App) jusqu'à trouver les trois comptes, liste les dépôts de chaque installation (`GET /installation/repositories`) et les compare à `config/projets.json`. Construit `GITHUB_INSTALLATIONS`.
5. **Cloudflare.** `wrangler whoami` (sinon `wrangler login`), création de l'espace KV `VIGIE_SNAPSHOT` s'il n'existe pas, puis modification ciblée de `worker/wrangler.toml` : l'identifiant du KV et le domaine, rien d'autre.
6. **Cloudflare Access**, par l'API et ton jeton : crée (ou met à jour) une application *self-hosted* sur `vigie.<ton-domaine>` avec une seule politique *Allow* limitée à ton adresse.
7. **Build et déploiement** : `npm run build` avec `VITE_API_URL=/`, puis `npx wrangler deploy`. Le script refuse de déployer si l'étape Access n'est pas faite.
8. **Secrets** : `wrangler secret put` pour `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` et `GITHUB_INSTALLATIONS`, valeurs passées par l'entrée standard (jamais en argument de commande, jamais affichées).
9. **Vérification** : appelle `https://vigie.<ton-domaine>/api/projets` sans être connecté. Access doit bloquer (redirection vers la page de connexion, ou 401/403). Sinon, le script le dit en rouge, te dit comment couper l'accès, et s'arrête.
10. **Nettoyage** : supprime les fichiers `.pem` et l'état local, rappelle de révoquer le jeton Cloudflare, et affiche ce qui reste à faire.

**Pourquoi Access avant le déploiement :** le domaine personnalisé est servi dès le premier `wrangler deploy`. En créant l'application Access d'abord (Access accepte une application sur un nom d'hôte qui ne répond pas encore), l'adresse est protégée dès sa première réponse. Il n'y a jamais de moment où l'API répond sans authentification. Le Worker n'a pas d'adresse `*.workers.dev` ni d'URL d'aperçu (`workers_dev = false`, `preview_urls = false`) : il n'existe pas d'entrée qui contourne Access. Les secrets sont posés juste après le déploiement (`wrangler secret put` a besoin d'un Worker existant) : entre les deux, l'API renvoie une erreur, derrière Access.

## 4. Vérifier

- `https://vigie.<ton-domaine>` dans une fenêtre privée → la page de connexion Access.
- Connecté : `https://vigie.<ton-domaine>/api/projets` → du JSON avec tes 8 projets. Un projet avec `"error": "github_404"` ou `"github_403"` : l'App n'est pas installée sur ce dépôt, ou n'a pas la bonne permission.
- `https://vigie.<ton-domaine>/api/sessions` → `{"snapshotAt":null,"snapshot":null}` tant que le pilote n'écrit rien. L'app dit alors « Le pilote n'a pas encore écrit d'instantané ».
- `https://vigie.<ton-domaine>/api/decisions` → les décisions en attente de ta réponse (issues étiquetées `decision`, descriptions de PR, Dependabot majeures, questions de l'instantané), `"decisions": []` s'il n'y en a aucune. Les blocs illisibles sont notés dans le journal du Worker (`npx wrangler tail`), sans leur contenu.

## 5. Ce qui reste après le script

- **Instantané du pilote** : le pilote écrit l'instantané dans la clé KV `snapshot` au format de [`instantane-sessions.md`](./instantane-sessions.md), à chaque passage (D6), même quand il n'a rien d'autre à faire.
  - **Où vit le pilote** : une tâche programmée horaire (« Pilote des sessions cloud ») réveille une session Claude qui tourne sur penny. Ses consignes et ses scripts sont versionnés dans le dépôt `GabinSMD/homelab-config`, dossier `pilote-cloud/`, puis recopiés dans `/mnt/ssd/claude-work/pilote-cloud/` sur penny (voir le README de ce dossier).
  - **Comment il écrit** : il construit le JSON à partir de `list_sessions`, puis lance `pilote-cloud/instantane.sh`, qui vérifie le format, refuse tout ce qui ressemble à un secret et écrit la clé avec l'API Cloudflare (travail suivi dans `GabinSMD/homelab-config#117`).
  - **Ce que tu dois poser sur penny** : un jeton d'API Cloudflare avec la permission « Workers KV Storage : Edit » dans `/mnt/ssd/claude-work/pilote-cloud/cloudflare-kv.token` (`chmod 600`, copie dans Vaultwarden), et l'identifiant de ton compte Cloudflare dans `/mnt/ssd/claude-work/pilote-cloud/cloudflare-account.id`. Cloudflare ne permet pas de limiter ce jeton à un seul espace KV : il peut écrire dans tous les KV du compte. Tant que ces fichiers manquent, le pilote saute l'étape sans rien signaler, et l'app dit « Le pilote n'a pas encore écrit d'instantané ».

    **Le plus simple** : depuis ton Mac, à la racine du dépôt (avec `ssh penny` qui marche) :

    ```sh
    npm run jeton-pilote               # ou --dry-run pour voir ce qu'il ferait, --hote <alias> si penny a un autre nom
    ```

    Le script relève l'adresse publique de penny, te guide pour créer le jeton dans Cloudflare (permission **Compte → Workers KV Storage → Modifier**, rien d'autre, limité au compte de Vigie, **filtrage IP sur penny**), te demande de le coller sans l'afficher, le vérifie avec l'API Cloudflare (`/user/tokens/verify`, compte, accès au KV de `worker/wrangler.toml`), pose les deux fichiers sur penny, fait un essai bout en bout depuis penny (écrit, relit et supprime la clé `vigie-test-jeton`, jamais `snapshot`), puis propose de ranger le jeton dans Vaultwarden avec `vw.sh ecrire` sur penny (élément « Cloudflare — jeton KV du pilote Vigie », collection « Homelab — infra » du compte machine ; à défaut, `bw` s'il est déverrouillé). Le jeton ne passe que par l'entrée standard de `ssh` ou par le fichier posé : jamais sur le disque du Mac, jamais à l'écran, jamais en argument d'une commande.

    Si `penny` n'est pas un alias ssh de ton Mac, donne l'adresse : `npm run jeton-pilote -- --hote root@<adresse Tailscale de penny>`. Les commandes de cette section marchent aussi dans fish : ce qui est entre apostrophes est exécuté par le shell de penny.

    Dans le filtrage IP, mets l'IPv4 publique de chez toi **et**, si ton réseau a de l'IPv6, son préfixe `/64` (le script les affiche) : sinon les appels qui partent en IPv6, ceux du pilote compris, sont refusés (erreur 9109). Jamais l'adresse Tailscale (`100.x.x.x`) : Cloudflare ne la voit pas.

    Avec le filtrage IP, les appels depuis le Mac peuvent être refusés : par défaut (`--verif auto`), le script vérifie d'abord depuis le Mac, puis reprend toutes les vérifications depuis penny dès que Cloudflare refuse un appel pour cause de filtrage IP (`curl` y lit l'en-tête d'autorisation sur son entrée standard). `--verif penny` va directement sur penny, `--verif mac` n'essaie que le Mac (jeton sans filtrage IP).

    **À la main**, si tu préfères : crée le jeton comme ci-dessus sur <https://dash.cloudflare.com/profile/api-tokens>, puis sur penny :

    ```sh
    cd /mnt/ssd/claude-work/pilote-cloud
    umask 077
    read -rs JETON && printf '%s\n' "$JETON" > cloudflare-kv.token && unset JETON   # colle le jeton, puis Entrée
    echo '<identifiant du compte>' > cloudflare-account.id
    ```

    Range aussi le jeton dans Vaultwarden, toujours sans le mettre en argument (`vw.sh ecrire` lit un fichier ; on lui passe une copie sans le retour à la ligne final) :

    ```sh
    ssh penny 'set -eu; umask 077; t=$(mktemp); trap "rm -f \"$t\"" EXIT
    tr -d "\n" < /mnt/ssd/claude-work/pilote-cloud/cloudflare-kv.token > "$t"
    vw.sh ecrire "Cloudflare — jeton KV du pilote Vigie" pilote-vigie "$t" https://dash.cloudflare.com/profile/api-tokens'
    ```

    Une erreur `Failed to link @bitwarden/cli: EEXIST` vient du cache de `bunx` et passe en relançant. Pour le ranger à la main depuis ton Mac, copie-le sans l'afficher : `ssh penny cat /mnt/ssd/claude-work/pilote-cloud/cloudflare-kv.token | tr -d '\n' | pbcopy`.

    **Révoquer**, plus tard et seulement si besoin (fuite, penny remplacé, arrêt de Vigie) : Cloudflare → *Jetons API* → le jeton → *Supprimer*, puis `rm` du fichier sur penny.
  - **Vérifier** : après le passage suivant (de 8 h 13 à 21 h 13, heure de Paris), `https://vigie.<ton-domaine>/api/sessions` renvoie un `snapshotAt` récent.

  Pour tester l'écran sans le pilote, tu peux écrire un instantané vide à la main :

  ```sh
  cd worker
  npx wrangler kv key put --binding VIGIE_SNAPSHOT --remote snapshot '{"version":1,"generatedAt":"2026-11-24T14:02:00Z","sessions":[]}'
  ```
- **Redéployer après une modification** : `npm run build` avec `VITE_API_URL=/`, puis `cd worker && npx wrangler deploy` (ou `npm run mise-en-route -- --from deploiement`, qui garde l'ordre et la vérification).
- `worker/wrangler.toml` contient maintenant ton domaine et l'identifiant du KV : ce ne sont pas des secrets, tu peux les committer.

## En local, sans rien déployer

- App en données fictives : `npm run dev`.
- Tests : `npm test` (app, scripts de mise en route et du jeton du pilote) et `cd worker && npm test` (Worker, GitHub et KV simulés).
- Worker en local : crée `worker/.dev.vars` (ignoré par git) avec les trois secrets, `npm run build` à la racine, puis `cd worker && npx wrangler dev`.

---

## Annexe : la procédure à la main

Si tu préfères tout faire toi-même, ou si le script bloque sur une étape. Garde le même ordre : **Access avant le premier déploiement**.

### A1. Créer la GitHub App « Vigie »

1. GitHub → *Settings* → *Developer settings* → *GitHub Apps* → **New GitHub App**.
2. Nom : `Vigie` (ou `Vigie-Gabin` si pris). *Homepage URL* : l'adresse de ton dépôt. Décoche **Webhook → Active**.
3. **Permissions de dépôt, toutes en « Read-only »** : Contents, Pull requests, Issues, Checks, Metadata (automatique). Aucune autre permission, aucune « Write ».
4. *Where can this GitHub App be installed?* → **Any account**.
5. **Create GitHub App**. Note l'**App ID** : c'est `GITHUB_APP_ID`.
6. *Private keys* → **Generate a private key**. Garde le `.pem` hors du dépôt.

### A2. Installer l'App sur les trois comptes

Page de l'App → *Install App* → chaque compte → **Only select repositories**, avec les dépôts du tableau de la section 2. Relève l'identifiant d'installation de chaque compte (le nombre à la fin de `…/settings/installations/12345678`) et prépare `GITHUB_INSTALLATIONS` :

```json
{"GabinSMD": 11111111, "SIMOND-ANCE-BROS": 22222222, "DentiSync": 33333333}
```

### A3. Convertir la clé privée

GitHub fournit une clé PKCS#1 ; le Worker attend du PKCS#8.

```sh
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in vigie.<date>.private-key.pem -out vigie-pkcs8.pem
```

### A4. Créer l'espace KV et renseigner wrangler.toml

```sh
cd worker
npm ci
npx wrangler login
npx wrangler kv namespace create VIGIE_SNAPSHOT
```

Dans `worker/wrangler.toml` : colle l'identifiant rendu dans `id = "…"` sous `[[kv_namespaces]]`, et remplace `vigie.example.org` et `example.org` par ton sous-domaine et ta zone dans `routes`.

### A5. Protéger avec Cloudflare Access (avant de déployer)

1. Cloudflare → *Zero Trust* → *Access* → *Applications* → **Add an application** → *Self-hosted*.
2. *Application domain* : `vigie.<ton-domaine>` (tout le nom d'hôte : l'app **et** `/api/*`).
3. Politique *Allow* : règle *Emails* = **ta seule adresse**. Connexion par code à usage unique par e-mail (ou GitHub).

### A6. Construire l'app et déployer le Worker

```sh
VITE_API_URL=/ npm run build      # à la racine
cd worker
npx wrangler deploy
```

### A7. Poser les secrets

Toujours dans `worker/`. Wrangler demande la valeur au clavier (ou lis-la depuis un fichier avec `<`) ; rien n'est écrit dans le dépôt.

```sh
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < ../vigie-pkcs8.pem
npx wrangler secret put GITHUB_INSTALLATIONS
```

Ensuite **supprime** `vigie-pkcs8.pem` et le `.pem` d'origine de ton disque (garde-les dans ton gestionnaire de mots de passe si tu veux).

### A8. Vérifier

Fenêtre privée : `https://vigie.<ton-domaine>` et `https://vigie.<ton-domaine>/api/projets` doivent demander la connexion. Puis, connecté, les vérifications de la section 4.
