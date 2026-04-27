<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Dauvray\Socializer\app\Services\Page as PageService;

class PageController extends Controller
{
    public function loadPage(PageService $service, $page_id = null)
    {
        $page = $service->loadPage($page_id);
        
        if($page) {
            return response()->json([
                'page' => renderContentToBlade($page->content),
                'webbuilder' => $page->content,
                'styles' => $page->styles,
                'script' => $page->script,
                'identifier' => hideIdentifier($page)
            ], 200);
        }
    }

    public function updatePage(Request $request, PageService $service)
    {
        return response()->json($service->updatePage($request), 200);
    }

    public function generatePage(Request $request, PageService $service)
    {
        return response()->json($service->generatePage($request), 200);
    }
}
