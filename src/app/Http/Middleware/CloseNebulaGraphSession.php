<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class CloseNebulaGraphSession
{
    public function handle(Request $request, Closure $next)
    {
        return $next($request);
    }

    public function terminate($request, $response)
    {
        try {
            app('nebulaGraph')->logout();
        } catch (\Throwable $e) {
            logger()->warning('[Nebula] Failed to logout in middleware: ' . $e->getMessage());
        }
    }
}