<?php

namespace Dauvray\Socializer\Tests\Stubs;

/**
 * Doublure du binding `onlineUsers`, inerte SAUF sur `isOnlineUser`.
 *
 * Ce binding est posé par le provider d'`innovation/laravel-estarter`
 * (`$this->app->singleton('onlineUsers', …)`), paquet que `getPackageProviders()` n'enregistre
 * pas — pour la raison décrite dans `Stubs/Estarter/…/Thumbnails.php` : il vit dans un GitLab
 * privé et le harnais reste autonome.
 *
 * Sans cette doublure, `new Chat()` lève une `BindingResolutionException` avant toute assertion :
 * son constructeur fait `app('onlineUsers')`. Le service n'était sur aucun des chemins testés
 * (inscription au chat) — d'où une doublure qui existait pour être construite, pas appelée.
 *
 * ⚠️ Toutes les méthodes LÈVENT, même règle que les autres doublures du harnais : un service de
 * présence qui répondrait `false` en silence ferait verdir un test de présence sans jamais rien
 * observer. Si une méthode lève ici, c'est qu'il faut l'implémenter en connaissance de cause.
 *
 * `isOnlineUser` a franchi ce pas avec E8 : `PresenceUser` la lit pour le champ `connected`, elle
 * est donc sur un chemin réellement testé. Elle répond désormais — mais seulement sur un état
 * DÉCLARÉ par `pretendOnline()`, et `PresencePayloadTest` asserte les deux réponses (1 pour un id
 * déclaré, 0 sinon). Ce n'est pas un `false` silencieux : c'est un comportement observé.
 */
class FakeOnlineUsers
{
    /** @var array<int, int> Ids déclarés en ligne par `pretendOnline()`. */
    private array $online = [];

    /**
     * Déclare des utilisateurs en ligne pour ce test.
     */
    public function pretendOnline(int ...$userIds): static
    {
        $this->online = array_merge($this->online, $userIds);

        return $this;
    }

    /**
     * ⚠️ Ne reproduit QUE la forme d'appel de `PresenceUser` — un id en premier argument. Le vrai
     * service accepte aussi le modèle en second (`EstarterUser::getConnectedAttribute` l'appelle
     * ainsi) : le jour où un chemin testé emprunte cette forme, l'implémenter ici explicitement
     * plutôt que de laisser `$user` ignoré rendre 0 sans le dire.
     */
    public function isOnlineUser($user_id = null, $user = null)
    {
        if ($user !== null) {
            $this->refuseInertStub(__FUNCTION__);
        }

        return in_array((int) $user_id, $this->online, true);
    }

    public function addUserItem($type = null, $item_id = null, $user_id = null)
    {
        $this->refuseInertStub(__FUNCTION__);
    }

    public function removeUserItem($type = null, $item_id = null, $user_id = null)
    {
        $this->refuseInertStub(__FUNCTION__);
    }

    public function hasUserItem($type = null, $item_id = null, $user_id = null)
    {
        $this->refuseInertStub(__FUNCTION__);
    }

    public function updateUserOnlineStatus($user = null)
    {
        $this->refuseInertStub(__FUNCTION__);
    }

    public function removeUserOnlineStatus($user_id = null, $user = null)
    {
        $this->refuseInertStub(__FUNCTION__);
    }

    private function refuseInertStub(string $method): never
    {
        throw new \LogicException(
            "FakeOnlineUsers::{$method}() est une doublure inerte du harnais. Le test qui vous "
            .'amène ici dépend réellement du service de présence : implémentez ce comportement '
            .'dans tests/Stubs/FakeOnlineUsers.php, plutôt que de le laisser répondre en silence.'
        );
    }
}
