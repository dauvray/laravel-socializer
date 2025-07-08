<template>
    <div class="d-flex justify-content-end align-items-end border rounded-2 position-relative cover-wrapper"
        style="background-size: cover;"
        :style="{backgroundImage: BackgroundImage}">

        <div class="d-flex align-items-end avatar-wall">
            <AvatarCropper 
                :item="element"
                :editable="element.is_me"
                @update-avatar="onUpdateAvatar"
            ></AvatarCropper>

            <div class="avatar-wall-info ms-2 me-2 rounded bg-opacity-dark-3 shadow-sm border border-1 border-light">
                <h2 class="text-white m-0 p-2">{{ element.name }}</h2>
                <i class="text-white p-2">{{ element.function }}</i>
            </div>

            <div>
                Followers : {{ element.nb_followers - 1 }}
            </div>

            <div v-if="!element.is_me" 
                class="btn-group" 
                role="group" 
                aria-label="Social interaction">
                <FollowButton
                    class="ms-2"
                    style="--bs-btn-padding-y: .25rem; --bs-btn-padding-x: .5rem; --bs-btn-font-size: .70rem;"
                    :user="element"
                ></FollowButton>
                <CallVideoUserButton
                    :user="element"
                ></CallVideoUserButton>
            </div>
        </div>

        <button v-if="element.is_me"
            type="button" 
            class="btn-avatar-edition btn btn-secondary shadow float-right m-2"
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

    </div>
</template>

<script>
   
    import { defineAsyncComponent } from 'vue'
    import { mapActions } from 'pinia'
    import { useWallStore } from '~socializer/stores/wall.js'
    import AvatarCropper from '~estarter/components/widgets/AvatarCropper.vue'
    import FollowButton from '~socializer/components/User/widgets/FollowButton.vue'
    import CallVideoUserButton from '~socializer/components/WebRTC/widgets/CallVideoUserButton.vue'

    export default {
        name: 'Cover',
        components: {
            AvatarCropper,
            IconWidget: defineAsyncComponent(() => import('~estarter/components/widgets/IconWidgetLazy.js')),
            ModalWidget: defineAsyncComponent(() => import('~estarter/components/widgets/ModalLazy.js')),
            CropperWidget: defineAsyncComponent(() => import('~estarter/components/widgets/CropperWidget.vue')),
            FollowButton,
            CallVideoUserButton,
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

<style lang="scss" scoped>

.cover-wrapper {
    height: 150px;

    .avatar-wall {
        position: absolute;
        left: -10px;
        bottom: -30px;

        .avatar-wall-info {
            min-width: 200px;
        }
    }
}

</style>