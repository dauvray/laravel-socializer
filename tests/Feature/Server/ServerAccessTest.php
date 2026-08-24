<?php

namespace Dauvray\Socializer\Tests\Feature\Server;

use Dauvray\Socializer\app\Services\Server as ServerService;
use Dauvray\Socializer\Tests\TestCase;
use PHPUnit\Framework\Attributes\Test;

/**
 * E4.2 — les deux autres lecteurs de l'appartenance passent par le garde.
 *
 * La clause « membre du groupe qui possède ce serveur » existait en TROIS copies nGQL :
 * `Socializable::canJoinServer`, `Services\Server::getServer` et le helper `checkServerAccess`.
 * Trois copies d'une règle d'accès divergent — c'est déjà arrivé ici, et la conséquence a un nom :
 * l'interface propose un serveur dont l'abonnement Reverb part en refus, donc un bouton qui ne
 * fait rien (leçon de C5). Depuis le 24/08/2026 il n'y a plus qu'un prédicat, et ce fichier est ce
 * qui l'empêche de se re-dupliquer.
 *
 * ⚠️ `new ServerService` capte `Auth::user()` DANS SON CONSTRUCTEUR : un `actingAs` postérieur à
 * la construction ne change rien. D'où une instance neuve par sujet.
 */
class ServerAccessTest extends TestCase
{
    /**
     * Ce que le graphe répond pour un serveur privé du groupe 7 — deux colonnes, comme en
     * production.
     *
     * @return array<int, array<string, mixed>>
     */
    private function serveurPriveDuGroupe7(): array
    {
        return [['privacy' => 1, 'group_vertexid' => 'group7']];
    }

    /**
     * Le pré-contrôle que `Servers.vue` et `UserGroups.vue` interrogent avant d'ouvrir un serveur
     * (`GET /check-server-access`). Il doit rendre le verdict du garde, pas le sien.
     */
    #[Test]
    public function le_pre_controle_du_front_rend_le_meme_verdict_que_le_garde(): void
    {
        $this->fakeOnlineUsers();
        $this->fakeNebulaGraph()->when('s.server.privacy', $this->serveurPriveDuGroupe7());

        $intrus = $this->makeChannelUser('tancrede');
        $membre = $this->makeChannelUser('ursule');
        $this->joinGroup($membre, 7);

        $this->actingAs($intrus);
        $this->assertFalse((new ServerService)->checkServerAccess('server42'));

        $this->actingAs($membre);
        $this->assertTrue((new ServerService)->checkServerAccess('server42'));
    }

    /**
     * Le garde court-circuite : un refus ne doit pas payer la grosse requête de `getServer`.
     *
     * ⚠️ L'assertion ne peut pas porter sur la valeur de retour — `getServer` rend `false` dans
     * les deux cas —, ni sur le seul NOMBRE de requêtes : sans garde, il n'en part qu'une aussi,
     * la grosse. Écrit d'abord ainsi, ce test restait vert alors qu'on venait de retirer le garde.
     * C'est l'IDENTITÉ de la requête émise qui distingue les deux mondes.
     */
    #[Test]
    public function get_server_refuse_avant_de_toucher_au_graphe(): void
    {
        $this->fakeOnlineUsers();
        $graph = $this->fakeNebulaGraph()->when('s.server.privacy', $this->serveurPriveDuGroupe7());

        $this->actingAs($this->makeChannelUser('victoire'));

        $this->assertFalse((new ServerService)->getServer('server42'));
        $this->assertCount(1, $graph->queries());
        $this->assertStringContainsString('id(g) AS group_vertexid', $graph->queries()[0]);
        $this->assertStringNotContainsString('nb_users', $graph->queries()[0]);
    }

    /**
     * ⚠️ **`nb_users` valait TOUJOURS 1 sur un serveur privé**, et c'est la même cause que le
     * défaut de sécurité : le motif `(u:user)-[:registered_in]->(g)` servait à COMPTER les
     * membres, et lui accrocher `id(u) == <le demandeur>` restreignait ce compte au demandeur.
     * Une clause qui filtre et qui décide à la fois ne peut pas faire les deux bien.
     *
     * Contre-épreuve du 24/08/2026 sur le cluster de dev : la requête réécrite rend `nb_users`
     * = 2 là où l'ancienne rendait 1. Le harnais ne peut pas le voir (il ne compte rien), il ne
     * garde donc ici que l'absence de la clause.
     */
    #[Test]
    public function get_server_ne_restreint_plus_le_compte_des_membres_au_demandeur(): void
    {
        $this->fakeOnlineUsers();
        $graph = $this->fakeNebulaGraph()->when('s.server.privacy', $this->serveurPriveDuGroupe7());

        $membre = $this->makeChannelUser('wilfried');
        $this->joinGroup($membre, 7);
        $this->actingAs($membre);

        (new ServerService)->getServer('server42');

        $this->assertCount(2, $graph->queries(), 'Le garde a admis : la requête de lecture doit suivre.');
        $this->assertStringContainsString('count(distinct u) as nb_users', $graph->queries()[1]);
        $this->assertStringNotContainsString('s.server.privacy', $graph->queries()[1]);
    }

    /**
     * Le troisième métier de la clause retirée — celui qui a mordu en production.
     *
     * En épinglant `u` à un seul utilisateur, la clause de confidentialité garantissait UNE ligne
     * par salon avant l'agrégation. Sans elle, le produit cartésien en rend `nb_users` — et
     * `collect()` **ne dédoublonne pas**, contrairement au `count(distinct u)` d'à côté, déjà
     * protégé. Résultat le 24/08/2026, sur un serveur à deux membres : chaque salon de chat
     * affiché **en double**.
     *
     * ⚠️ Assertion de TEXTE, faute de mieux : la doublure rend la liste qu'on lui script, elle ne
     * peut pas produire un produit cartésien. Le chiffre, lui, a été mesuré contre le cluster de
     * dev — `size(rooms)` rend 2 sans le `distinct`, 1 avec.
     *
     * La leçon que ce test épingle : **retirer une clause de filtrage change la cardinalité du jeu
     * de lignes que consomment TOUS les agrégats de la requête**, pas seulement celui qu'on
     * voulait réparer.
     */
    #[Test]
    public function get_server_ne_collecte_pas_un_salon_par_membre(): void
    {
        $this->fakeOnlineUsers();
        $graph = $this->fakeNebulaGraph()->when('s.server.privacy', $this->serveurPriveDuGroupe7());

        $membre = $this->makeChannelUser('xavier');
        $this->joinGroup($membre, 7);
        $this->actingAs($membre);

        (new ServerService)->getServer('server42');

        $this->assertStringContainsString('collect(distinct r) as rooms', $graph->queries()[1]);
    }
}
