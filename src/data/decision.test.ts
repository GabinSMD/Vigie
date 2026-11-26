// @vitest-environment node
// L'analyseur doit tourner sans navigateur : il sera appelé par le Worker (lot 2).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractFencedBlocks, looksLikeSecret, parseDecisionBlocks, toDecision, toSnapshotQuestion } from './decision';

/** Entoure des lignes d'un bloc de code `decision`. */
const block = (...lines: string[]) => ['```decision', ...lines, '```'].join('\n');

/** Bloc minimal valide, complété ou modifié par `extra`. */
const minimal = (...extra: string[]) =>
  block(
    'id: 1039-critere-reprise',
    'question: Quel critère pour reprendre les mises en production sur staging ?',
    'context: Les tests de bout en bout échouent environ 1 fois sur 10.',
    'reversible: oui',
    'topic: technique',
    ...extra,
  );

const EXEMPLE_1039 = `Passation

**Fait** : la PR #1039 est prête.

\`\`\`decision
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
\`\`\`
`;

describe('parseDecisionBlocks : exemple complet de la spécification', () => {
  it('lit le bloc #1039 tel quel', () => {
    const { decisions, errors, warnings } = parseDecisionBlocks(EXEMPLE_1039);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(decisions).toEqual([
      {
        id: '1039-critere-reprise',
        kind: 'choix',
        question: 'Quel critère pour reprendre les mises en production sur staging ?',
        context: [
          'Les tests de bout en bout échouent environ 1 fois sur 10 sur staging depuis le 20/11.',
          "La PR #1039 reste en brouillon tant que le critère n'est pas fixé.",
        ],
        options: [
          { id: 'trois-verts', label: "3 passages verts d'affilée", detail: "Simple, déjà outillé, prêt aujourd'hui" },
          { id: 'taux', label: "Moins de 2 % d'échecs sur 50 passages", detail: 'Plus sûr, environ une journée de plus' },
          { id: 'manuel', label: 'Tu décides à chaque fois', detail: 'Aucun automatisme' },
        ],
        recommended: 'trois-verts',
        reversible: true,
        topic: 'technique',
        freeText: 'facultatif',
        blocking: true,
        links: [
          { kind: 'pr', number: 1039 },
          { kind: 'issue', number: 1020 },
        ],
      },
    ]);
  });

  it('applique les valeurs par défaut des champs facultatifs', () => {
    const [d] = parseDecisionBlocks(minimal()).decisions;
    expect(d).toEqual({
      id: '1039-critere-reprise',
      kind: 'choix',
      question: 'Quel critère pour reprendre les mises en production sur staging ?',
      context: ['Les tests de bout en bout échouent environ 1 fois sur 10.'],
      options: [],
      reversible: true,
      topic: 'technique',
      freeText: 'facultatif',
      blocking: false,
      links: [],
    });
  });

  it('accepte les fins de ligne Windows et une option sans détail', () => {
    const text = minimal('option: ok | Fait, ça marche', 'option: ko | Pas encore').replace(/\n/g, '\r\n');
    const [d] = parseDecisionBlocks(text).decisions;
    expect(d.options).toEqual([
      { id: 'ok', label: 'Fait, ça marche' },
      { id: 'ko', label: 'Pas encore' },
    ]);
  });

  it("ignore un bloc de code d'une autre langue et le texte hors bloc", () => {
    const text = 'id: hors-bloc\n```ts\nid: dans-du-ts\n```\n' + minimal();
    const { decisions } = parseDecisionBlocks(text);
    expect(decisions.map((d) => d.id)).toEqual(['1039-critere-reprise']);
  });

  it('ne renvoie rien pour un texte sans bloc', () => {
    expect(parseDecisionBlocks('Rien à décider.')).toEqual({ decisions: [], errors: [], warnings: [] });
  });
});

