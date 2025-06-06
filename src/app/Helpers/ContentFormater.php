<?php

namespace Dauvray\Socializer\app\Helpers;

use Dauvray\Socializer\app\Helpers\Formaters\VideoFormaters;

class ContentFormater {

    use VideoFormaters;

    private const FULL_LINK_TEMPLATE = '<div class="card slz-post-link" onclick="window.open(\'%s\', \'_blank\')">
                                                <div class="row g-0">
                                                    <div class="col-md-4 d-flex justify-content-center">
                                                        <img src="%s" class="img-fluid rounded-start" alt="%s">
                                                    </div>
                                                    <div class="col-md-8">
                                                        <div class="card-body">
                                                            <h5 class="card-title">%s</h5>
                                                            <h6 class="card-sub-title">%s</h6>
                                                            <p class="card-text"><small class="text-muted">%s</small></p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>';

    private const HASHTAG_REGEX = '/(#[\p{L}\p{N}_-]+)/';
    private const HASHTAG_TEMPLATE = '<a href="#" class="fw-bold">%s</a>';

    private const MENTIONS_REGEX = '/(@[a-zA-Z0-9._-]+)/';
    private const MENTIONS_TEMPLATE = '<a href="#" class="fw-bold">%s</a>';


    private $content;
    private $videoUrls = [];
    private $links = [];
    private $hashtags = [];
    private $mentions = [];

    public function __construct($content)
    {
        $this->content = $content;
        $this->formatContent();
    }

    private function formatContent()
    {
        $this->formatVideos();
        $this->formatLinks();
        $this->formatHashtags();
        $this->formatMentions();
    }

    private function formatVideos()
    {
         $result = $this->embedVideos($this->content, $this->videoUrls);
         $this->content = $result['content'];
         $this->videoUrls = array_merge($this->videoUrls, $result['urls_processed']);
    }

    /**
     * Point d’entrée : retourne le contenu avec les liens formatés.
     */
    public function formatLinks(): string
    {
        // 1) Traitement des balises <a href="...">...</a> copiées depuis le navigateur
        $this->content = preg_replace_callback(
            '/<a\s+[^>]*href=[\'"](?P<href>https?:\/\/[^\s\'"]+)[\'"][^>]*>(?:.*?)<\/a>/i',
            function (array $matches) {
                $url = $matches['href'];
                if (!in_array($url, $this->videoUrls)) {
                   return $this->renderLinkPreviewOrFallback($url);
                } 
            },
            $this->content
        );

        // 2) Traitement des URLs brutes (ex. http://example.com/foo)
        //    Cette regex est volontairement plus simple pour éviter les faux positifs sur d’autres balises HTML
        $this->content = preg_replace_callback(
            '/(?<!["\'>])\bhttps?:\/\/[^\s<]+/i',
            function (array $matches) {
                $url = $matches[0];
                if (!in_array($url, $this->videoUrls)) {
                   return $this->renderLinkPreviewOrFallback($url);
                } 
            },
            $this->content
        );

        return $this->content;
    }

    /**
     * Pour une URL donnée, tente de récupérer les données OpenGraph (titre, description, image, site_name).
     * Si toutes les données sont présentes, renvoie le template complet, sinon un <a> simple.
     */
    private function renderLinkPreviewOrFallback(string $url): string
    {
        // Si c’est déjà une URL vidéo qu’on a traitée, on la laisse brute
        if (in_array($url, $this->videoUrls, true)) {
            return '<a href="' . htmlspecialchars($url, ENT_QUOTES, 'UTF-8') . '" target="_blank">' 
                   . htmlspecialchars($url, ENT_QUOTES, 'UTF-8') . '</a>';
        }

        // On mémorise l’URL (si on veut lister toutes les URLs traitées)
        $this->links[] = $url;

        // Récupération du HTML de la page
        $html = file_get_contents_curl($url);

        if ($html === null) {
            // En cas d’échec de connexion, on affiche juste un lien
            return '<a href="' . htmlspecialchars($url, ENT_QUOTES, 'UTF-8') . '" target="_blank">'
                   . htmlspecialchars($url, ENT_QUOTES, 'UTF-8') . '</a>';
        }

        // Extraction des données OpenGraph (ou fallback)
        $data = $this->getLinkPreviewData($html, $url);

        // Si on a bien toutes les infos, on génère la carte complète
        if (! empty($data['title']) 
            && ! empty($data['site_name']) 
            && ! empty($data['description']) 
            && ! empty($data['image'])
        ) {
            return sprintf(
                self::FULL_LINK_TEMPLATE,
                htmlspecialchars($url, ENT_QUOTES, 'UTF-8'),
                htmlspecialchars($data['image'], ENT_QUOTES, 'UTF-8'),
                htmlspecialchars($data['site_name'], ENT_QUOTES, 'UTF-8'),
                htmlspecialchars($data['title'], ENT_QUOTES, 'UTF-8'),
                htmlspecialchars($data['site_name'], ENT_QUOTES, 'UTF-8'),
                htmlspecialchars($data['description'], ENT_QUOTES, 'UTF-8')
            );
        }

        // Sinon, on retourne simplement un <a href>
        return '<a href="' . htmlspecialchars($url, ENT_QUOTES, 'UTF-8') . '" target="_blank">'
               . htmlspecialchars($url, ENT_QUOTES, 'UTF-8') . '</a>';
    }

