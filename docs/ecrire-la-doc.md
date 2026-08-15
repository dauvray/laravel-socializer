# Écrire la doc

> **À quoi ça sert :** la convention documentaire du package — quoi écrire, où, et sous quelle
> forme.
> **Quand le lire :** avant d'ajouter un `.md`, et quand un chantier se termine.

---

## Deux règles

> ### 1. Une case à cocher ⇒ le fichier appartient à `work/`.
> `docs/` décrit ce qui **est**. `work/` décrit ce qui **reste à faire**. Un fichier qui contient
> `- [ ]` ou `- [x]` est un fichier de suivi, quelle que soit la qualité de son contenu.

> ### 2. Aucun chiffre volatil dans `docs/`.
> Décomptes de tests, nombres d'occurrences, pourcentages d'avancement, tailles de fichiers. Ils
> se relisent dans la sortie de l'outil ; recopiés, ils pourrissent en quelques jours.

Ces deux règles ne sont pas théoriques. Avant cette réorganisation, le rationale durable du module
WebRTC2 était enfoui dans une todolist de 69 Ko, et le même décompte de tests figurait à **trois
valeurs différentes** dans trois fichiers datés du même jour.

---

## Ce qui mérite d'être écrit

Le critère unique : **est-ce déductible du code ?** Si oui, ne pas l'écrire — le code bougera, la
doc non.

Ce qui n'est pas déductible, et qui vaut de l'or :

- **Pourquoi** une chose est faite ainsi et pas autrement — surtout quand l'autre façon semble
  meilleure au premier regard
- **Les pièges à ne PAS « optimiser »** : un `setTimeout(1000)` qui compense un chargement d'image,
  une garde qui a l'air redondante et qui ferme une fenêtre réelle
- **Les extractions écartées** et leur raison — sans quoi quelqu'un les refera
- **Les deltas assumés** : ce qui a changé de comportement en corrigeant, et pourquoi c'est
  acceptable
- **Les causes racines déjà vues** pour un symptôme récurrent — c'est ce qui évite de rechasser
- **Les invariants d'un harnais de test** : ce qui rendrait un test vert pour la mauvaise raison
- **Les non-symptômes** : « ceci ne peut pas arriver, voici pourquoi » — écrits pour qu'on ne les
  rechasse pas

Le modèle interne le plus abouti est [modules/chat.md](modules/chat.md), avec ses sections
*Invariants à préserver* / *Pièges à ne PAS « optimiser »* / *Extractions écartées*.

---

## Où ça va

```
docs/
├── INDEX.md                 routage par intention — toute nouvelle doc s'y inscrit
├── ecrire-la-doc.md         ce fichier
├── architecture/            transverse au package
├── modules/                 un module = un fichier, ou un dossier s'il déborde
└── reference/               API d'un composable partagé : signature, options, exemples

work/                        todo, audits, plans de tests, notes de chantier
```

**`docs/` ne contient pas de dates de session, pas de « fait le … », pas de nom de branche.**
L'historique est dans git. Un fichier de `docs/` doit rester vrai sans être mis à jour à chaque
commit.

---

## Modèle d'une doc de module

Un module simple tient dans **un seul `.md`** sous `docs/modules/`. N'éclater en dossier que quand
les **publics divergent** (intégrateur vs mainteneur vs qui écrit un test) — pas sur un seuil de
lignes.

Le vrai critère est la **scannabilité** : au-delà de ~200 lignes, ajouter un sommaire d'ancres en
tête. Un fichier long mais navigable vaut mieux que trois fichiers qui obligent à sauter pour
comprendre une seule règle. `modules/webrtc2/architecture.md` et `reference/use-reverb-channel.md`
dépassent tous deux le seuil, délibérément : découper le premier séparerait l'ordre des couches de
la table des propriétaires, et le second est une référence d'API qu'on lit par section.

Éclaté, le découpage est celui de [WebRTC2](modules/webrtc2/INDEX.md) :

| Fichier | Contenu | Public |
|---|---|---|
| `INDEX.md` | ce que fait le module, arborescence commentée, table « où lire quoi » | tout le monde |
| `api.md` | ce qu'on monte/importe, props, prérequis d'environnement, config | intégrateur |
| `flux.md` | les séquences de bout en bout + les causes racines déjà vues | débug |
| `architecture.md` | couches, propriétaires d'état, invariants, conventions locales | mainteneur |
| `securite.md` | modèle de confiance, décisions, périmètre réel | selon besoin |
| `tests.md` | harnais, invariants du mock, pièges | qui écrit un test |

**N'écrire un fichier que s'il a du contenu.** Cinq fichiers dont trois vides valent moins qu'un
seul dense.

---

## En-tête obligatoire

Chaque fichier de `docs/` s'ouvre sur deux lignes qui disent à qui il parle :

```markdown
# Titre

> **À quoi ça sert :** une phrase.
> **Quand le lire :** le déclencheur concret.
```

C'est ce qui permet de router sans ouvrir le fichier.

---

## Une règle, un seul endroit

Un contenu écrit à deux endroits diverge — c'est une certitude, pas un risque. Écrire la règle là où
elle appartient et **lier** depuis les autres, par chemin relatif.

Répartition en vigueur : conventions transverses dans `architecture/conventions.md`, conventions
d'un module dans son `architecture.md` ; infra de tests dans `architecture/tests.md`, harnais d'un
module dans son `tests.md`.

---

## Quand un chantier se termine

C'est le moment où la doc se dégrade si on ne fait rien. Le geste :

1. **Extraire le durable** du fichier de `work/` — le pourquoi, les pièges, les deltas assumés — et
   le remonter dans le `docs/` concerné.
2. **Supprimer** les cases à cocher, les décomptes et le récit chronologique. Ils sont dans git.
3. **Supprimer le fichier de `work/`** s'il ne reste rien, et retirer sa ligne de `work/README.md`.

C'est exactement ce qu'a fait le chantier Chat : todolist retirée une fois terminée, seul le
rationale conservé.

---

## Quand un chantier commence

Créer le fichier dans `work/`, l'inscrire dans `work/README.md` avec une phrase d'état, et y écrire
sans retenue : cases à cocher, chiffres, dates, commits pré-rédigés, graphes de dépendances. C'est
fait pour ça.

Ce qui n'a **pas** sa place dans `work/` : une règle générale qui vaudra encore après le chantier.
Celle-là va directement dans `docs/`, même si le chantier n'est pas fini.
