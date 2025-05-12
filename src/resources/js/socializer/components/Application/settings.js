const dependencies = {
    "vue": "https://unpkg.com/vue@3/dist/vue.global.js",
    "bootstrap": "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css", 
    "bootstrap.js": "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js",
    "bootstrap.icons": "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css",
    "vueuse": [ // utilitaires Vue.js
        "https://unpkg.com/@vueuse/core",
        "https://unpkg.com/@vueuse/shared"
    ],
    "vue-i18n": "https://unpkg.com/vue-i18n@9/dist/vue-i18n.global.js", // internationalisation
    "dayjs": "https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js", // gestion des dates
    "axios": "https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js", // requêtes HTTP
    "phaser": "https://cdn.jsdelivr.net/npm/phaser@3.88.2/dist/phaser.min.js", // jeu 2D
    "chart.js": "https://cdn.jsdelivr.net/npm/chart.js", // bibliothèque de graphiques
    "d3.js": "https://cdn.jsdelivr.net/npm/d3@7", // visualisation de données
    "ag grid": "https://cdn.jsdelivr.net/npm/ag-grid-community/dist/ag-grid-community.min.js", // tableau de données
    "sheetjs": "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js", // gestion de fichiers Excel
    "papaparse": [ // analyse de fichiers CSV
        "https://cdn.jsdelivr.net/npm/papaparse@5.5.2/papaparse.min.js",
        "https://cdn.jsdelivr.net/npm/papaparse@5.5.2/player/player.min.css"
    ],
    "pdf.js": "https://cdnjs.com/libraries/pdf.js", // afficher des fichiers PDF
    "ddompurify": "https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.4/purify.min.js", // sécurité contre les XSS
    "sortablejs": "https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js", // tri de listes
    "mousetrap": "https://cdn.jsdelivr.net/npm/mousetrap@1.6.5/mousetrap.min.js", // gestion des raccourcis clavier
    "tinymce": [ // éditeur de texte
        "https://cdn.jsdelivr.net/npm/tinymce@7.7.2/tinymce.min.js",
        "https://cdn.jsdelivr.net/npm/tinymce@7.7.2/skins/ui/oxide/content.min.css",
    ],
    "filesaver.js": "https://cdn.jsdelivr.net/npm/filesaver@0.0.13/src/Filesaver.min.js", // téléchargement de fichiers
    "jszip": "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js", // compression et décompression de fichiers
    "dropzone": [ // gestion de glisser-déposer
        "https://cdn.jsdelivr.net/npm/dropzone@6.0.0-beta.2/dist/dropzone-min.min.js",
        "https://cdn.jsdelivr.net/npm/dropzone@6.0.0-beta.2/dist/dropzone.min.css",
    ],
    "tesseract.js": "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.0/dist/tesseract.min.js", // reconnaissance de texte
    "autonumeric.js": "https://cdn.jsdelivr.net/npm/autonumeric@4.10.8/dist/autoNumeric.min.js", // formatage des nombres
    "mark.js": "https://cdn.jsdelivr.net/npm/mark.js@8.11.1/dist/jquery.mark.min.js", // surlignage de texte
    "diffdom": "https://cdn.jsdelivr.net/npm/diff-dom@5.1.4/dist/index.min.js", // comparaison de documents
};

export { dependencies };