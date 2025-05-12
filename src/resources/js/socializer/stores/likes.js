import originalState from './likes/state.js'
import actionsLikes from './likes/actions.js'
import gettersLikes from './likes/getters.js'

import { defineStore } from 'pinia'

export const useLikesStore = defineStore('likes', {
  state: originalState,
  getters: gettersLikes,
  actions: actionsLikes,
})
