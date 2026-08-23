<?php

namespace Dauvray\Socializer\Tests\Feature\Graph;

use Dauvray\Socializer\app\Services\GraphProjection;
use Dauvray\Socializer\Tests\Stubs\Group;
use Dauvray\Socializer\Tests\TestCase;
use PHPUnit\Framework\Attributes\Test;

/**
 * E9 — la projection MySQL → NebulaGraph a UN seul propriétaire.
 *
 * Ce DML avait deux copies : la migration `create_nebula` et `socializer:nebula-populate`. Deux
 * points d'entrée se justifient (l'un à l'installation, l'autre à la demande — une migration ne se
 * rejoue que par un `migrate:rollback` qui `dropSpace` tout), deux COPIES non : elles avaient déjà
 * dérivé, la commande ayant perdu le `marketplace` et les parents de groupes en route, et le même
 * durcissement a dû être appliqué deux fois.
 *
 * Ce que ce fichier épingle, c'est le CONTRAT de la routine partagée : elle compte et rapporte,
 * elle ne décide pas. Chaque appelant garde sa politique — la migration lève, la commande sort en
 * code d'erreur.
 *
 * Les serveurs de groupes ont leur propre fichier — `GroupServerProjectionTest` —, parce qu'ils
 * portent une autre question : l'idempotence et le propriétaire résolu sans acteur authentifié.
 *
 * ⚠️ L'avertissement qui figurait ici était FAUX, et il a servi d'excuse à un trou de couverture :
 * « `projectGroupServers()` n'est pas testable, son constructeur tire `Chat`, `Page`,
 * `ApplicationIA` et `Feed`, des services d'estarter absents du harnais ». Ces quatre services sont
 * ceux de CE paquet, et n'ajoutent aucune dépendance : l'ensemble transitif de `new Server()` se
 * réduit à `nebulaGraph`, `onlineUsers` et `Auth::user()`, dont les deux premiers ont une doublure
 * depuis toujours. Le seul vrai blocage était Mongo, contourné par un stub de modèle. Une raison
 * plausible de ne pas tester se vérifie comme le reste.
 */
class GraphProjectionTest extends TestCase
{
    #[Test]
    public function elle_projette_les_utilisateurs_et_le_marketplace_et_ne_compte_aucun_echec(): void
    {
        $graphe = $this->fakeNebulaGraph()->always([]);

        $this->makeUser('alice');
        $this->makeUser('bob');

        $echecs = (new GraphProjection)->projectAll();

        $this->assertSame(0, $echecs);

        $requetes = $graphe->queries();

        $this->assertContains('INSERT VERTEX IF NOT EXISTS user VALUES "useralice":()', $requetes);
        $this->assertContains('INSERT VERTEX IF NOT EXISTS user VALUES "userbob":()', $requetes);
        $this->assertContains('INSERT VERTEX IF NOT EXISTS marketplace VALUES "marketplace":()', $requetes);
    }

    #[Test]
    public function un_refus_du_graphe_est_compte_rapporte_et_n_interrompt_pas_la_boucle(): void
    {
        $graphe = $this->fakeNebulaGraph()
            ->throwsOn('INSERT VERTEX IF NOT EXISTS user')
            ->always([]);

        $this->makeUser('alice');
        $this->makeUser('bob');

        $rapportes = [];

        $echecs = (new GraphProjection)->projectAll(
            function (string $quoi, array $contexte) use (&$rapportes): void {
                $rapportes[$quoi] = $contexte;
            }
        );

        $this->assertSame(2, $echecs, 'Les deux utilisateurs ont été refusés, les deux doivent être comptés.');
        $this->assertSame(
            ['réseau de l\'utilisateur 1', 'réseau de l\'utilisateur 2'],
            array_keys($rapportes),
            'Le second utilisateur n\'a pas été tenté : la boucle s\'est arrêtée au premier refus.'
        );

        // Le contexte rapporté est celui de `NebulaGraphException::context()` : de quoi
        // journaliser sans que l'appelant ait à connaître l'exception.
        $this->assertArrayHasKey('operation', $rapportes['réseau de l\'utilisateur 1']);
        $this->assertArrayHasKey('code', $rapportes['réseau de l\'utilisateur 1']);

        // Et la projection continue après la boucle des utilisateurs.
        $this->assertContains(
            'INSERT VERTEX IF NOT EXISTS marketplace VALUES "marketplace":()',
            $graphe->queries()
        );
    }

    #[Test]
    public function sans_le_paquet_eblogger_l_etape_des_articles_est_sautee_sans_fatal(): void
    {
        // `config('eblogger.models.article')` rend `null` quand le paquet n'est pas installé — et
        // les deux copies de ce DML faisaient `null::all()` sans condition.
        $this->assertNull(config('eblogger.models.article'));

        $graphe = $this->fakeNebulaGraph()->always([]);

        $this->makeUser('alice');

        $this->assertSame(0, (new GraphProjection)->projectAll());

        $this->assertSame(
            [],
            preg_grep('/article/', $graphe->queries()),
            'Aucune requête d\'article ne doit partir sans le paquet eblogger.'
        );
    }

    #[Test]
    public function les_parents_de_groupes_sont_projetes_quand_le_modele_est_declare(): void
    {
        // Étape que la commande avait perdue en route : elle n'existait que dans la migration.
        config()->set('estarter.models.group', Group::class);

        // Depuis que l'étape pose aussi le SOMMET du groupe, elle passe par `Services\Users`, dont
        // le constructeur résout `app('onlineUsers')` — binding d'estarter, absent du harnais.
        $this->fakeOnlineUsers();

        $graphe = $this->fakeNebulaGraph()->always([]);

        $parent = Group::create(['name' => 'Direction']);
        Group::create(['name' => 'Innovation', 'parent_id' => $parent->id]);

        $this->assertSame(0, (new GraphProjection)->projectAll());

        $this->assertContains(
            'INSERT EDGE registered_in VALUES "group2->group1"',
            $graphe->queries(),
            'Le groupe enfant doit être rattaché à son parent.'
        );
    }
}
