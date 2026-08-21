<?php

namespace App\Models;

use Dauvray\Socializer\Tests\Stubs\User as HarnessUser;

/**
 * Doublure du modèle utilisateur de l'APPLICATION HÔTE.
 *
 * Nécessaire parce que `src/routes/socializer/channels.php` fait `use App\Models\User;` et
 * **type ses closures dessus, en dur** — au lieu de passer par `config('estarter.models.user')`
 * comme le reste du paquet. Un `Tests\Stubs\User` ne satisfait donc pas la signature : seule une
 * instance de CETTE classe permet d'invoquer un callback de canal dans un test.
 *
 * ⚠️ Le manque ne se voit pas au chargement : un `use` n'autoload rien, et ni
 * `Broadcaster::channel()` ni la réflexion des paramètres ne résolvent le type. Sans ce fichier,
 * `channels.php` se charge sans broncher et le fatal ne tombe qu'à l'INVOCATION du callback.
 *
 * Étend le modèle du harnais plutôt que de le dupliquer : `$table`, `$fillable` et les traits
 * (`Socializable`, `Sluggable`) sont hérités — `Model::bootTraits()` passe par
 * `class_uses_recursive()`, qui remonte les parents.
 *
 * ⚠️ La colonne `slug` est `unique` : ne pas donner ici un nom déjà employé par `makeUser()`
 * dans le même test, `SlugService` vérifie sur la TABLE et non sur la classe.
 */
class User extends HarnessUser {}
