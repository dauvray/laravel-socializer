import originalState from './feed/state.js'
import actionsFeed from './feed/actions.js'
import gettersFeed from './feed/getters.js'

import { defineStore } from 'pinia'

export const useFeedStore = defineStore('feed', {
  state: originalState,
  getters: gettersFeed,
  actions: actionsFeed,
})
