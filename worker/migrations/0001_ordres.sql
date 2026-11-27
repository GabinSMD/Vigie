-- Ordres déposés par l'app et pris par le pilote (docs/specs/en-attente-de-reponse.md § 4),
-- et journal de tout ce qui leur arrive (qui, quoi, quand, résultat).
-- Appliquée par `npx wrangler d1 migrations apply vigie --remote` (voir docs/mise-en-route.md).

CREATE TABLE ordres (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('repondre')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  by TEXT NOT NULL,
  project_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  question TEXT NOT NULL,
  -- JSON : { "kind": "session", "id": "…", "fallbackIssue": 1020 } | { "kind": "issue" | "pr" | "dependabot", "number": 12 }
  target TEXT NOT NULL,
  option_id TEXT NOT NULL,
  option_label TEXT NOT NULL,
  text TEXT,
  status TEXT NOT NULL CHECK (status IN ('en_attente', 'pris', 'fait', 'refuse', 'expire')),
  taken_at TEXT,
  done_at TEXT,
  result TEXT,
  reason TEXT
);

CREATE INDEX ordres_decision ON ordres (project_id, decision_id, created_at);
CREATE INDEX ordres_status ON ordres (status, expires_at);

-- Une seule réponse active (en attente ou prise) par décision (§ 4.2, contrôle 4).
CREATE UNIQUE INDEX ordres_un_actif ON ordres (project_id, decision_id) WHERE status IN ('en_attente', 'pris');

-- Journal : jamais le texte de la réponse, jamais un texte refusé.
CREATE TABLE journal (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  who TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('creer', 'remplacer', 'prendre', 'fait', 'refuse')),
  ordre_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  option_id TEXT,
  result TEXT
);

CREATE INDEX journal_ordre ON journal (ordre_id);
