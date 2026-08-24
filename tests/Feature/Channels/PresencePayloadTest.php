<?php

namespace Dauvray\Socializer\Tests\Feature\Channels;

use App\Models\User;
use Dauvray\Socializer\app\Http\Resources\PresenceUser;
use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Http\Resources\Json\JsonResource;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;

/**
 * E8 — la charge utile d'un canal de présence ne porte pas le bloc privé de son sujet.
 *
 * Les quatre canaux de présence renvoyaient `UserResource`, qui délègue à celle d'estarter. Son
 * garde `if ($this->id === Auth::user()?->id)` n'est pas faux : le contexte le désarme. La
 * ressource est construite pendant le `/broadcasting/auth` **du membre qu'elle décrit**, donc
 * `Auth::user()` y est toujours le sujet de la donnée et la branche privée gagne systématiquement.
 * Reverb mémorise ce `user_info` par connexion, puis le rediffuse à tous via `here` et
 * `member_added` : `email`, `roles`, `permissions`, `groups` (avec `server_id`) et
 * `unreadNotifications` de chaque membre partaient à tous les autres. Mesuré le 21/08/2026 sur
 * `presence-server.0e64e1713d940`.
 *
 * D'où `PresenceUser`, dont le périmètre est une LISTE BLANCHE et ne consulte aucune identité de
 * requête. La liste blanche n'est pas un détail de style : le bloc privé n'était pas la seule
 * source, `UserResource` ajoutait AUSSI son propre `groups` sans condition. Une liste noire aurait
 * fermé la première et manqué la seconde — et n'aurait rien dit du champ qu'on ajoutera demain.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. Le harnais ne parle pas à Reverb : il asserte ce que le
 * callback RENVOIE, pas ce que Reverb stocke et rediffuse. La chaîne complète se contre-vérifie
 * avec deux comptes sur une même page serveur, en lisant la charge utile du `here`
 * (ou `GET /apps/{appId}/channels/presence-server.{id}/users`).
 *
 * À quoi ressemblait le rouge, avant le correctif : 17 `Error: Class
 * "Dauvray\Estarter\app\Http\Resources\User" not found` — et non des échecs d'assertion. C'était
 * déjà la démonstration du défaut : un `/broadcasting/auth` tirait dans une charge utile de
 * diffusion toute la ressource HTTP d'un AUTRE paquet, helper `revealIdentifier()` compris.
 */
class PresencePayloadTest extends TestCase
{
    /**
     * Le bloc privé d'estarter, plus les trois champs que le contexte rendait absurdes :
     * `is_me` (vrai pour tout le monde), `channel` (le canal privé du sujet) et `auth_provider`.
     *
     * @return array<string, array{0: string}>
     */
    public static function champsQuiNeDoiventPlusSortir(): array
    {
        return [
            'email' => ['email'],
            'roles' => ['roles'],
            'permissions' => ['permissions'],
            'groups' => ['groups'],
            'unreadNotifications' => ['unreadNotifications'],
            'created_at' => ['created_at'],
            'is_me' => ['is_me'],
            'channel' => ['channel'],
            'auth_provider' => ['auth_provider'],
            'identifier' => ['identifier'],
        ];
    }

    /**
     * Les quatre canaux qui renvoient une ressource. `questionnaire.{roomId}` est le plus facile à
     * oublier : la tâche E8 n'en citait que trois, il renvoyait pourtant la même.
     *
     * ⚠️ Lui est consommé en `Echo.private()`, donc sa ressource est construite pour rien — le
     * protocole Pusher ne renvoie de `channel_data` que sur un canal de présence. Il est gardé ici
     * quand même : le jour où un composant l'ouvre en `Echo.join()`, la fuite ne doit pas
     * réapparaître par ce canal-là (cf. docs/architecture/signalisation.md).
     *
     * @return array<string, array{0: string, 1: string}>
     */
    public static function canauxDePresence(): array
    {
        return [
            'chat' => ['chat.{chatId}', 'chat42'],
            'room' => ['room.{roomId}', 'room42'],
            'server' => ['server.{serverId}', 'server42'],
            'questionnaire' => ['questionnaire.{roomId}', 'room42'],
        ];
    }

    /**
     * Les six champs que le front lit réellement sur une liste de présence — relevé du 21/08/2026,
     * refait avec E8 : `slug` (pivot de l'admission des pairs WebRTC2), `id` (dédoublonnage et
     * départ dans `useReverbChannel`, clés de `v-for`, comparaison au store `me`), `name` et
     * `image` (`Gravatar`, `WallLink`), `function` (`WallLink`, `ApplicationComponent`),
     * `connected` (`GravatarStatus`, quand aucun listener `users-status.{slug}` n'existe).
     */
    private const CHAMPS_ATTENDUS = ['id', 'name', 'slug', 'image', 'function', 'connected'];

    protected function setUp(): void
    {
        parent::setUp();

        // Les gardes admettent : une ligne exploitable suffit (`_checkCanJoin`). Ce fichier ne
        // teste pas les verdicts — c'est le travail de `ChannelGuardTest`.
        //
        // ⚠️ `canJoinServer` fait exception depuis E4.2 : sa requête ne rend plus des vids mais
        // DEUX colonnes, et l'appartenance se lit dans MariaDB. On le scripte donc en serveur
        // PUBLIC — la seule branche qui admette sans exiger de ligne `group_user`, et la moins
        // bavarde des deux pour un fichier qui ne s'intéresse qu'à la charge utile.
        $this->fakeNebulaGraph()
            ->when('s.server.privacy', [['privacy' => 0, 'group_vertexid' => 'group1']])
            ->always(['unInscritQuelconque']);
        $this->fakeOnlineUsers();
    }

