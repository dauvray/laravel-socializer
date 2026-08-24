<?php

namespace Dauvray\Socializer\Tests\Feature\Channels;

use Dauvray\Socializer\app\Http\Resources\PresenceUser;
use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;

/**
 * E4.1 — les gardes de canal Reverb refusent par défaut.
 *
 * Deux défauts qui n'en faisaient qu'un. `canJoinchatRoom` employait un `OPTIONAL MATCH` porteur
 * d'un `WHERE` — que NebulaGraph 3.8 **refuse** : « SyntaxError: Where clause in optional match is
 * not supported ». La requête ne s'exécutait donc JAMAIS. Et comme les trois `canJoin*` se
 * contentaient d'un `if($result)` alors qu'`execute()` ne lève pas en LECTURE — sur erreur nGQL il
 * rend un `JsonResponse`, un objet donc truthy —, cette erreur permanente valait **autorisation
 * permanente**. Le garde n'a jamais fonctionné : `channels.php` n'autorisant `chat.{chatId}` que
 * par lui, tout authentifié pouvait s'abonner à n'importe quelle conversation privée.
 *
 * Le refus par défaut n'est donc pas une ceinture de sécurité ajoutée à côté du correctif : c'est
 * le correctif. Contre-épreuve du 21/08/2026 contre le cluster de dev — les quatre branches de la
 * requête réécrite (privé/membre, privé/intrus, public/intrus, public sans membre) rendent bien
 * 1, 0, 1 et 0 lignes.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. `FakeNebulaGraph` fait du `str_contains` sur le nGQL, il
 * ne le PARSE pas. Aucun test ici ne distingue « chat public » de « membre d'un chat privé » :
 * les deux se réduisent à « le graphe a rendu au moins une ligne ». Et le passage
 * `OPTIONAL MATCH` → `MATCH` n'est pas observable par le verdict — d'où le premier test, qui
 * asserte le TEXTE de la requête faute de pouvoir l'évaluer. La sémantique réelle se
 * contre-vérifie contre un vrai NebulaGraph.
 *
 * Ce que ce fichier prouve : le verdict (au moins une ligne ⇒ oui, zéro ligne ⇒ non, pas de
 * réponse ⇒ non ET journal), et le CÂBLAGE — que les callbacks de `channels.php` appellent bien
 * ces gardes, et qu'ils refusent au lieu de lever quand le graphe tombe.
 *
 * ⚠️ Ce dernier point est devenu load-bearing avec E7 (22/08/2026), qui fait LEVER les 6 méthodes
 * d'écriture DML. Les lectures, elles, sont restées non-levantes exactement pour que ce fichier
 * continue de décrire la production : l'étendre aux lectures rendrait les branches `is_array()`
 * inatteignables et transformerait chaque refus en 500 — sans rougir ici, puisque la doublure
 * scripte un `JsonResponse`. C'est `NebulaGraphSeamTest` qui garde cette frontière.
 */
class ChannelGuardTest extends TestCase
{
    /**
     * Les trois gardes de canal, pour les cas de verdict qui leur sont communs.
     *
     * @return array<string, array{0: string}>
     */
    public static function gardesDeCanal(): array
    {
        return [
            'chat' => ['canJoinchatRoom'],
            'room' => ['canJoinRoom'],
            'server' => ['canJoinServer'],
        ];
    }

