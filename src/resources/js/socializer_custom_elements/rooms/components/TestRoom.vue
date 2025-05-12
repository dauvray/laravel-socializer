<template>
    Test Room Component
    <Teleport :to="`#collapser-${room.id}`" >
        <div class="card">
            Placeholder to custom module for TestRoom component
        </div>
    </Teleport>

    <Teleport :to="`#dropdown-slot-${room.id}`" >
        <ul class="list-group list-group-flush">
            <li class="list-group-item p-0">
                <button type="button" 
                    class="list-group-item list-group-item-action p-0 border-0">
                    Fake custom link
                </button>
            </li>
        </ul>
    </Teleport>
</template>

<script>
    export default {
        name: 'TestRoom',
        props: {
            editable: {
                type: Boolean,
                required: false,
                default: false
            },
            room: {
                type: Object,
                required: false,
                default: null,
            },
            users: {
                type: Array,
                required: false,
                default: []
            }
        },
    }
</script>