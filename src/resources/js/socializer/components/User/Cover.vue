<template>
    <section class="cover-wrapper"
        :style="{backgroundImage: BackgroundImage}">

        <div class="avatar-cover">
            <AvatarCropper 
                :item="element"
                :editable="element.is_me"
                @update-avatar="onUpdateAvatar"
            ></AvatarCropper>

            <div class="avatar-cover-info">
                <h2>{{ element.name }}</h2>
                <i>{{ element.function }}</i>
            </div>

            <div>
                Abonnés : {{ element.nb_followers - 1 }}
            </div>

            <div v-if="!element.is_me" 
                class="tools-cover" 
                role="group" 
                aria-label="Social interaction">
                <FollowButton
                    style="--bs-btn-padding-y: .25rem; --bs-btn-padding-x: .5rem; --bs-btn-font-size: .70rem;"
                    :user="element"
                ></FollowButton>
                <CallUserButton
                    v-if="user.connected"
                    :user="element"
                ></CallUserButton>
            </div>
        </div>

        <button v-if="element.is_me"
            type="button" 
            class="cover-image-edit-btn"
            @click="onShowModal">
            <IconWidget icon="camera"></IconWidget>
        </button>   

        <modal-widget
            v-if="showModal"
            target="changecover"
            modal-classes="modal-fullscreen"
            :show-btn="false"
            :trigger="showModal"
            :canValidate="canValidateCover"
            @hidden="onHideModal"
            @saveModalChanges="onSaveModalChanges">
            <template #header>
                Modifier couverture
            </template>
            <template #body>
                <CropperWidget
                    ref="cropper"
                    stencil="cover"
                    :currentimage="urlCover"
                    @canValidate="canValidateCover = true"
                    @onCroppedPicture="onCroppedCover"
                ></CropperWidget>
            </template>
        </modal-widget>

    </section>
</template>

<script>
   
    import { defineAsyncComponent } from 'vue'
    import { mapActions } from 'pinia'
    import { useWallStore } from '~socializer/stores/wall.js'
    import AvatarCropper from '~estarter/components/widgets/AvatarCropper.vue'
    import FollowButton from '~socializer/components/User/widgets/FollowButton.vue'
    import CallUserButton from '~socializer/components/WebRTC/widgets/CallUserButton.vue'

    export default {
        name: 'Cover',
        components: {
            AvatarCropper,
            IconWidget: defineAsyncComponent(() => import('~estarter/components/widgets/IconWidgetLazy.js')),
            ModalWidget: defineAsyncComponent(() => import('~estarter/components/widgets/ModalLazy.js')),
            CropperWidget: defineAsyncComponent(() => import('~estarter/components/widgets/CropperWidget.vue')),
            FollowButton,
            CallUserButton,
        },
        props: {
            user: {
                type: Object,
                required: true
            },
            size: {
                type: String,
                required: false,
                default: 'medium'
            }
        },
        data() {
            return {
                showModal: false,
                file: null,
                element: this.user,
                canValidateCover: false
            }
        },
        computed: {
            BackgroundImage: function() {
                return `url(${this.urlCover})`
            },
            urlCover: function() {
                return this.element.cover
                    ? `/storage/users/${this.element.cover}`
                    : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
               
            },
        },
        methods: {
            ...mapActions(useWallStore, [
                'updateCover',
                'updateAvatar',
            ]),
            onShowModal() {
                this.showModal = true
            },
            onHideModal() {
                this.showModal = false
            },
            onCroppedCover(file) {
                if(file) {
                    this. canValidateAvatar = true
                    this.file = file
                }
            },
            onSaveModalChanges() {
                let formData = new FormData()
                formData.append('file', this.file )

                this.updateCover(formData)
                .then(res => {
                    this.element = {...this.element, cover: res }
                    this.showModal = false
                })
            },
            onUpdateAvatar(formData)
            {
                this.updateAvatar(formData)
                .then(res => {
                     this.element = {...this.element, image: res }
                })
            }
        }
    }
</script>
