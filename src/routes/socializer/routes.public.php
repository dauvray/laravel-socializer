<?php

use Illuminate\Support\Facades\Route;

Route::post('/get-comments',
    config('socializer.controllers_front.comment').'@getComments')
    ->name('comments.get');

Route::post('/get-sub-comments',
    config('socializer.controllers_front.comment').'@getSubComments')
    ->name('subcomments.get');

Route::post('/get-total-comments', 
    config('socializer.controllers_front.comment').'@getTotalComments')
    ->name('comments.total');

    Route::get('/titi-toto', 
    config('socializer.controllers_front.feed').'@testQuery')
    ->name('comments.total');