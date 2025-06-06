<template>
    <button 
        type="button" 
        class="btn btn-link audio-trigger" 
        :class="iconColor"
        title="Audio" >
        <IconWidget icon="microphone-alt"></IconWidget>
    </button>
</template>

<script>

    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    import Uppy from '@uppy/core'
    import Dashboard from '@uppy/dashboard'
    import Audio from '@uppy/audio'
    import French from '@uppy/locales/lib/fr_FR.js'

    import '@uppy/core/dist/style.min.css'
    import '@uppy/dashboard/dist/style.min.css'
    import '@uppy/audio/dist/style.min.css'


    export default {
        name: 'AudioBtn',
        emits: [
            'record-result',
        ],
        components: {
            IconWidget,
        },
        data() {
            return {
                uppy: null,
            };
        },
        mounted() {
            this.uppy = new Uppy()
            .use(Dashboard, { 
                inline: false, 
                target: 'body', 
                trigger: '.audio-trigger',
                proudlyDisplayPoweredByUppy: false, 
                locale: French, 
                closeModalOnClickOutside: true,
                disableLocalFiles: true,
            })
            .use(Audio);

            this.uppy.on('dashboard:modal-open', () => {
                 const dashboard = this.uppy.getPlugin('Dashboard')
                 const audioTabBtn = dashboard.el.querySelector('[data-cy="Audio"]')
                 audioTabBtn.click()
            });

            this.uppy.on('file-added', (file) => {
                const audioBlob = file.data
                const fileName = file.name
                const formData = new FormData()
                formData.append('audio', audioBlob, fileName)

                this.uppy.getPlugin('Dashboard').closeModal()

                // Emets l'audio au parent ou traite-le ici
                this.$emit('record-result', formData)
            });
        },
          beforeUnmount() {
            this.uppy.destroy()
            this.uppy = null
        },

    };
</script>