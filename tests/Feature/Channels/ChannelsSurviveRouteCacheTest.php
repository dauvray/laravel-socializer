<?php

namespace Dauvray\Socializer\Tests\Feature\Channels;

use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\Attributes\Test;

/**
 * Les canaux se déclarent même quand les routes sont cachées — 25/08/2026.
 *
 * `ServiceProvider::boot` chargeait `routes/socializer/channels.php` par `loadRoutesFrom()`, qui
 * ne fait RIEN dès que `$app->routesAreCached()` : le fichier était donc purement sauté partout où
 * `route:cache` tourne — l'entrypoint Docker le lance à chaque démarrage de conteneur. Aucun
 * `Broadcast::channel()` n'étant alors déclaré, `verifyUserCanAccessChannel` ne trouvait aucun
 * motif correspondant et refusait TOUT `/broadcasting/auth` en 403 : notifications, chat, salons et
 * serveurs muets d'un coup.
 *
 * ⚠️ La panne était invisible côté serveur. Un canal introuvable n'est pas un refus de garde : il
 * ne passe par aucun `canJoin*`, donc ne journalise rien, et `laravel.log` restait vide. Seule la
 * console du navigateur parlait, par l'`AuthError` de pusher-js. Ne pas chercher la trace d'un tel
 * incident dans les journaux applicatifs.
 *
 * ⚠️ Ce que `les_cinq_canaux_sont_enregistres` de `ChannelGuardTest` ne pouvait pas voir : il
 * tourne sur un harnais sans cache de routes, donc dans le seul monde où le bug ne se produit
 * PAS. C'est la raison d'être de ce fichier — et de son second test, qui vérifie que le harnais
 * décrit bien l'autre monde.
 */
class ChannelsSurviveRouteCacheTest extends TestCase
{
    /**
     * Le drapeau que `Application::routesAreCached()` consulte avant toute chose — couture
     * prévue par le framework, préférable à un faux fichier de routes compilées : elle ne
     * fabrique aucun `bootstrap/cache/routes-v7.php` dont il faudrait imiter le format.
     */
    protected function defineEnvironment($app): void
    {
        parent::defineEnvironment($app);

        $app->instance('routes.cached', true);
    }

    #[Test]
    public function les_cinq_canaux_sont_enregistres_malgre_le_cache_de_routes(): void
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
     * Contre-épreuve du harnais, sans laquelle le test ci-dessus serait vert dans les deux
     * mondes : les VRAIES routes du paquet, elles, passent par `loadRoutesFrom` et doivent donc
     * bien avoir disparu. Leur absence est la preuve que le drapeau a pris effet.
     */
    #[Test]
    public function le_drapeau_a_bien_neutralise_le_chargement_des_routes(): void
    {
        $this->assertTrue($this->app->routesAreCached());
        $this->assertFalse(Route::has('comments.store'));
    }
}
