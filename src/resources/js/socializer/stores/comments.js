import originalState from './comments/state.js'
import actionsComments from './comments/actions.js'
import gettersComments from './comments/getters.js'

import { defineStore } from 'pinia'

export const useCommentStore = defineStore('comments', {
  state: originalState,
  getters: gettersComments,
  actions: actionsComments,
})
