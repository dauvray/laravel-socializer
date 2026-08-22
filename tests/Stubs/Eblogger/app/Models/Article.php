<?php

namespace Dauvray\Eblogger\app\Models;

/**
 * Doublure du modèle d'eblogger — le strict nécessaire aux deux listeners d'article.
 *
 * Ce n'est PAS un modèle Eloquent, et c'est volontaire : les listeners ne lisent que `->id`, et
 * `hideIdentifier()` que la classe et l'`id`.
 *
 * ⚠️ Surtout, elle n'expose PAS de `vertexId` — et c'est la propriété qu'elle doit à tout prix
 * reproduire. Le vrai `Article` n'a ni `Socializable` ni `Commentable`, donc pas cet accesseur :
 * `populatePropsFromPattern` ne fournit aucun id pour lui, et l'appelant DOIT le poser lui-même.
 * Lui en donner un ici masquerait le défaut même que `ArticleVertexTest` épingle.
 */
class Article
{
    public function __construct(public int $id) {}
}
