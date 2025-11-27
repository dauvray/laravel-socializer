<template>
    <div class="user-badge">
        <Gravatar
            :user="user"
            :size="size">
            <template #badge>
                <slot name="badge"></slot>
            </template>
        </Gravatar>
        <div class="user-badge-infos">
            <UserWallLink
                :user="user"
            ></UserWallLink>
            <small>{{ user.function }}</small>
        </div>
    </div>

</template>

<script>
    import { size } from '@floating-ui/dom';
import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'

    export default {
        name: 'Badge',
        props: {
            user: {
                type: Object,
                required: true
            },
            size: {
                type: String,
                required: false,
                default: 'small'
            },
        },
        components: {
            Gravatar,
            UserWallLink
        }
    }
</script>