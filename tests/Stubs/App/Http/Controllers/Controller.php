<?php

namespace App\Http\Controllers;

use Illuminate\Foundation\Auth\Access\AuthorizesRequests;
use Illuminate\Foundation\Validation\ValidatesRequests;
use Illuminate\Routing\Controller as BaseController;

/**
 * Doublure de la classe de base de l'APPLICATION HÔTE.
 *
 * Les contrôleurs du paquet font `use App\Http\Controllers\Controller;` — ils étendent donc
 * une classe que le paquet ne fournit pas. En production elle vient de l'app d'accueil ;
 * sous Testbench il n'y a pas d'app, d'où cette doublure, mappée par `autoload-dev`
 * (`"App\\": "tests/Stubs/App/"`).
 *
 * Copie conforme de celle d'estarter-test : si le paquet cessait un jour d'étendre la classe
 * de l'hôte — ce serait plus sain — ce fichier disparaîtrait avec.
 */
class Controller extends BaseController
{
    use AuthorizesRequests, ValidatesRequests;
}
