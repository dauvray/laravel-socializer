<template>
  <div class="date-separator">
    <div class="date-separator-line"></div>
    <div class="date-separator-text shadow">
      {{ formattedDate }}
    </div>
    <div class="date-separator-line"></div>
  </div>
</template>

<script>
export default {
  name: 'DateSeparator',
  props: {
    date: {
      type: String,
      required: true
    }
  },
  
  computed: {
    formattedDate() {
      const messageDate = new Date(this.date)
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      
      if (messageDate.toDateString() === today.toDateString()) {
        return "Aujourd'hui"
      } else if (messageDate.toDateString() === yesterday.toDateString()) {
        return "Hier"
      } else {
        return messageDate.toLocaleDateString('fr-FR', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })
      }
    }
  }
}
</script>

<style scoped>



</style>