<?php

namespace Dauvray\Socializer\app\Helpers;

class ContentFormater {

    private const YOUTUBE_REGEX = '~https?://(?:[0-9A-Z-]+\.)?(?:youtu\.be/|youtube(?:-nocookie)?\.com\S*[^\w\s-])([\w-]{11})(?=[^\w-]|$)(?![?=&+%\w.-]*(?:[\'"][^<>]*>|</a>))[?=&+%\w.-]*~ix';
    private const YOUTUBE_TEMPLATE = '<div class="ratio ratio-16x9"><iframe width="560" height="315" src="%s" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>';
    private const YOUTUBE_URL = 'https://www.youtube-nocookie.com/embed/%s';

    private const DAILYMOTION_REGEX = '/(?:https?:\/\/)?(?:www\.)?dai\.?ly(?:motion)?(?:\.com)?\/?.*(?:video|embed)?(?:.*v=|v\/|\/)([a-z0-9]+)(?:\?(?:[a-z]*=[a-zA-Z0-9&=]*))?/';
    private const DAILYMOTION_TEMPLATE = '<div class="ratio ratio-16x9"><iframe width="560" height="315" frameborder="0" type="text/html" src="%s" allowfullscreen ></iframe></div>';
    private const DAILYMOTION_URL = 'https://www.dailymotion.com/embed/video/%s?autoplay=0';

    private const FULL_LINK_REGEX = '$([\w+]+\:\/\/)?([\w\d-]+\.)*[\w-]+[\.\:]\w+([\/\?\=\&\#\.\+\]?[\w-]+)*\/?$';
    private const FULL_LINK_TEMPLATE = '<a href="%s" target="_blank" class="slz-post-link">
                                            <div class="card">
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
                                            </div>
                                        </a>';

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
        // Video YouTube
        $this->content = preg_replace_callback(
            self::YOUTUBE_REGEX,
            function($matches) {
                $videoId = $matches[1];
                $videoUrl = sprintf(self::YOUTUBE_URL, $videoId);
                $this->videoUrls[] = $videoUrl;
                return sprintf(self::YOUTUBE_TEMPLATE, $videoUrl);
            },
            $this->content
        );

        // Video Dailymotion
        $this->content = preg_replace_callback(
            self::DAILYMOTION_REGEX,
            function($matches) {
                $videoId = $matches[1];
                $videoUrl = sprintf(self::DAILYMOTION_URL, $videoId);
                $this->videoUrls[] = $videoUrl;
                return sprintf(self::DAILYMOTION_TEMPLATE, $videoUrl);
            },
            $this->content
        );
    }

    private function formatLinks()
    {
        $this->content = preg_replace_callback(
            self::FULL_LINK_REGEX,
            function($matches) {
                $url = $matches[0];
                // Vérifier si l'URL n'est pas une URL de vidéo déjà traitée
                if (!in_array($url, $this->videoUrls)) {
                    $html = '';
                    $page = file_get_contents_curl($url);
                    $data = [];
                    $this->links[] = $url;

                    preg_match('$<\s*meta\s+property="og:title"\s+content="(.*)"\s*\/>$', $page, $matches);
                    if(isset($matches[1])) {
                        $data['title'] = $matches[1];
                    } else {
                        preg_match('$<\s*title\s*>(.*)<\/\s*title\s*>$', $page, $titleMatches);
                        $data['title'] = $titleMatches[1];
                    }

                    preg_match('$<\s*meta\s+property="og:site_name"\s+content="(.*)"\s*\/>$', $page, $matches);
                    if(isset($matches[1])) {
                        $data['site_name'] = $matches[1];
                    } else {
                        preg_match('/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n?]+)/', $url, $urlMatches);
                        $data['site_name'] = $urlMatches[1];
                    }

                    preg_match('$<\s*meta\s+property="og:description"\s+content="(.*)"\s*\/>$', $page, $matches);
                    if(isset($matches[1])) {
                        $data['description'] = $matches[1];
                    } else {
                        preg_match('$<\s*meta\s+name="description"\s+content="(.*)"$', $page, $descriptionMatches);
                        $data['description'] = isset($descriptionMatches[1]) ? $descriptionMatches[1] : '';
                    }

                    preg_match('$<\s*meta\s+property="og:image"\s+content="(.*)"\s*\/>$', $page, $matches);
                    if(isset($matches[1])) {
                        $data['image'] = $matches[1];
                    } else {
                        if(preg_match('/<img.*?src="(.*?)"/', $page, $imgMatches)) {
                            $image = $imgMatches[1];
                            // is relative
                            if($image[0] === '/') {
                                $parsed_url = parse_url($url);
                                $protocol = $parsed_url['scheme'];
                                $domain = $parsed_url['host'];
                                $image = $protocol.'://'.$domain.$image;
                            }
                            $data['image'] = $image;
                        } else {
                            $data['image'] = '';
                        }
                    }

                    if(isset( $data['title']) && isset($data['site_name']) && isset($data['description']) && isset($data['image'])) {
                        return sprintf(self::FULL_LINK_TEMPLATE, $url, $data['image'], $data['site_name'], $data['title'], $data['site_name'], $data['description']);
                    }

                    else {
                        return '<a href="'.$url.'" target="_blank">'.$url.'</a>';
                    }
                }

                return $url;
            },
            $this->content
        );
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
