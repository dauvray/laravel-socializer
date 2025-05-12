<?php

Route::group([
    'prefix'     => config('backpack.base.route_prefix', 'admin'),
    'middleware' => ['web', 'admin'],
], function () {

    // // network
    // Route::get('network/search/{id}/restore', config('socializer.controllers_back.network').'@restore');
    // Route::get('network/search/{id}/forcedelete', config('socializer.controllers_back.network').'@forceDelete');
    // Route::crud('network', config('socializer.controllers_back.network'));

    // // network users
    // Route::get('network-user/search/{id}/restore', config('socializer.controllers_back.user').'@restore');
    // Route::get('network-user/search/{id}/forcedelete', config('socializer.controllers_back.user').'@forceDelete');
    // Route::crud('network-user', config('socializer.controllers_back.user'));
});