describe('règle 1 : seules les lignes « clé: valeur » comptent', () => {
  it('ignore les lignes vides et les lignes sans clé', () => {
    const text = minimal('', 'Une phrase libre glissée dans le bloc.', '- puce', '  question: indentée, donc ignorée');
    const { decisions, errors } = parseDecisionBlocks(text);
    expect(errors).toEqual([]);
    expect(decisions).toHaveLength(1);
  });

  it('exige une espace après les deux-points', () => {
    const text = minimal('link:PR #1');
    const [d] = parseDecisionBlocks(text).decisions;
    expect(d.links).toEqual([]);
  });

  it('respecte la casse des clés (Question ≠ question)', () => {
    const text = block(
      'id: casse-cle',
      'Question: Majuscule',
      'context: x',
      'reversible: oui',
      'topic: produit',
    );
    const { decisions, errors, warnings } = parseDecisionBlocks(text);
    expect(decisions).toEqual([]);
    expect(errors).toEqual([{ id: 'casse-cle', reason: 'champ « question » absent' }]);
    expect(warnings).toEqual(['casse-cle : clé inconnue « Question » ignorée']);
  });
});

describe('règle 2 : clé inconnue ignorée mais signalée', () => {
  it('garde la décision et signale la clé', () => {
    const { decisions, warnings } = parseDecisionBlocks(minimal('deadline: vendredi'));
    expect(decisions).toHaveLength(1);
    expect(warnings).toEqual(['1039-critere-reprise : clé inconnue « deadline » ignorée']);
  });

  it("ne remplit pas askedAt, askedBy ni source depuis le bloc", () => {
    const { decisions, warnings } = parseDecisionBlocks(minimal('askedAt: 2026-01-01T00:00:00Z', 'source: pr'));
    expect(decisions[0]).not.toHaveProperty('askedAt');
    expect(decisions[0]).not.toHaveProperty('source');
    expect(warnings).toHaveLength(2);
  });
});

describe('règle 3 : clé unique répétée', () => {
  it.each(['id', 'kind', 'question', 'recommended', 'reversible', 'topic', 'freeText', 'blocking'])(
    'rend le bloc invalide si « %s » est répétée',
    (key) => {
      const values: Record<string, string> = {
        id: '1039-critere-reprise',
        kind: 'choix',
        question: 'Autre question ?',
        recommended: 'oui',
        reversible: 'oui',
        topic: 'technique',
        freeText: 'non',
        blocking: 'non',
      };
      const extra = key === 'recommended' || key === 'kind' || key === 'freeText' || key === 'blocking'
        ? [`${key}: ${values[key]}`, `${key}: ${values[key]}`]
        : [`${key}: ${values[key]}`];
      const { decisions, errors } = parseDecisionBlocks(minimal(...extra));
      expect(decisions).toEqual([]);
      expect(errors).toEqual([{ id: '1039-critere-reprise', reason: `clé « ${key} » répétée` }]);
    },
  );

  it('accepte la répétition de context, option et link', () => {
    const text = minimal(
      'context: Deuxième ligne.',
      'option: a | A',
      'option: b | B',
      'link: PR #1',
      'link: issue #2',
    );
    expect(parseDecisionBlocks(text).errors).toEqual([]);
  });
});