    /**
     * Résout la charge utile telle que Reverb la recevrait.
     *
     * `resolve()` et non `toArray()` : c'est lui qui filtre les `MissingValue` d'un
     * `$this->when(…)`, donc la seule lecture qui dise vraiment quelles clés sortent.
     *
     * @return array<string, mixed>
     */
    private function chargeUtileDe(string $pattern, User $sujet, string $parametre): array
    {
        $admission = $this->joinChannel($pattern, $sujet, $parametre);

        $this->assertInstanceOf(
            JsonResource::class,
            $admission,
            "Le canal `$pattern` n'a pas admis le sujet : il n'y a aucune charge utile à examiner."
        );

        return $admission->resolve();
    }

    /*
    |--------------------------------------------------------------------------
    | 1. Ce qui ne doit plus sortir
    |--------------------------------------------------------------------------
    */

    /**
     * `actingAs($sujet)` n'est pas un détail de mise en scène : c'est LE contexte du défaut. Le
     * `/broadcasting/auth` d'un membre est toujours authentifié comme ce membre, donc le garde
     * d'estarter y concluait toujours « c'est moi ». Un test qui s'authentifierait comme un tiers
     * passerait au vert sur l'ancien code sans rien avoir exercé.
     */
    #[Test]
    #[DataProvider('champsQuiNeDoiventPlusSortir')]
    public function la_charge_utile_de_presence_ne_porte_pas_le_bloc_prive(string $champ): void
    {
        $sujet = $this->makeChannelUser('louise'.strtolower($champ));

        $this->actingAs($sujet);

        $charge = $this->chargeUtileDe('server.{serverId}', $sujet, 'server42');

        $this->assertArrayNotHasKey(
            $champ,
            $charge,
            "`$champ` repart vers tous les membres du canal de présence."
        );
    }

    /*
    |--------------------------------------------------------------------------
    | 2. Ce qui doit continuer à sortir
    |--------------------------------------------------------------------------
    */

    /**
     * Le pendant du test précédent, et il compte autant : un champ retiré à l'aveugle ne casse pas
     * un affichage mais une poignée de main — `slug` est ce sur quoi WebRTC2 admet un pair
     * (`usePeerConnections._doGetRoomUsersDiff`).
     *
     * `assertSame` sur les clés, et non un simple « contient » : tout champ ajouté ici devra être
     * une décision, pas un héritage.
     */
    #[Test]
    public function la_charge_utile_de_presence_garde_ce_que_le_front_lit(): void
    {
        $sujet = $this->makeChannelUser('mathilde');

        $this->actingAs($sujet);

        $charge = $this->chargeUtileDe('server.{serverId}', $sujet, 'server42');

        $this->assertSame(self::CHAMPS_ATTENDUS, array_keys($charge));
        $this->assertSame($sujet->id, $charge['id']);
        $this->assertSame($sujet->slug, $charge['slug']);
        $this->assertSame($sujet->name, $charge['name']);
    }

    /**
     * `connected` est le seul champ que la ressource ne lit pas sur le modèle : il vient du service
     * de présence d'estarter. Les deux réponses sont assertées — une doublure qui rendrait
     * toujours 0 ferait verdir la moitié de ce fichier sans rien observer.
     */
    #[Test]
    public function connected_reflete_le_service_de_presence(): void
    {
        $enLigne = $this->makeChannelUser('noémie');
        $horsLigne = $this->makeChannelUser('octave');

        $this->fakeOnlineUsers()->pretendOnline($enLigne->id);

        $this->actingAs($enLigne);
        $this->assertSame(1, $this->chargeUtileDe('server.{serverId}', $enLigne, 'server42')['connected']);

        $this->actingAs($horsLigne);
        $this->assertSame(0, $this->chargeUtileDe('server.{serverId}', $horsLigne, 'server42')['connected']);
    }

    /*
    |--------------------------------------------------------------------------
    | 3. La leçon, épinglée
    |--------------------------------------------------------------------------
    */

    /**
     * Le fait durable, jumeau de celui de C2 sur le graphe : **un garde qui dépend de
     * `Auth::user()` ne veut plus rien dire dans un contexte où `Auth::user()` est toujours le
     * sujet de la donnée.** Ce test interdit le retour d'une ressource à géométrie variable sur un
     * canal de présence, quelle que soit la façon dont elle décide son périmètre.
     */
    #[Test]
    public function le_perimetre_ne_depend_pas_de_l_identite_de_la_requete(): void
    {
        $sujet = $this->makeChannelUser('pénélope');
        $tiers = $this->makeChannelUser('quentin');

        $this->actingAs($sujet);
        $vueParLuiMeme = $this->chargeUtileDe('server.{serverId}', $sujet, 'server42');

        $this->actingAs($tiers);
        $vueParUnTiers = $this->chargeUtileDe('server.{serverId}', $sujet, 'server42');

        $this->assertSame($vueParLuiMeme, $vueParUnTiers);
    }

    /*
    |--------------------------------------------------------------------------
    | 4. Le câblage des quatre canaux
    |--------------------------------------------------------------------------
    */

    #[Test]
    #[DataProvider('canauxDePresence')]
    public function les_quatre_canaux_de_presence_rendent_la_ressource_de_presence(string $pattern, string $parametre): void
    {
        $sujet = $this->makeChannelUser('roseline'.substr($pattern, 0, 4));

        $this->actingAs($sujet);

        $this->assertInstanceOf(
            PresenceUser::class,
            $this->joinChannel($pattern, $sujet, $parametre),
            "Le canal `$pattern` renvoie encore une ressource à géométrie variable."
        );
    }
}
