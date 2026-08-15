<?php

namespace Dauvray\Estarter\app\Helpers\ModelTraits;

/**
 * Doublure INERTE du trait `Thumbnails` d'`innovation/laravel-estarter`.
 *
 * Pourquoi une doublure et pas la vraie dépendance : le paquet appartient à une famille
 * (cf. docs/architecture/package.md § « Dépendances implicites »), et estarter vit dans un
 * GitLab **privé**. L'ajouter en `require-dev` mettrait une URL interne dans le manifeste
 * d'un paquet publié sur GitHub public, et rendrait la suite inexécutable sans accès à ce
 * GitLab. Le harnais reste donc autonome.
 *
 * Ce trait n'est chargé que parce que `ServiceProvider::boot` fait un `require_once` de TOUS
 * les `src/app/Helpers/*.php`, dont `ContentFormater.php` qui l'utilise. Rien dans le lot C
 * ne touche aux vignettes.
 *
 * ⚠️ Toutes les méthodes LÈVENT. Une doublure qui renverrait `null` en silence ferait passer
 * au vert un futur test dépendant du traitement d'image sans jamais le traiter — le défaut
 * exact reproché au mock PeerJS côté JS. Si une méthode lève ici, ce n'est pas un bug du
 * harnais : c'est qu'il faut implémenter ce comportement dans la doublure, en connaissance
 * de cause.
 *
 * Signatures alignées sur le vrai trait
 * (vendor/innovation/laravel-estarter/src/app/Helpers/ModelTraits/Thumbnails.php).
 */
trait Thumbnails
{
    public function resethumnbnail($new_val = null, $old_val = null, $disk = 'thumbnails')
    {
        $this->refuseInertStub(__FUNCTION__);
    }

    public function isSameImage($value, $image)
    {
        $this->refuseInertStub(__FUNCTION__);
    }

    public function deleteAllThumbnails($value = null, $disk = 'thumbnails', $thumbnailsSize = null)
    {
        $this->refuseInertStub(__FUNCTION__);
    }

    public function getThumbnail($size = null)
    {
        $this->refuseInertStub(__FUNCTION__);
    }

    public function createThumbnails($file = null, $disk = 'thumbnails', $thumbnailsSize = null, $keepOriginal = true, $filename = null)
    {
        $this->refuseInertStub(__FUNCTION__);
    }

    public function setThumbnails($value = null, $image = null, $disk = 'thumbnails')
    {
        $this->refuseInertStub(__FUNCTION__);
    }

    public function setImageAttribute($value)
    {
        $this->refuseInertStub(__FUNCTION__);
    }

    private function refuseInertStub(string $method): never
    {
        throw new \LogicException(
            "Thumbnails::{$method}() est une doublure inerte du harnais. Le test qui vous "
            ."amène ici dépend réellement du traitement d'image : implémentez ce comportement "
            .'dans tests/Stubs/Estarter/, plutôt que de le laisser renvoyer null.'
        );
    }
}