describe('règle 4 : bloc invalide, jamais transformé en décision', () => {
  const invalid = (text: string) => {
    const { decisions, errors } = parseDecisionBlocks(text);
    expect(decisions).toEqual([]);
    expect(errors).toHaveLength(1);
    return errors[0];
  };

  it.each([
    ['id', 'champ « id » absent'],
    ['question', 'champ « question » absent'],
    ['context', 'champ « context » absent'],
    ['reversible', 'champ « reversible » absent'],
    ['topic', 'champ « topic » absent'],
  ])('champ obligatoire « %s » absent', (key, reason) => {
    const lines = minimal()
      .split('\n')
      .filter((l) => !l.startsWith(`${key}: `));
    expect(invalid(lines.join('\n')).reason).toBe(reason);
  });

  it('valeur vide = champ absent', () => {
    expect(invalid(minimal().replace(/^topic: .*$/m, 'topic: ')).reason).toBe('champ « topic » absent');
  });

  it('identifiant hors du format [a-z0-9-]{3,60}', () => {
    for (const id of ['ab', 'Avec-Majuscule', 'avec_souligne', 'x'.repeat(61)]) {
      const e = invalid(minimal().replace('id: 1039-critere-reprise', `id: ${id}`));
      expect(e.reason).toBe('« id » doit faire 3 à 60 caractères parmi a-z, 0-9 et -');
      expect(e).not.toHaveProperty('id');
    }
  });

  it('question de plus de 140 caractères', () => {
    const ok = minimal().replace(/^question: .*$/m, `question: ${'é'.repeat(140)}`);
    expect(parseDecisionBlocks(ok).errors).toEqual([]);
    const ko = minimal().replace(/^question: .*$/m, `question: ${'é'.repeat(141)}`);
    expect(invalid(ko).reason).toBe('« question » dépasse 140 caractères');
  });

  it('plus de 2 lignes de contexte, ou une ligne de plus de 160 caractères', () => {
    expect(invalid(minimal('context: 2', 'context: 3')).reason).toBe('« context » : 2 lignes au plus');
    const long = minimal().replace(/^context: .*$/m, `context: ${'a'.repeat(161)}`);
    expect(invalid(long).reason).toBe('« context » : une ligne dépasse 160 caractères');
  });

  it('une seule option, ou plus de 5', () => {
    expect(invalid(minimal('option: a | A')).reason).toBe('« option » : 2 à 5 options');
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((o) => `option: ${o} | ${o.toUpperCase()}`);
    expect(invalid(minimal(...six)).reason).toBe('« option » : 2 à 5 options');
    expect(parseDecisionBlocks(minimal(...six.slice(0, 5))).errors).toEqual([]);
  });

  it('option mal formée', () => {
    expect(invalid(minimal('option: seul-id', 'option: b | B')).reason).toBe(
      '« option » : écrire « id | libellé | détail »',
    );
    expect(invalid(minimal('option: a | A | détail | en trop', 'option: b | B')).reason).toBe(
      '« option » : écrire « id | libellé | détail »',
    );
    expect(invalid(minimal('option: A_1 | A', 'option: b | B')).reason).toBe(
      '« option » : identifiant hors du format [a-z0-9-]{1,20}',
    );
    expect(invalid(minimal(`option: a | ${'l'.repeat(61)}`, 'option: b | B')).reason).toBe(
      '« option » : libellé de plus de 60 caractères',
    );
    expect(invalid(minimal(`option: a | A | ${'d'.repeat(101)}`, 'option: b | B')).reason).toBe(
      '« option » : détail de plus de 100 caractères',
    );
    expect(invalid(minimal('option: a | A', 'option: a | B')).reason).toBe('« option » : identifiant en double');
    expect(invalid(minimal('option: a |  ', 'option: b | B')).reason).toBe(
      '« option » : écrire « id | libellé | détail »',
    );
  });

  it('recommended hors des options', () => {
    expect(invalid(minimal('option: a | A', 'option: b | B', 'recommended: c')).reason).toBe(
      '« recommended » ne fait pas partie des options',
    );
  });

  it('sans options, recommended se compare aux options implicites oui/non', () => {
    expect(parseDecisionBlocks(minimal('recommended: oui')).decisions[0].recommended).toBe('oui');
    expect(invalid(minimal('recommended: peut-etre')).reason).toBe(
      '« recommended » ne fait pas partie des options',
    );
  });

  it.each([
    ['kind', 'kind: question', '« kind » : choix, action ou validation'],
    ['reversible', 'reversible: peut-être', '« reversible » : oui ou non'],
    ['topic', 'topic: sante', '« topic » : securite, argent, donnees, legal, produit ou technique'],
    ['freeText', 'freeText: oui', '« freeText » : non, facultatif ou obligatoire'],
    ['blocking', 'blocking: true', '« blocking » : oui ou non'],
    ['link', 'link: https://github.com/GabinSMD/Vigie/pull/3', '« link » : écrire « PR #n » ou « issue #n »'],
  ])('valeur interdite pour « %s »', (key, line, reason) => {
    const base = key === 'reversible' || key === 'topic' ? minimal().replace(new RegExp(`^${key}: .*$`, 'm'), line) : minimal(line);
    expect(invalid(base).reason).toBe(reason);
  });

  it('accepte reversible: non et chaque topic', () => {
    for (const topic of ['securite', 'argent', 'donnees', 'legal', 'produit', 'technique']) {
      const text = minimal().replace('reversible: oui', 'reversible: non').replace('topic: technique', `topic: ${topic}`);
      const [d] = parseDecisionBlocks(text).decisions;
      expect(d.reversible).toBe(false);
      expect(d.topic).toBe(topic);
    }
  });

  it("signale un bloc jamais fermé au lieu de l'ignorer", () => {
    const text = minimal().replace(/```$/, '');
    expect(invalid(text).reason).toBe('bloc jamais fermé (```)');
  });
});

