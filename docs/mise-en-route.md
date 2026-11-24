# Mise en route de Vigie (données réelles, étape 1)

Guide pour Gabin. Rien de ce guide n'a été fait : **chaque étape est « à faire par Gabin »**. Le code du Worker et de l'app est prêt ; il ne manque que les comptes, les secrets et le déploiement.

Ce que tu obtiens à la fin : Vigie sur `https://vigie.<ton-domaine>`, accessible avec ta seule adresse, qui affiche tes PR, la CI et les issues des 8 dépôts suivis (`config/projets.json`), et les sessions dès que le pilote écrit son instantané. Tout est en **lecture seule** : les boutons d'action affichent « Bientôt », « Fusionner » ouvre la PR sur GitHub, les coûts sont masqués.

Prérequis : un domaine géré chez Cloudflare (D9), Node 22, un terminal dans ce dépôt. Tu peux faire les commandes `wrangler` depuis une session locale (Mac) : elles ont besoin de ta connexion Cloudflare.

---

## 1. Créer la GitHub App « Vigie » — à faire par Gabin

1. GitHub → *Settings* → *Developer settings* → *GitHub Apps* → **New GitHub App**.
2. Nom : `Vigie` (ou `Vigie-Gabin` si pris). *Homepage URL* : l'adresse de ton dépôt. Décoche **Webhook → Active** (pas besoin).
3. **Permissions de dépôt, toutes en « Read-only »** :
   - Contents
   - Pull requests
   - Issues
   - Checks
   - Metadata (obligatoire, automatique)
   Aucune autre permission. Aucune permission « Write ».
4. *Where can this GitHub App be installed?* → **Any account** (sinon tu ne pourras pas l'installer sur `SIMOND-ANCE-BROS` ni `DentiSync`).
5. **Create GitHub App**. Note l'**App ID** (numérique) : c'est `GITHUB_APP_ID`.
6. Sur la page de l'App → *Private keys* → **Generate a private key**. Un fichier `.pem` est téléchargé. Garde-le hors du dépôt.

## 2. Installer l'App sur les trois comptes — à faire par Gabin

Pour chacun de `GabinSMD`, `SIMOND-ANCE-BROS` et `DentiSync` : page de l'App → *Install App* → le compte → **Only select repositories**, et coche **seulement** les dépôts de la décision D8 :

| Compte | Dépôts |
| --- | --- |
| `GabinSMD` | `treizero`, `StreamBox`, `Vigie`, `souhaits`, `waterline` |
| `SIMOND-ANCE-BROS` | `ecole-saas`, `FFD-Connect` |
| `DentiSync` | `dentisync` |

Pour une organisation, un propriétaire doit approuver l'installation.

Relève l'**identifiant d'installation** de chaque compte : c'est le nombre à la fin de l'adresse de la page de l'installation (`…/settings/installations/12345678`). Prépare le JSON de `GITHUB_INSTALLATIONS` :

```json
{"GabinSMD": 11111111, "SIMOND-ANCE-BROS": 22222222, "DentiSync": 33333333}
```

## 3. Convertir la clé privée — à faire par Gabin

GitHub fournit une clé au format PKCS#1 ; le Worker attend le format PKCS#8.

```sh
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in vigie.<date>.private-key.pem -out vigie-pkcs8.pem
```

## 4. Créer l'espace KV — à faire par Gabin

```sh
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create VIGIE_SNAPSHOT
```

Colle l'identifiant rendu dans `worker/wrangler.toml` (`id = "…"` sous `[[kv_namespaces]]`). Remplace aussi `vigie.example.org` et `example.org` par ton sous-domaine et ton domaine dans `routes`.

## 5. Poser les secrets — à faire par Gabin

Toujours dans `worker/`. Wrangler demande la valeur au clavier (ou lis-la depuis un fichier avec `<`) ; rien n'est écrit dans le dépôt.

```sh
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < ../vigie-pkcs8.pem
npx wrangler secret put GITHUB_INSTALLATIONS
```

Ensuite **supprime** `vigie-pkcs8.pem` et le `.pem` d'origine de ton disque (garde-les dans ton gestionnaire de mots de passe si tu veux).

## 6. Déployer le Worker — à faire par Gabin

```sh
npx wrangler deploy
```

## 7. Déployer l'app (Cloudflare Pages) — à faire par Gabin

Cloudflare → *Workers & Pages* → *Create* → *Pages* → connecte `GabinSMD/Vigie`.

- Commande de build : `npm run build`
- Dossier de sortie : `dist`
- Variable d'environnement : `VITE_API_URL` = `https://vigie.<ton-domaine>` (adresse publique, pas un secret). Sans elle, l'app reste sur les données fictives.
- Domaine personnalisé : `vigie.<ton-domaine>`.

Le Worker sert `/api/*` sur le même nom d'hôte que l'app : pas de CORS à régler.

## 8. Protéger avec Cloudflare Access — à faire par Gabin

**À faire avant d'ouvrir l'adresse à quiconque** : sans Access, l'API est publique.

1. Cloudflare → *Zero Trust* → *Access* → *Applications* → **Add an application** → *Self-hosted*.
2. *Application domain* : `vigie.<ton-domaine>` (tout le nom d'hôte, donc l'app **et** `/api/*`).
3. Politique *Allow* : règle *Emails* = **ta seule adresse**. Méthode de connexion : code à usage unique par e-mail (ou GitHub).
4. Vérifie dans une fenêtre privée que l'adresse demande la connexion, et que `https://vigie.<ton-domaine>/api/projets` aussi.

## 9. Vérifier — à faire par Gabin

- `https://vigie.<ton-domaine>/api/projets` (connecté) → du JSON avec tes 8 projets. Un projet avec `"error": "github_404"` ou `"github_403"` : l'App n'est pas installée sur ce dépôt, ou n'a pas la bonne permission.
- `https://vigie.<ton-domaine>/api/sessions` → `{"snapshotAt":null,"snapshot":null}` tant que le pilote n'écrit rien. L'app dit alors « Le pilote n'a pas encore écrit d'instantané ».
- Le pilote doit écrire l'instantané dans la clé KV `snapshot` au format de [`instantane-sessions.md`](./instantane-sessions.md). C'est un autre dépôt (hors de cette étape) ; en attendant, tu peux tester avec :

  ```sh
  npx wrangler kv key put --binding VIGIE_SNAPSHOT snapshot '{"version":1,"generatedAt":"2026-11-24T14:02:00Z","sessions":[]}'
  ```

## En local, sans rien déployer

- App en données fictives : `npm run dev`.
- Tests : `npm test` (app) et `cd worker && npm test` (Worker, GitHub et KV simulés).
- Worker en local : crée `worker/.dev.vars` (ignoré par git) avec les trois secrets, puis `npx wrangler dev`.
