<?php

namespace Dauvray\Socializer\Tests\Feature\Graph;

use Dauvray\Socializer\Tests\TestCase;
use PHPUnit\Framework\Attributes\Test;

/**
 * E9 — un utilisateur a UN mur et UN feed, quel que soit le nombre de projections.
 *
 * LE DÉFAUT. `insertVertex` retombe sur `uniqidReal()` quand aucun id ne lui est passé
 * (`NebulaGraphConnection::insertVertex`), et `createUserAndNetwork` n'en passait aucun pour le mur
 * ni pour le feed. Le sommet `user`, lui, porte son `user<id>`, donc `INSERT VERTEX IF NOT EXISTS`
 * le rendait inoffensif — l'asymétrie ne se voyait pas. Or DEUX entrées projettent une base
 * entière : la migration `create_nebula` et `socializer:nebula-populate`, dont le déroulé prévu est
 * « installer puis rattraper ». Résultat observé en dev : 2 murs et 2 feeds par utilisateur, donc
 * l'auto-abonnement compté deux fois par `Services\Users` (« Followers : 1 » pour tout le monde),
 * et surtout un `Socializable::wall()` qui rend `$wall[0]` sur deux lignes sans `ORDER BY`.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. `FakeNebulaGraph` fait du `str_contains`, il ne tient pas de
 * graphe : « le réseau existe déjà » est une réponse scriptée. Ce qui est prouvé, c'est la DÉCISION
 * de `createUserAndNetwork` selon ce que la relecture lui rend — relire puis créer, ou relire puis
 * réutiliser. Que la relecture dise vrai est du ressort du graphe réel, et se vérifie en relançant
 * `socializer:nebula-populate` deux fois de suite.
 */
class UserNetworkProjectionTest extends TestCase
{
    #[Test]
    public function un_utilisateur_sans_reseau_recoit_un_mur_et_un_feed_aux_ids_derives(): void
    {
        // La relecture ne rend rien : aucun réseau projeté pour cet utilisateur.
        $graphe = $this->fakeNebulaGraph()->always([]);

        $alice = $this->makeUser('alice');

        createUserAndNetwork($alice);

        $requetes = $graphe->queries();

        $this->assertContains(
            'INSERT VERTEX IF NOT EXISTS feed VALUES "feed'.$alice->id.'":()',
            $requetes,
            'Le feed devrait naître avec un id dérivé de l\'utilisateur.'
        );
        $this->assertContains(
            'INSERT VERTEX IF NOT EXISTS wall VALUES "wall'.$alice->id.'":()',
            $requetes,
            'Le mur devrait naître avec un id dérivé de l\'utilisateur.'
        );

        // Le cœur du défaut : plus aucun id tiré au hasard sur ce chemin.
        $this->assertSame(
            [],
            preg_grep('/idaleatoire/', $requetes),
            'Un sommet est encore créé avec un id aléatoire : la relance le dupliquera.'
        );
    }

    #[Test]
    public function les_aretes_du_reseau_partent_sur_les_ids_derives(): void
    {
        $graphe = $this->fakeNebulaGraph()->always([]);

        $alice = $this->makeUser('alice');

        createUserAndNetwork($alice);

        $requetes = $graphe->queries();

        $this->assertContains('INSERT EDGE owned_by VALUES "feed'.$alice->id.'->'.$alice->vertexid.'"', $requetes);
        $this->assertContains('INSERT EDGE owned_by VALUES "wall'.$alice->id.'->'.$alice->vertexid.'"', $requetes);

        // L'auto-abonnement au propre mur : il est VOULU (sans lui, `getFeedFollowers` n'atteint
        // pas l'auteur de ses propres posts), et c'est lui que le front compense d'un `- 1`.
        $this->assertContains('INSERT EDGE followed_by VALUES "wall'.$alice->id.'->'.$alice->vertexid.'"', $requetes);
    }

    #[Test]
    public function un_reseau_deja_projete_est_reutilise_et_non_recree(): void
    {
        $graphe = $this->fakeNebulaGraph()
            ->when('OPTIONAL MATCH (f:feed)', [[
                'feed' => 'feed-ancien-aleatoire',
                'wall' => 'mur-ancien-aleatoire',
            ]]);

        $alice = $this->makeUser('alice');

        createUserAndNetwork($alice);

        $requetes = $graphe->queries();

        $this->assertSame(
            [],
            preg_grep('/INSERT VERTEX IF NOT EXISTS (wall|feed)/', $requetes),
            'Un second passage a recréé un mur ou un feed : c\'est exactement la duplication à empêcher.'
        );

        // Et les arêtes sont reposées sur les sommets EXISTANTS — ce qui rattrape aussi une
        // projection interrompue avant ses arêtes, sans créer un second réseau au passage.
        $this->assertContains('INSERT EDGE owned_by VALUES "mur-ancien-aleatoire->'.$alice->vertexid.'"', $requetes);
        $this->assertContains('INSERT EDGE followed_by VALUES "mur-ancien-aleatoire->'.$alice->vertexid.'"', $requetes);
    }

    #[Test]
    public function un_reseau_partiel_ne_recree_que_ce_qui_manque(): void
    {
        $graphe = $this->fakeNebulaGraph()
            ->when('OPTIONAL MATCH (f:feed)', [[
                'feed' => null,
                'wall' => 'mur-ancien-aleatoire',
            ]]);

        $alice = $this->makeUser('alice');

        createUserAndNetwork($alice);

        $requetes = $graphe->queries();

        $this->assertContains('INSERT VERTEX IF NOT EXISTS feed VALUES "feed'.$alice->id.'":()', $requetes);
        $this->assertSame(
            [],
            preg_grep('/INSERT VERTEX IF NOT EXISTS wall/', $requetes),
            'Le mur existait : il ne devait pas être recréé.'
        );
    }

    #[Test]
    public function le_sommet_utilisateur_reste_pose_a_chaque_passage(): void
    {
        // Il est idempotent par son id fixe : le reposer est un no-op côté graphe, et c'est ce qui
        // permet à une relance de rafraîchir ses propriétés (nom, avatar, `active`).
        $graphe = $this->fakeNebulaGraph()
            ->when('OPTIONAL MATCH (f:feed)', [[
                'feed' => 'feed-ancien-aleatoire',
                'wall' => 'mur-ancien-aleatoire',
            ]]);

        $alice = $this->makeUser('alice');

        createUserAndNetwork($alice);

        $this->assertContains(
            'INSERT VERTEX IF NOT EXISTS user VALUES "'.$alice->vertexid.'":()',
            $graphe->queries()
        );
    }
}