describe('règle 5 : plusieurs blocs dans un même texte', () => {
  it('chaque bloc est une décision, dans l\'ordre du texte', () => {
    const second = minimal().replace('1039-critere-reprise', '1033-test-android');
    const { decisions } = parseDecisionBlocks(`${minimal()}\n\nEntre les deux.\n\n${second}`);
    expect(decisions.map((d) => d.id)).toEqual(['1039-critere-reprise', '1033-test-android']);
  });

  it('même id deux fois : le dernier gagne', () => {
    const premier = minimal();
    const dernier = minimal().replace('topic: technique', 'topic: produit');
    const { decisions } = parseDecisionBlocks(`${premier}\n${dernier}`);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].topic).toBe('produit');
  });

  it('même id deux fois, le dernier invalide : aucune décision, seulement l\'erreur', () => {
    // L'agent a remplacé ses options : Gabin ne doit pas répondre aux anciennes.
    const premier = minimal('option: a | A', 'option: b | B');
    const dernier = minimal('option: a | A', 'option: c | C', 'recommended: z');
    const { decisions, errors } = parseDecisionBlocks(`${premier}\n${dernier}`);
    expect(decisions).toEqual([]);
    expect(errors).toEqual([{ id: '1039-critere-reprise', reason: '« recommended » ne fait pas partie des options' }]);
  });

  it('un bloc valide après un bloc invalide de même id redevient la décision', () => {
    const casse = minimal('recommended: z');
    const { decisions, errors } = parseDecisionBlocks(`${casse}\n${minimal()}`);
    expect(decisions.map((d) => d.id)).toEqual(['1039-critere-reprise']);
    expect(errors).toHaveLength(1);
  });

  it("un bloc invalide n'empêche pas de lire les autres", () => {
    const casse = block('id: casse', 'question: ?');
    const { decisions, errors } = parseDecisionBlocks(`${casse}\n${minimal()}`);
    expect(decisions.map((d) => d.id)).toEqual(['1039-critere-reprise']);
    expect(errors).toEqual([{ id: 'casse', reason: 'champ « context » absent' }]);
  });
});