    /**
     * Les deux canaux gardés par `canJoinRoom() || isCreator()` — jumeaux exacts.
     *
     * @return array<string, array{0: string}>
     */
    public static function canauxDeSalon(): array
    {
        return [
            'room' => ['room.{roomId}'],
            'questionnaire' => ['questionnaire.{roomId}'],
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | 1. `canJoinchatRoom` — le 🔴
    |--------------------------------------------------------------------------
    */

    /**
     * Le seul test qui garde le correctif nGQL, et il asserte du TEXTE.
     *
     * Assumé, et c'est le cas d'école de la limite du harnais : la doublure ne PARSE pas le nGQL,
     * donc elle ne peut pas refuser ce que le vrai graphe refuse. Un `OPTIONAL MATCH` porteur
     * d'un `WHERE` est une erreur de syntaxe pour NebulaGraph 3.8 ; ici il passerait au vert.
     * Asserter le texte est la seule prise disponible. Précédent maison — `RelationGuardTest`
     * asserte déjà sur `queries()`.
     *
     * Le fragment `c.chat.privacy` est choisi parce qu'il SURVIT au retour de `OPTIONAL` : le
     * contrôle de harnais doit rougir sur ce test, pas sur un stub qui ne matcherait plus.
     */
    #[Test]
    public function le_garde_de_chat_n_emploie_plus_d_optional_match(): void
    {
        $graph = $this->fakeNebulaGraph()->when('c.chat.privacy', []);

        $this->makeChannelUser('achille')->canJoinchatRoom('chat42');

        $this->assertNotEmpty($graph->queries());
        $this->assertStringNotContainsString('OPTIONAL MATCH', $graph->queries()[0]);
        $this->assertStringContainsString('MATCH (c:chat)<-[:registered_in]-(u:user)', $graph->queries()[0]);
    }

    /**
     * Durcissement, et non reproduction du 🔴 : la panne historique passait par le chemin
     * d'ERREUR (`SyntaxError` ⇒ `JsonResponse` truthy), épinglé plus bas par les cas « graphe
     * muet ». Ici on couvre l'autre forme de non-réponse.
     *
     * Un `OPTIONAL MATCH` sans `WHERE` — donc syntaxiquement accepté — rend une ligne même sans
     * correspondance, dont la colonne vaut `null`. Le verdict porte donc sur les lignes
     * EXPLOITABLES et non sur leur nombre : une ligne à `null` n'est pas une appartenance. C'est
     * ce qui rend la garde robuste à la réintroduction d'un `OPTIONAL MATCH`, ici ou dans un
     * garde futur — la seule chose que le contrôle du texte de la requête ne couvre pas.
     */
    #[Test]
    public function une_ligne_fantome_ne_vaut_pas_une_autorisation(): void
    {
        $this->fakeNebulaGraph()->when('c.chat.privacy', [null]);

        $this->assertFalse($this->makeChannelUser('bertrand')->canJoinchatRoom('chat42'));
    }

    /**
     * ⚠️ Vert avant comme après le correctif : sur `[]`, l'ancien `if($result)` refusait déjà.
     * Il ne garde donc pas le 🔴 — c'est le test de la ligne fantôme ci-dessus qui le fait. Sa
     * valeur est ailleurs : il interdit qu'on « simplifie » le verdict en un `is_array` seul.
     */
    #[Test]
    public function un_chat_prive_dont_on_n_est_pas_membre_est_refuse(): void
    {
        // Zéro ligne : le graphe a répondu, et sa réponse est « personne ne correspond ».
        $this->fakeNebulaGraph()->when('c.chat.privacy', []);

        $this->assertFalse($this->makeChannelUser('bertille')->canJoinchatRoom('chat42'));
    }

    #[Test]
    public function un_membre_d_un_chat_prive_est_admis(): void
    {
        $this->fakeNebulaGraph()->when('c.chat.privacy', ['usercamille']);

        $this->assertTrue($this->makeChannelUser('camille')->canJoinchatRoom('chat42'));
    }

    /**
     * Le seul angle sous lequel le harnais distingue « public » de « membre ».
     *
     * Sur `privacy == 0` la clause est vraie pour n'importe quel `u` : le graphe remonte l'id
     * d'un inscrit quelconque, pas forcément le mien. Ce test interdit de « durcir » le garde en
     * prédicat d'appartenance — ce qui fermerait tous les chats de salon public.
     */
    #[Test]
    public function un_chat_public_est_ouvert_a_qui_n_y_est_pas_inscrit(): void
    {
        $this->fakeNebulaGraph()->when('c.chat.privacy', ['userdenise']);

        $this->assertTrue($this->makeChannelUser('eugene')->canJoinchatRoom('chat42'));
    }

    /*
    |--------------------------------------------------------------------------
    | 2. Le refus par défaut — les trois gardes
    |--------------------------------------------------------------------------
    */

    #[Test]
    #[DataProvider('gardesDeCanal')]
    public function les_trois_gardes_refusent_quand_le_graphe_ne_repond_pas(string $guard): void
    {
        $this->fakeNebulaGraph()->always($this->grapheMuet());

        $user = $this->makeChannelUser('fabienne'.strtolower($guard));

        Log::spy();

        $this->assertFalse($user->{$guard}('vertex42'));

        Log::shouldHaveReceived('warning')
            ->withArgs(function (string $message, array $context) use ($guard) {
                return ($context['guard'] ?? null) === $guard
                    && ($context['vertex_id'] ?? null) === 'vertex42'
                    && array_key_exists('user_vertexid', $context);
            })
            ->once();
    }

    /**
     * La moitié la plus facile à perdre du correctif : ne pas confondre un refus légitime avec
     * une panne.
     *
     * Ces requêtes rendent `id(u)` PAR LIGNE, pas un agrégat : zéro ligne est une réponse, et
     * elle veut dire non. Journaliser un `warning` à chaque refus normal ferait crier le journal
     * en continu — donc ne signalerait plus rien.
     */
    #[Test]
    #[DataProvider('gardesDeCanal')]
    public function un_refus_ordinaire_ne_journalise_rien(string $guard): void
    {
        $this->fakeNebulaGraph()->always([]);

        $user = $this->makeChannelUser('gaspard'.strtolower($guard));

        Log::spy();

        $this->assertFalse($user->{$guard}('vertex42'));

        Log::shouldNotHaveReceived('warning');
    }

    /*
    |--------------------------------------------------------------------------
    | 3. Le câblage réel de `channels.php`
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function les_cinq_canaux_sont_enregistres(): void
    {
        $this->assertEqualsCanonicalizing(
            [
                'App.Models.User.{userId}',
                'chat.{chatId}',
                'room.{roomId}',
                'server.{serverId}',
                'questionnaire.{roomId}',
            ],
            Broadcast::getChannels()->keys()->all()
        );
    }

    /**
     * `(bool)` et non `assertNull` : les closures de `channels.php` n'ont pas de `return false`
     * explicite, elles tombent sur un `null` implicite — et `verifyUserCanAccessChannel` refuse
     * sur TOUT falsy. Le test garde la propriété, pas la forme exacte du falsy.
     */
    #[Test]
    public function le_canal_de_chat_refuse_un_chat_prive_dont_on_n_est_pas_membre(): void
    {
        $this->fakeNebulaGraph()->when('c.chat.privacy', []);

        $refus = $this->joinChannel('chat.{chatId}', $this->makeChannelUser('hortense'), 'chat42');

        $this->assertFalse((bool) $refus);
    }

    /**
     * Ce fichier garde le VERDICT ; la charge utile de l'admission est gardée par
     * `PresencePayloadTest` — qui, lui, la sérialise (E8).
     *
     * ⚠️ C'est `UserResource` qui ne pouvait pas être sérialisée ici : elle construit la
     * ressource d'estarter et appelle le helper `revealIdentifier()`, ni l'une ni l'autre
     * présente dans le harnais. `PresenceUser` ne fait ni l'un ni l'autre — c'est même sa raison
     * d'être. Ne pas revenir à `UserResource` sur un canal de présence.
     */
    #[Test]
    public function le_canal_de_chat_admet_un_membre_d_un_chat_prive(): void
    {
        $this->fakeNebulaGraph()->when('c.chat.privacy', ['useridris']);

        $admission = $this->joinChannel('chat.{chatId}', $this->makeChannelUser('idris'), 'chat42');

        $this->assertInstanceOf(PresenceUser::class, $admission);
    }

    #[Test]
    public function le_canal_de_serveur_refuse_un_non_membre(): void
    {
        $this->fakeNebulaGraph()->when('s.server.privacy', [['privacy' => 1, 'group_vertexid' => 'group7']]);

        // Aucun `joinGroup` : c'est MySQL qui refuse, et c'est tout le sujet d'E4.2.
        $refus = $this->joinChannel('server.{serverId}', $this->makeChannelUser('jacinthe'), 'server42');

        $this->assertFalse((bool) $refus);
    }

    #[Test]
    public function le_canal_de_serveur_admet_un_membre_du_groupe(): void
    {
        $this->fakeNebulaGraph()->when('s.server.privacy', [['privacy' => 1, 'group_vertexid' => 'group7']]);

        $user = $this->makeChannelUser('romain');
        $this->joinGroup($user, 7);

        $admission = $this->joinChannel('server.{serverId}', $user, 'server42');

        $this->assertInstanceOf(PresenceUser::class, $admission);
    }

    /**
     * Pourquoi durcir `canJoinRoom` obligeait à durcir `_checkIsOwner` aussi.
     *
     * Ces deux canaux évaluent `canJoinRoom($x) || isCreator($x)`. Tant que le premier terme
     * était fail-open, le second n'était jamais atteint sur une panne. Le rendre fail-closed
     * fait tomber l'évaluation sur `isCreator`, dont l'ancien `count($result)` lève un
     * `TypeError` sur le `JsonResponse` — soit un 500 à la place du 403. Le contrôle de harnais
     * de ce test demande donc DEUX neutralisations, une par mécanisme.
     */
    #[Test]
    #[DataProvider('canauxDeSalon')]
    public function sur_panne_de_graphe_les_canaux_de_salon_refusent_au_lieu_de_lever(string $pattern): void
    {
        $this->fakeNebulaGraph()->always($this->grapheMuet());

        $user = $this->makeChannelUser('kevin'.substr($pattern, 0, 4));

        $this->assertFalse((bool) $this->joinChannel($pattern, $user, 'room42'));
    }

    /*
    |--------------------------------------------------------------------------
    | 4. `canJoinServer` — l'appartenance se lit dans MySQL (E4.2)
    |--------------------------------------------------------------------------
    |
    | Le garde interrogeait `user -[:registered_in]-> group` dans NebulaGraph, qui n'en est qu'un
    | RÉPLICA. Chaque trou de synchronisation y laisse une arête EN TROP, jamais en moins : la
    | dérive accordait, donc personne ne la signalait. Le graphe ne répond plus que de ce dont il
    | est maître — les propriétés du sommet serveur, et quel groupe le possède.
    |
    | ⚠️ Ces tests scriptent des lignes ASSOCIATIVES parce que la requête ramène DEUX colonnes.
    | Une seule colonne, et `formatValues` effondrerait la ligne sur sa valeur : le nombre de
    | colonnes est load-bearing, cf. `une_reponse_effondree_sur_une_colonne_est_refusee`.
    |
    */

    /**
     * Le pendant serveur du contrôle de texte fait plus haut sur le chat, et pour la même raison :
     * la doublure ne PARSE pas le nGQL, elle ne peut donc pas prouver qu'une notion a cessé d'être
     * lue. Asserter l'absence de `registered_in` dans la requête est la seule prise disponible.
     */
    #[Test]
    public function le_garde_de_serveur_ne_lit_plus_l_appartenance_dans_le_graphe(): void
    {
        $graph = $this->fakeNebulaGraph()->when('s.server.privacy', []);

        $this->makeChannelUser('leonie')->canJoinServer('server42');

        $this->assertNotEmpty($graph->queries());
        $this->assertStringNotContainsString('registered_in', $graph->queries()[0]);
        $this->assertStringContainsString(
            'RETURN s.server.privacy AS privacy, id(g) AS group_vertexid',
            $graph->queries()[0]
        );
    }

    /**
     * LE test d'E4.2, celui que le plan de chantier nomme.
     *
     * Le graphe répond ce qu'il répondrait avec une arête `registered_in` survivante — le serveur
     * existe, il est privé, il appartient au groupe 7. MySQL, lui, n'a plus la ligne pivot. Avant
     * ce correctif, l'arête seule suffisait à ouvrir le canal.
     */
    #[Test]
    public function un_ancien_membre_dont_l_arete_a_survecu_ne_rejoint_pas_le_serveur_prive(): void
    {
        $this->fakeNebulaGraph()->when('s.server.privacy', [['privacy' => 1, 'group_vertexid' => 'group7']]);

        $this->assertFalse($this->makeChannelUser('marceau')->canJoinServer('server42'));
    }

    #[Test]
    public function un_membre_du_groupe_rejoint_le_serveur_prive(): void
    {
        $this->fakeNebulaGraph()->when('s.server.privacy', [['privacy' => 1, 'group_vertexid' => 'group7']]);

        $user = $this->makeChannelUser('noemie');
        $this->joinGroup($user, 7);

        $this->assertTrue($user->canJoinServer('server42'));
    }

    /**
     * L'effet miroir du piège 1, refermé en passant.
     *
     * L'ancienne requête exigeait qu'un membre QUELCONQUE existe avant de conclure « public » :
     * un serveur public vide refusait donc tout le monde, son propre propriétaire compris. La
     * confidentialité est une propriété du sommet, elle ne dépend d'aucune appartenance.
     */
    #[Test]
    public function un_serveur_public_sans_aucun_membre_reste_ouvert(): void
    {
        $this->fakeNebulaGraph()->when('s.server.privacy', [['privacy' => 0, 'group_vertexid' => 'group7']]);

        $this->assertTrue($this->makeChannelUser('oscar')->canJoinServer('server42'));
    }

    /**
     * Un vid de groupe non reconstituable est un REFUS, pas un accord.
     *
     * Le cas n'est pas théorique : les sommets nés avant l'id dérivé portent un `uniqidReal()`,
     * et le serveur du cluster de dev en est un (`0e64e1713d940`). `getRealIdFromVertexId` rend
     * alors `null` — il n'existe aucune ligne MySQL à interroger, donc rien qui puisse accorder.
     * Journalisé, parce qu'un réplica illisible est une anomalie d'infrastructure, pas un refus
     * ordinaire.
     */
    #[Test]
    public function un_identifiant_de_groupe_illisible_refuse_et_journalise(): void
    {
        $this->fakeNebulaGraph()->when('s.server.privacy', [['privacy' => 1, 'group_vertexid' => '0e64e1713d940']]);

        $user = $this->makeChannelUser('quentin');
        $this->joinGroup($user, 7);

        Log::spy();

        $this->assertFalse($user->canJoinServer('server42'));

        Log::shouldHaveReceived('warning')
            ->withArgs(fn (string $message, array $context) => ($context['guard'] ?? null) === 'canJoinServer')
            ->once();
    }

    /**
     * Le garde-fou du nombre de colonnes.
     *
     * `formatValues` effondre une ligne d'une SEULE colonne sur sa valeur. Si quelqu'un allège la
     * requête à `RETURN id(g)`, la production rendra une liste plate de chaînes — et lire
     * `$result[0]['privacy']` dessus vaut `null`, silencieusement. Ce test décrit ce que le code
     * doit faire de cette forme : refuser.
     */
    #[Test]
    public function une_reponse_effondree_sur_une_colonne_est_refusee(): void
    {
        $this->fakeNebulaGraph()->when('s.server.privacy', ['group7']);

        $user = $this->makeChannelUser('sidonie');
        $this->joinGroup($user, 7);

        $this->assertFalse($user->canJoinServer('server42'));
    }
}
