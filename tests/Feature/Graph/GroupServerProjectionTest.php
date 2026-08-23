<?php

namespace Dauvray\Socializer\Tests\Feature\Graph;

use Dauvray\Socializer\app\Services\GraphProjection;
use Dauvray\Socializer\Tests\Stubs\Group;
use Dauvray\Socializer\Tests\Stubs\Page;
use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\Test;

/**
 * Un groupe = un sommet `group`, un serveur, une page — sans acteur authentifié, et quel que soit
 * le nombre de projections.
 *
 * LE DÉFAUT, en trois couches. `projectGroupServers()` vivait HORS de `projectAll()` parce que sa
 * chaîne descend jusqu'à `Page::createPageVertice`, qui lit `$this->user->id` et
 * `get_class($this->user)` : sans acteur, `TypeError`. Elle n'était donc jouable que depuis la
 * migration, dans une requête web. Le sommet `server` et sa page naissaient de surcroît sous
 * `uniqidReal()` — deux projections, deux serveurs, exactement le défaut des murs et des feeds un
 * étage plus bas (`UserNetworkProjectionTest`). Et le vid retourné était JETÉ, alors que
 * `groups.extras['socializer_server_vid']` est la poignée par laquelle le front entre dans le
 * serveur d'un groupe (`Resources\User`) et par laquelle `GroupDeletedListener` le supprime : un
 * serveur projeté était un orphelin, invisible et non supprimable.
 *
 * ET LE PRÉALABLE QUE PERSONNE N'AVAIT VU : aucune étape ne créait le sommet `group` lui-même.
 * `projectGroupParents()` ne posait que l'arête parent, et le seul `insertVertex('group')` du paquet
 * est sur le chemin événementiel (`Users::createGroup`). L'arête `owned_by` du serveur pointait donc
 * vers un sommet SANS TAG : `MATCH (g:group)` ne le voit pas, et `Socializable::isServerOwner` — qui
 * traverse `(s:server)-[:owned_by]->(:group)-[:has_creator]->(u:user)` — répondait faux pour tout le
 * monde. C'est pourquoi la projection des groupes passe désormais par `Users::createGroup()`.
 *
 * LE PROPRIÉTAIRE, EN CONSOLE. Il est résolu depuis MySQL : le leader du groupe
 * (`group_user.is_leader`), sinon le membre attaché le plus tôt. Aucun membre ⇒ le sommet du groupe
 * est posé quand même, mais pas son `has_creator` ni son serveur : un refus journalisé, qui n'est PAS
 * une écriture refusée par le graphe.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. `FakeNebulaGraph` fait du `str_contains`, il ne tient pas de
 * graphe : « ce groupe a déjà un serveur » est une réponse scriptée. Ce qui est prouvé, c'est la
 * DÉCISION prise selon ce que la relecture rend — relire puis créer, ou relire puis réutiliser. Que
 * la relecture dise vrai est du ressort du graphe réel, et se vérifie en relançant
 * `socializer:nebula-populate` deux fois de suite.
 *
 * ⚠️ ET CE QU'IL A FAILLI LAISSER PASSER, parce qu'une doublure rend la forme qu'on lui script :
 * une requête à UNE colonne rend une **liste plate** de valeurs, pas des lignes associatives
 * (`NebulaGraphConnection::formatValues` effondre une ligne d'une seule colonne sur sa valeur). Ces
 * tests scriptaient d'abord `[['server' => '…']]` : verts, alors que le code lisait `null` en
 * production et créait un second serveur à chaque projection. C'est la contre-épreuve sur le dev qui
 * l'a vu, pas la suite.
 */
class GroupServerProjectionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // `Server::__construct` résout `app('onlineUsers')`, binding posé par le provider
        // d'estarter : sans doublure, le service n'est pas constructible. Il ne l'APPELLE jamais
        // sur ce chemin — la doublure existe pour être construite.
        $this->fakeOnlineUsers();

        // Les deux modèles que la projection lit par clé de config. Le second est un modèle Mongo
        // en production, d'où la doublure — cf. `tests/Stubs/Page.php`.
        config()->set('estarter.models.group', Group::class);
        config()->set('socializer.models.page', Page::class);
    }

    /*
    |--------------------------------------------------------------------------
    | 1. Les ids sont dérivés, donc la relance ne duplique rien
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function un_groupe_sans_serveur_recoit_un_serveur_et_une_page_aux_ids_derives(): void
    {
        // La relecture ne rend rien : ni serveur ni page projetés pour ce groupe.
        $graphe = $this->fakeNebulaGraph()->always([]);

        $groupe = Group::create(['name' => 'Direction']);
        $this->joinGroup($this->makeUser('alice', groupId: null), $groupe->id, leader: true);

        $this->assertSame(0, (new GraphProjection)->projectAll());

        $requetes = $graphe->queries();

        $this->assertContains(
            'INSERT VERTEX IF NOT EXISTS server VALUES "server'.$groupe->id.'":()',
            $requetes,
            'Le serveur devrait naître avec un id dérivé du groupe.'
        );
        $this->assertContains(
            'INSERT VERTEX IF NOT EXISTS page VALUES "pageserver'.$groupe->id.'":()',
            $requetes,
            'La page devrait naître avec un id dérivé du serveur — les salons ont aussi des pages.'
        );
        $this->assertContains(
            'INSERT EDGE owned_by VALUES "server'.$groupe->id.'->group'.$groupe->id.'"',
            $requetes
        );
        $this->assertContains(
            'INSERT EDGE published_in VALUES "pageserver'.$groupe->id.'->server'.$groupe->id.'"',
            $requetes
        );

        // Le cœur du défaut : plus aucun sommet tiré au hasard sur ce chemin. La doublure nomme son
        // repli `vid-aleatoire-<tag>`, ce qui rend la régression lisible.
        $this->assertSame(
            [],
            preg_grep('/vid-aleatoire/', $requetes),
            'Un sommet est encore créé sans id explicite : la relance le dupliquera.'
        );
    }

    #[Test]
    public function un_serveur_deja_projete_est_reutilise_et_non_recree(): void
    {
        $graphe = $this->fakeNebulaGraph()
            ->when('MATCH (s:server)', ['serveur-ancien-aleatoire'])
            ->when('(p:page)-[:published_in]', ['page-ancienne-aleatoire'])
            ->always([]);

        $groupe = Group::create(['name' => 'Direction']);
        $this->joinGroup($this->makeUser('alice', groupId: null), $groupe->id, leader: true);

        (new GraphProjection)->projectAll();

        $requetes = $graphe->queries();

        $this->assertSame(
            [],
            preg_grep('/INSERT VERTEX IF NOT EXISTS (server|page)/', $requetes),
            'Un second passage a recréé le serveur ou sa page : c\'est la duplication à empêcher.'
        );

        // Les arêtes sont reposées sur les sommets EXISTANTS : c'est ce qui rattrape une projection
        // interrompue avant ses arêtes, sans créer un second serveur au passage.
        $this->assertContains(
            'INSERT EDGE owned_by VALUES "serveur-ancien-aleatoire->group'.$groupe->id.'"',
            $requetes
        );
        $this->assertContains(
            'INSERT EDGE published_in VALUES "page-ancienne-aleatoire->serveur-ancien-aleatoire"',
            $requetes
        );
    }

    #[Test]
    public function une_page_manquante_est_rattrapee_sur_un_serveur_existant(): void
    {
        // Le cas « réseau partiel » : le serveur a survécu, sa page non.
        $graphe = $this->fakeNebulaGraph()
            ->when('MATCH (s:server)', ['serveur-ancien-aleatoire'])
            ->always([]);

        $groupe = Group::create(['name' => 'Direction']);
        $this->joinGroup($this->makeUser('alice', groupId: null), $groupe->id, leader: true);

        (new GraphProjection)->projectAll();

        $requetes = $graphe->queries();

        $this->assertSame(
            [],
            preg_grep('/INSERT VERTEX IF NOT EXISTS server/', $requetes),
            'Le serveur existait : il ne devait pas être recréé.'
        );
        $this->assertContains(
            'INSERT VERTEX IF NOT EXISTS page VALUES "pageserveur-ancien-aleatoire":()',
            $requetes,
            'La page manquait : elle devait être créée, et sur l\'adresse du serveur existant.'
        );
    }

    /*
    |--------------------------------------------------------------------------
    | 2. Le propriétaire, sans utilisateur authentifié
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function le_proprietaire_projete_est_le_leader_du_groupe(): void
    {
        $this->fakeNebulaGraph()->always([]);

        $groupe = Group::create(['name' => 'Direction']);
        $premier = $this->makeUser('alice', groupId: null);
        $leader = $this->makeUser('bob', groupId: null);

        // alice est attachée d'abord, bob est le leader : c'est bob qui doit gagner.
        $this->joinGroup($premier, $groupe->id);
        $this->joinGroup($leader, $groupe->id, leader: true);

        (new GraphProjection)->projectAll();

        $page = Page::where('server_id', 'server'.$groupe->id)->first();

        $this->assertNotNull($page, 'La page du serveur n\'a pas été créée.');
        $this->assertSame($leader->id, (int) $page->model_id);
        $this->assertSame($leader::class, $page->model_type);
    }

    #[Test]
    public function sans_leader_le_proprietaire_est_le_membre_attache_le_plus_tot(): void
    {
        $this->fakeNebulaGraph()->always([]);

        $groupe = Group::create(['name' => 'Direction']);
        $premier = $this->makeUser('alice', groupId: null);
        $this->joinGroup($premier, $groupe->id);
        $this->joinGroup($this->makeUser('bob', groupId: null), $groupe->id);

        (new GraphProjection)->projectAll();

        $this->assertSame(
            $premier->id,
            (int) Page::where('server_id', 'server'.$groupe->id)->first()?->model_id
        );
    }

    #[Test]
    public function un_groupe_sans_membre_ne_projette_pas_de_serveur(): void
    {
        $graphe = $this->fakeNebulaGraph()->always([]);

        Log::spy();

        $groupe = Group::create(['name' => 'Direction']);

        // Une étape qui ne PEUT pas tourner là où elle est appelée n'est pas une écriture refusée
        // par le graphe : la compter ferait échouer `migrate` sur toute base ayant un tel groupe.
        $this->assertSame(0, (new GraphProjection)->projectAll());

        $requetes = $graphe->queries();

        $this->assertSame(
            [],
            preg_grep('/INSERT VERTEX IF NOT EXISTS server/', $requetes),
            'Sans propriétaire résoluble, aucun serveur ne doit être projeté.'
        );

        // Le sommet du groupe, lui, est posé : il n'a besoin de personne, et les arêtes des
        // utilisateurs (`registered_in`) le visent déjà.
        $this->assertContains(
            'INSERT VERTEX IF NOT EXISTS group VALUES "group'.$groupe->id.'":()',
            $requetes
        );
        $this->assertSame(
            [],
            preg_grep('/INSERT EDGE has_creator VALUES "group/', $requetes),
            'Sans propriétaire, il n\'y a pas de créateur à désigner.'
        );

        Log::shouldHaveReceived('warning')
            ->withArgs(fn (string $message, array $context) => ($context['group_id'] ?? null) === $groupe->id)
            ->atLeast()->once();

        // Et rien n'est mémorisé : c'est le cas où `createGroupServer` rend `false` SANS lever, donc
        // le seul que garde le `if (!$vid)` de la projection. Sans lui, le front recevrait `false`
        // comme adresse de serveur.
        $this->assertNull($groupe->fresh()->extras['socializer_server_vid'] ?? null);
    }

    /*
    |--------------------------------------------------------------------------
    | 3. Le sommet du groupe, et la poignée du front
    |--------------------------------------------------------------------------
    */

    #[Test]
    public function le_sommet_du_groupe_et_son_arete_de_createur_sont_poses(): void
    {
        $graphe = $this->fakeNebulaGraph()->always([]);

        $groupe = Group::create(['name' => 'Direction']);
        $leader = $this->makeUser('alice', groupId: null);
        $this->joinGroup($leader, $groupe->id, leader: true);

        (new GraphProjection)->projectAll();

        $requetes = $graphe->queries();

        $this->assertContains(
            'INSERT VERTEX IF NOT EXISTS group VALUES "group'.$groupe->id.'":()',
            $requetes,
            'Sans ce sommet, l\'arête `owned_by` du serveur pend dans le vide et `isServerOwner` est faux.'
        );
        $this->assertContains(
            'INSERT EDGE has_creator VALUES "group'.$groupe->id.'->'.$leader->vertexid.'"',
            $requetes
        );
    }

    #[Test]
    public function la_projection_memorise_le_vid_du_serveur_dans_les_extras(): void
    {
        $this->fakeNebulaGraph()->always([]);

        $groupe = Group::create(['name' => 'Direction']);
        $this->joinGroup($this->makeUser('alice', groupId: null), $groupe->id, leader: true);

        (new GraphProjection)->projectAll();

        // Sans cette mémorisation, `Resources\User` rend `server_id: null` et le front n'a aucun
        // moyen d'entrer dans le serveur — et `GroupDeletedListener` aucun moyen de le supprimer.
        $this->assertSame(
            'server'.$groupe->id,
            $groupe->fresh()->extras['socializer_server_vid'] ?? null
        );
    }

    #[Test]
    public function un_refus_du_graphe_n_ecrit_pas_un_vid_dans_les_extras(): void
    {
        // Même raisonnement que `GroupCreatedListener`, qui met son `save()` DANS le rattrapage :
        // ne jamais mémoriser un vid qui pointerait vers un sommet inexistant.
        $this->fakeNebulaGraph()
            ->throwsOn('INSERT VERTEX IF NOT EXISTS server')
            ->always([]);

        $groupe = Group::create(['name' => 'Direction']);
        $this->joinGroup($this->makeUser('alice', groupId: null), $groupe->id, leader: true);

        $this->assertSame(1, (new GraphProjection)->projectAll());

        $this->assertNull($groupe->fresh()->extras['socializer_server_vid'] ?? null);
    }
}