describe('règle 6 : jamais de secret ni de lien de session', () => {
  it.each([
    ['jeton GitHub classique', 'context: Le jeton ghp_aBcD1234 ne marche plus.'],
    ['jeton GitHub fin', 'context: github_pat_11ABCDEF'],
    ['jeton OAuth GitHub', 'context: gho_abc'],
    ['clé OpenAI', 'context: Pose sk-proj-abc dans le fichier.'],
    ['clé Stripe', 'option: a | sk_live_123 | x'],
    ['jeton Slack', 'context: xoxb-123-456'],
    ['clé AWS', 'context: AKIAIOSFODNN7EXAMPLE'],
    ['clé privée', 'context: -----BEGIN OPENSSH PRIVATE KEY-----'],
    ['longue chaîne lettres et chiffres', 'context: a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7'],
    ['password=', 'context: password=hunter2'],
    ['motdepasse=', 'context: motdepasse = soleil'],
    ['token=', 'context: TOKEN=abc'],
    ['clé secrète AWS en base64 avec /', 'context: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    ['chaîne base64 coupée par /', 'context: Zm9vYmFyYmF6cXV4/Zm9vYmFyYmF6cXV4Zm9v1'],
    ['chaîne base64url avec -', 'context: Zm9vYmFy-YmF6cXV4_Zm9vYmFy-YmF6cXV4Zm9v'],
    ['jeton GitHub de serveur', 'context: ghs_abc'],
    ['jeton GitHub utilisateur', 'context: ghu_abc'],
    ['jeton GitHub de rafraîchissement', 'context: ghr_abc'],
    ['jeton GitLab', 'context: glpat-abcdEFGH1234'],
    ['clé Google', 'context: AIzaSyFAKEfakeFAKEfake'],
    ['clé AWS temporaire', 'context: ASIAIOSFODNN7EXAMPLE'],
    ['password:', 'context: password: hunter2'],
    ['"password": en JSON', 'context: {"password": "hunter2"}'],
    ['mot de passe =', 'context: mot de passe = soleil'],
    ['passwd=', 'context: passwd=soleil'],
    ['pwd=', 'context: pwd=soleil'],
    ['secret=', 'context: secret=soleil'],
    ['api_key=', 'context: api_key=soleil'],
    ['apikey=', 'context: APIKEY=soleil'],
    ['identifiants dans une URL', 'context: postgres://vigie:soleil@db.example/vigie'],
    ['identifiants dans une URL https', 'context: https://vigie:soleil@example.org'],
    ['webhook Slack', 'context: https://hooks.slack.com/services/T000/B000/XXXX'],
    ['webhook Discord', 'context: https://discord.com/api/webhooks/123/abc'],
    ['jeton en pleine chasse', 'context: ｇｈｐ＿abc'],
    ['accessToken=', 'context: accessToken=abc'],
    ['authtoken =', 'context: authtoken = x'],
    ['dbPassword=', 'context: dbPassword=x'],
    ['"accessToken": en JSON', 'context: {"accessToken": "abc"}'],
    ['"clientSecret": en JSON', 'context: {"clientSecret": "x"}'],
    ['clientSecret:', 'context: clientSecret: x'],
    ['"password" : avec espace', 'context: {"password" : "x"}'],
    ['secret dans une adresse GitHub', 'context: https://github.com/foo/wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    ['clé inconnue', 'note: ghp_cache-dans-une-cle-inconnue'],
    ['ligne sans clé', 'Une ligne libre avec ghp_xyz'],
  ])('refuse un bloc qui contient un %s', (_nom, line) => {
    const { decisions, errors, warnings } = parseDecisionBlocks(minimal(line));
    expect(decisions).toEqual([]);
    expect(errors).toEqual([{ id: '1039-critere-reprise', reason: 'ressemble à un secret' }]);
    // Le secret n'est jamais recopié, ni dans l'erreur, ni dans les avertissements.
    expect(JSON.stringify({ errors, warnings })).not.toMatch(/gh[pousr]_|ｇｈｐ|glpat|AIza|sk-|xox|AKIA|ASIA|BEGIN|hunter|soleil|=abc|EXAMPLE|Zm9v|hooks|webhooks/i);
  });

  it("ne recopie pas l'id si c'est lui qui ressemble à un secret", () => {
    const text = minimal().replace('id: 1039-critere-reprise', 'id: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7');
    const { errors } = parseDecisionBlocks(text);
    expect(errors).toEqual([{ reason: 'ressemble à un secret' }]);
  });

  it('refuse un lien de session claude.ai', () => {
    const { errors } = parseDecisionBlocks(minimal('context: Voir https://claude.ai/code/session_01ABC'));
    expect(errors).toEqual([{ id: '1039-critere-reprise', reason: 'contient un lien de session claude.ai' }]);
  });
});

describe('blocs cités dans un bloc englobant', () => {
  it("ignore un bloc decision cité dans un bloc ````markdown (exemple dans une issue ou une PR)", () => {
    const text = `Voici la forme à suivre :\n\n\`\`\`\`markdown\n${minimal()}\n\`\`\`\`\n`;
    expect(parseDecisionBlocks(text)).toEqual({ decisions: [], errors: [], warnings: [] });
  });

  it('ignore aussi un bloc cité dans ~~~, dans un bloc sans langue, ou dans un bloc englobant jamais fermé', () => {
    for (const text of [
      `~~~text\n${minimal()}\n~~~`,
      `\`\`\`\`\n${minimal()}\n\`\`\`\``,
      `\`\`\`\`\`markdown\n\`\`\`\`markdown\n${minimal()}\n\`\`\`\`\n\`\`\`\`\``,
      `\`\`\`\`markdown\n${minimal()}\n`,
    ]) {
      expect(parseDecisionBlocks(text).decisions).toEqual([]);
      expect(parseDecisionBlocks(text).errors).toEqual([]);
    }
  });

  it('lit le bloc qui suit un bloc de code ordinaire fermé', () => {
    const text = `\`\`\`ts\nconst a = 1;\n\`\`\`\n\n${minimal()}`;
    expect(parseDecisionBlocks(text).decisions.map((d) => d.id)).toEqual(['1039-critere-reprise']);
  });

  it("une ligne de code qui commence par ``` suivi d'autres ``` n'ouvre pas de bloc", () => {
    const text = `\`\`\`\` \`\`\`decision \`\`\`\`\n\n${minimal()}`;
    expect(parseDecisionBlocks(text).decisions.map((d) => d.id)).toEqual(['1039-critere-reprise']);
  });

  it('extractFencedBlocks rend les blocs de premier niveau avec leur langue', () => {
    const text = `avant\n\`\`\`\`markdown\n${minimal()}\n\`\`\`\`\n~~~ json\n{}\n~~~`;
    const blocks = extractFencedBlocks(text);
    expect(blocks.map((b) => b.info)).toEqual(['markdown', 'json']);
    expect(blocks[0].lines.join('\n')).toBe(minimal());
    expect(blocks.every((b) => !b.unclosed)).toBe(true);
  });
});

describe('looksLikeSecret', () => {
  it.each([
    'La PR #1039 reste en brouillon.',
    'Pose la clé Stripe dans le fichier prévu sur penny.',
    'Un risk-free test, task-force, desk-top.',
    'https://github.com/SIMOND-ANCE-BROS/FFD-Connect/pull/1039',
    'Le mot de passe est dans le trousseau.',
    '2026-11-26T09:12:00Z',
    'abcdefghijklmnopqrstuvwxyzabcdefghij',
    'https://github.com/GabinSMD/Vigie/pull/1039',
    'Voir https://github.com/SIMOND-ANCE-BROS/FFD-Connect/blob/main/docs/specs/en-attente-de-reponse.md',
    'docs/specs/en-attente-de-reponse.md et docs/conception-donnees-reelles.md',
    'src/components/DecisionCard.tsx',
    'id: 1039-critere-reprise-pour-les-mises-en-production-sur-staging',
    'Où poser le secret : dans le fichier prévu sur penny.',
    'Le token GitHub a expiré, le pilote attend le nouveau fichier.',
    'Une ASIA-PACIFIC, un AKIA court.',
    'Voir https://github.com/SIMOND-ANCE-BROS/FFD-Connect/pull/1039.',
    '(https://github.com/SIMOND-ANCE-BROS/FFD-Connect/issues/1020)',
    'https://github.com/SIMOND-ANCE-BROS/FFD-Connect/tree/feat/22-decision-type-parser',
    'https://github.com/GabinSMD/Vigie/blob/main/src/components/DecisionCard.tsx',
    '12345678901234567890123456789012345',
    'Corrigé par le commit 6298356c1f2a4b7e9d0c3a8b5e1f4d2c7a9b0e3f.',
    'https://github.com/GabinSMD/Vigie/commit/6298356c1f2a4b7e9d0c3a8b5e1f4d2c7a9b0e3f',
    'Entre 6298356c1f2a4b7e9d0c3a8b5e1f4d2c7a9b0e3f et 313129e0a1b2c3d4e5f60718293a4b5c6d7e8f90',
  ])('laisse passer « %s »', (text) => {
    expect(looksLikeSecret(text)).toBe(false);
  });

  it.each([
    ['hexadécimal de 41 caractères', '6298356c1f2a4b7e9d0c3a8b5e1f4d2c7a9b0e3f0'],
    ['hexadécimal de 39 caractères', '6298356c1f2a4b7e9d0c3a8b5e1f4d2c7a9b0e3'],
    ['hexadécimal de 64 caractères', '6298356c1f2a4b7e9d0c3a8b5e1f4d2c7a9b0e3f6298356c1f2a4b7e9d0c3a8b'],
    ['SHA en majuscules', '6298356C1F2A4B7E9D0C3A8B5E1F4D2C7A9B0E3F'],
    ['SHA collé à un suffixe', '6298356c1f2a4b7e9d0c3a8b5e1f4d2c7a9b0e3f_x'],
    ['SHA collé à un préfixe', 'x6298356c1f2a4b7e9d0c3a8b5e1f4d2c7a9b0e3f'],
    ['SHA suivi de =', '6298356c1f2a4b7e9d0c3a8b5e1f4d2c7a9b0e3f=='],
    ['40 caractères hors hexadécimal', '6298356c1f2a4b7e9d0c3a8b5e1f4d2c7a9b0z3f'],
    ['affectation', 'token=6298356c1f2a4b7e9d0c3a8b5e1f4d2c7a9b0e3f'],
    ['secret après une adresse de commit', 'https://github.com/foo/bar/commit/6298356c1f2a4b7e9d0c3a8b5e1f4d2c7a9b0e3f/wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY'],
    ['commit de 41 caractères dans une adresse', 'https://github.com/GabinSMD/Vigie/commit/6298356c1f2a4b7e9d0c3a8b5e1f4d2c7a9b0e3f0'],
  ])('refuse un %s', (_nom, text) => {
    expect(looksLikeSecret(text)).toBe(true);
  });

  it.each([
    ['lettres', 'x'.repeat(200_000)],
    ['mots-clés', 'token'.repeat(40_000)],
    ['adresse', 'a://' + 'b'.repeat(200_000)],
    ['points', 'https://github.com/' + '.'.repeat(200_000) + 'a'],
  ])('reste linéaire sur 200 000 caractères (%s)', (_nom, text) => {
    const start = performance.now();
    looksLikeSecret(text);
    // Une expression quadratique y passerait plusieurs dizaines de secondes.
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('toSnapshotQuestion : forme JSON de l\'instantané (§ 2.3)', () => {
  it("reproduit l'exemple JSON de la spécification", () => {
    const [d] = parseDecisionBlocks(EXEMPLE_1039).decisions;
    expect(toSnapshotQuestion(d, '2026-11-26T09:12:00Z')).toEqual({
      id: '1039-critere-reprise',
      title: 'Quel critère pour reprendre les mises en production sur staging ?',
      detail: 'Les tests de bout en bout échouent environ 1 fois sur 10 sur staging depuis le 20/11.',
      prRef: '#1039',
      kind: 'choix',
      context: [
        'Les tests de bout en bout échouent environ 1 fois sur 10 sur staging depuis le 20/11.',
        "La PR #1039 reste en brouillon tant que le critère n'est pas fixé.",
      ],
      options: [
        { id: 'trois-verts', label: "3 passages verts d'affilée", detail: "Simple, déjà outillé, prêt aujourd'hui" },
        { id: 'taux', label: "Moins de 2 % d'échecs sur 50 passages", detail: 'Plus sûr, environ une journée de plus' },
        { id: 'manuel', label: 'Tu décides à chaque fois', detail: 'Aucun automatisme' },
      ],
      recommended: 'trois-verts',
      reversible: true,
      topic: 'technique',
      freeText: 'facultatif',
      links: [
        { kind: 'pr', number: 1039 },
        { kind: 'issue', number: 1020 },
      ],
      blocking: true,
      askedAt: '2026-11-26T09:12:00Z',
    });
  });

  it('sans options, reste une question oui/non (pas de champ options)', () => {
    const [d] = parseDecisionBlocks(minimal('link: issue #12')).decisions;
    const q = toSnapshotQuestion(d);
    expect(q).not.toHaveProperty('options');
    expect(q).not.toHaveProperty('recommended');
    expect(q).not.toHaveProperty('askedAt');
    expect(q.prRef).toBe('#12');
  });

  it('prRef vide sans aucun lien', () => {
    const [d] = parseDecisionBlocks(minimal()).decisions;
    expect(toSnapshotQuestion(d).prRef).toBe('');
  });
});

describe('toDecision : forme normalisée partagée (§ 2.4)', () => {
  const origin = {
    projectId: 'ffd-connect',
    askedAt: '2026-11-26T09:12:00Z',
    askedBy: { kind: 'session', id: 'session_01ABC' } as const,
    source: 'session' as const,
  };

  it('déplie les options implicites oui/non', () => {
    const [d] = parseDecisionBlocks(minimal()).decisions;
    expect(toDecision(d, origin).options).toEqual([
      { id: 'oui', label: 'Oui' },
      { id: 'non', label: 'Non' },
    ]);
  });

  it('garde les options écrites et ajoute la provenance', () => {
    const [d] = parseDecisionBlocks(EXEMPLE_1039).decisions;
    const decision = toDecision(d, origin);
    expect(decision.options.map((o) => o.id)).toEqual(['trois-verts', 'taux', 'manuel']);
    expect(decision).toMatchObject(origin);
    expect(decision).not.toHaveProperty('answer');
  });
});

describe('exemples de la documentation', () => {
  const read = (path: string) => readFileSync(new URL(`../../docs/${path}`, import.meta.url), 'utf8');

  it.each([
    ['regle-emission-decision.md', ['1039-critere-reprise', '1033-test-android', '1031-cle-github-app', '204-limite-coupe']],
    ['specs/en-attente-de-reponse.md', ['1039-critere-reprise', '1033-test-android']],
  ])('chaque bloc de %s est valide', (path, ids) => {
    // Les exemples sont cités dans des blocs ````markdown, que l'analyseur ignore : on lit leur contenu.
    const quoted = (text: string): string[] =>
      extractFencedBlocks(text)
        .filter((b) => b.info === 'markdown')
        .flatMap((b) => [b.lines.join('\n'), ...quoted(b.lines.join('\n'))]);
    expect(parseDecisionBlocks(read(path)).decisions).toEqual([]);
    const results = quoted(read(path)).map(parseDecisionBlocks);
    expect(results.flatMap((r) => r.errors)).toEqual([]);
    expect(results.flatMap((r) => r.warnings)).toEqual([]);
    expect(results.flatMap((r) => r.decisions.map((d) => d.id))).toEqual(ids);
  });
});
