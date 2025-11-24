<?php

namespace Dauvray\Socializer\app\Helpers\Formaters;

trait VideoFormaters
{

    private const VIDEO_PROVIDERS = [
        'youtube' => [
            'regex_html' => '~<a[^>]*href="(https?://(?:www\.)?(?:youtube(?:-nocookie)?\.com/(?:watch\?v=|embed/|v/)|youtu\.be/)([a-zA-Z0-9_-]{11}))(?:\?[^"\s\']*)?"[^>]*>.*?</a>~i',
            'regex_raw' => '~(?<!["\'])\b(https?://(?:www\.)?(?:youtube(?:-nocookie)?\.com/(?:watch\?v=|embed/|v/)|youtu\.be/)([a-zA-Z0-9_-]{11}))(?:\?[^"\s\']*)?\b(?!["\'])~i',
            'embed_url'  => 'https://www.youtube-nocookie.com/embed/%s',
        ],
        'vimeo' => [
            'regex_html' => '~<a[^>]*href="(https?://(?:www\.)?vimeo\.com/(\d+))"[^>]*>.*?</a>~i',
            'regex_raw'  => '~(?<!["\'])\b(https?://(?:www\.)?vimeo\.com/(\d+))\b(?!["\'])~i',
            'embed_url'  => 'https://player.vimeo.com/video/%s',
        ],
        'dailymotion' => [
            'regex_html' => '~<a[^>]*href="(https?://(?:www\.)?dailymotion\.com/video/([a-zA-Z0-9]+))"[^>]*>.*?</a>~i',
            'regex_raw'  => '~(?<!["\'])\b(https?://(?:www\.)?dailymotion\.com/video/([a-zA-Z0-9]+))\b(?!["\'])~i',
            'embed_url'  => 'https://www.dailymotion.com/embed/video/%s',
        ],
        'tiktok' => [
            'regex_html' => '~<a[^>]*href="(https?://www\.tiktok\.com/@[^/]+/video/(\d+))[^"]*"[^>]*>.*?</a>~i',
            'regex_raw'  => '~(?<!["\'])\b(https?://www\.tiktok\.com/@[^/]+/video/(\d+))[^"\s\']*\b(?!["\'])~i',
            'embed_url'  => 'https://www.tiktok.com/embed/%s',
        ],
        'facebook' => [
            'regex_html' => '~<a[^>]*href="(https?://www\.facebook\.com/[^/]+/videos/(\d+)[^"]*)"[^>]*>.*?</a>~i',
            'regex_raw'  => '~(?<!["\'])\b(https?://www\.facebook\.com/[^/]+/videos/(\d+)[^\s"\']*)\b(?!["\'])~i',
            'embed_url'  => 'https://www.facebook.com/plugins/video.php?href=%s',
            'use_raw_url' => true,
        ],
    ];

    private const EMBED_TEMPLATE = '<div class="video-wrapper"><iframe src="%s" title="Embedded video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>';

    public function embedVideos(string $content, array $urls_processed = []): array
    {
        foreach (self::VIDEO_PROVIDERS as $provider => $data) {

            // 1. Remplacer les liens <a> contenant une URL vidéo
            $content = preg_replace_callback(
                $data['regex_html'],
                function ($matches) use (&$urls_processed, $data) {
                    $videoId = $data['use_raw_url'] ?? false ? $matches[1] : $matches[2];
                    $embedUrl = $data['use_raw_url'] ?? false
                        ? sprintf($data['embed_url'], urlencode($videoId))
                        : sprintf($data['embed_url'], $videoId);

                    $urls_processed[] = $embedUrl;
                    return sprintf(self::EMBED_TEMPLATE, $embedUrl);
                },
                $content
            );

            // 2. Remplacer les URLs brutes
            $content = preg_replace_callback(
                $data['regex_raw'],
                function ($matches) use (&$urls_processed, $data) {
                    $videoId = $data['use_raw_url'] ?? false ? $matches[1] : $matches[2];
                    $embedUrl = $data['use_raw_url'] ?? false
                        ? sprintf($data['embed_url'], urlencode($videoId))
                        : sprintf($data['embed_url'], $videoId);

                    $urls_processed[] = $embedUrl;
                    return sprintf(self::EMBED_TEMPLATE, $embedUrl);
                },
                $content
            );
        }

        return ['content' => $content, 'urls_processed' => $urls_processed];
    }

}