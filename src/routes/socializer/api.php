<?php

use Illuminate\Support\Facades\Route;

// tests
Route::post('/bot-response-answer', function () {
   \Log::info('Bot response answer received');
});