    /**
     * Extrait et renvoie un tableau de données pour la vignette :
     * - title      (og:title ou <title>)
     * - site_name  (og:site_name ou domaine)
     * - description (og:description ou meta description)
     * - image      (og:image ou première <img> / fallback URL absolue)
     */
    private function getLinkPreviewData(string $html, string $url): array
    {
        $dom = new \DOMDocument();
        libxml_use_internal_errors(true);
        // On injecte un encodage pour gérer correctement les caractères accentués
        @$dom->loadHTML('<?xml encoding="UTF-8">' . $html);
        libxml_clear_errors();

        $xpath = new \DOMXPath($dom);
        $data = [
            'title'       => '',
            'site_name'   => '',
            'description' => '',
            'image'       => ''
        ];

        // --- 1) TITLE ---
        // Priorité à og:title
        $node = $xpath->query('//meta[@property="og:title"]/@content');
        if ($node->length > 0 && $node->item(0)->nodeValue !== '') {
            $data['title'] = trim(html_entity_decode($node->item(0)->nodeValue, ENT_QUOTES, 'UTF-8'));
        } else {
            // Fallback sur <title>
            $titleTags = $dom->getElementsByTagName('title');
            if ($titleTags->length > 0) {
                $data['title'] = trim(html_entity_decode($titleTags->item(0)->textContent, ENT_QUOTES, 'UTF-8'));
            }
        }

        // --- 2) SITE NAME ---
        // Priorité à og:site_name
        $node = $xpath->query('//meta[@property="og:site_name"]/@content');
        if ($node->length > 0 && $node->item(0)->nodeValue !== '') {
            $data['site_name'] = trim(html_entity_decode($node->item(0)->nodeValue, ENT_QUOTES, 'UTF-8'));
        } else {
            // Fallback : domaine de l’URL
            if (preg_match('#^(?:https?://)?(?:www\.)?([^/]+)#i', $url, $m)) {
                $data['site_name'] = $m[1];
            }
        }

        // --- 3) DESCRIPTION ---
        // Priorité à og:description
        $node = $xpath->query('//meta[@property="og:description"]/@content');
        if ($node->length > 0 && $node->item(0)->nodeValue !== '') {
            $data['description'] = trim(html_entity_decode($node->item(0)->nodeValue, ENT_QUOTES, 'UTF-8'));
        } else {
            // Fallback sur <meta name="description">
            $node = $xpath->query('//meta[@name="description"]/@content');
            if ($node->length > 0 && $node->item(0)->nodeValue !== '') {
                $data['description'] = trim(html_entity_decode($node->item(0)->nodeValue, ENT_QUOTES, 'UTF-8'));
            }
        }

        // --- 4) IMAGE ---
        // Priorité à og:image
        $node = $xpath->query('//meta[@property="og:image"]/@content');
        if ($node->length > 0 && $node->item(0)->nodeValue !== '') {
            $data['image'] = $this->makeAbsoluteUrl(trim($node->item(0)->nodeValue), $url);
        } else {
            // Fallback : première balise <img>
            $imgs = $dom->getElementsByTagName('img');
            if ($imgs->length > 0) {
                $src = $imgs->item(0)->getAttribute('src');
                if ($src !== '') {
                    $data['image'] = $this->makeAbsoluteUrl($src, $url);
                }
            }
        }

        return $data;
    }

    /**
     * Transforme une URL relative (ex. "/images/foo.jpg") en URL absolue 
     * en se basant sur la racine de $pageUrl.
     * Si $src est déjà absolue, on la renvoie telle quelle.
     */
    private function makeAbsoluteUrl(string $src, string $pageUrl): string
    {
        // Si c’est déjà absolue (commence par http ou https), on retourne directement
        if (preg_match('#^https?://#i', $src)) {
            return $src;
        }

        // Sinon on reconstruit à partir du domaine de la page
        $parsed = parse_url($pageUrl);
        $scheme = $parsed['scheme'] ?? 'http';
        $host   = $parsed['host']   ?? '';
        if (strpos($src, '/') === 0) {
            // Ex. "/foo/bar.png"
            return $scheme . '://' . $host . $src;
        }

        // Chemin relatif sans slash initial : ex. "img/photo.jpg"
        $path = $parsed['path'] ?? '/';
        // On retire le dernier segment de path (ex. "/foo/bar.html" -> "/foo/")
        $path = preg_replace('#/[^/]*$#', '/', $path);
        return $scheme . '://' . $host . $path . $src;
    }


    private function formatHashtags() 
    {
        $this->content = preg_replace_callback(
            self::HASHTAG_REGEX,
            function($matches) {
                $hashtag = $matches[1];
                $this->hashtags[] = $hashtag;
                return sprintf(self::HASHTAG_TEMPLATE, $hashtag);
            },
            $this->content
        );
    }

    private function formatMentions() 
    {
        $this->content = preg_replace_callback(
            self::MENTIONS_REGEX,
            function($matches) {
                $mention = $matches[1];
                $this->mentions[] = $mention;
                return sprintf(self::MENTIONS_TEMPLATE, $mention);
            },
            $this->content
        );
    }

    public function getContent()
    {
        return $this->content;
    }

    public function getHashtags()
    {
        return $this->hashtags;
    }

    public function getMentions()
    {
        return $this->mentions;
    }
}
