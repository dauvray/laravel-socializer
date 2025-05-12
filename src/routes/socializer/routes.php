<?php

use Illuminate\Support\Facades\Route;

Route::group(['middleware' => config('estarter.routes_middlewares.classic.private')], function () {
    require('routes.private.php');
});

Route::group(['middleware' => config('estarter.routes_middlewares.classic.public')], function () {
    require('routes.public.php');
});
