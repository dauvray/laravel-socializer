<?php

namespace Dauvray\Socializer\Tests\Stubs;

/**
 * Doublure INERTE du binding `onlineUsers`.
 *
 * Ce binding est posé par le provider d'`innovation/laravel-estarter`
 * (`$this->app->singleton('onlineUsers', …)`), paquet que `getPackageProviders()` n'enregistre
 * pas — pour la raison décrite dans `Stubs/Estarter/…/Thumbnails.php` : il vit dans un GitLab
 * privé et le harnais reste autonome.
 *
 * Sans cette doublure, `new Chat()` lève une `BindingResolutionException` avant toute assertion :
 * son constructeur fait `app('onlineUsers')`. Le service n'est pourtant sur aucun des chemins
 * testés (inscription au chat) — d'où une doublure qui existe pour être construite, pas appelée.
 *
 * ⚠️ Toutes les méthodes LÈVENT, même règle que les autres doublures du harnais : un service de
 * présence qui répondrait `false` en silence ferait verdir un test de présence sans jamais rien
 * observer. Si une méthode lève ici, c'est qu'il faut l'implémenter en connaissance de cause.
 */
class FakeOnlineUsers
{
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

    public function isOnlineUser($user_id = null, $user = null)
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
