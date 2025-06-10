<template>
  <button v-if="compatibility" @click="toggleListening" class="btn" title="Transcrire la voix" :class="{ 'text-danger': listening}">
    <IconWidget icon="comment-dots"></IconWidget>
  </button>
</template>

<script>
import IconWidget from '~estarter/components/widgets/IconWidget.vue'
export default {
  name: 'VoiceToTextStream',
  inject: ["eventBus"],
  emits: [
    'text-voiced',
  ],
  props: {
    onFinalTranscript: Function
  },
  components: {
    IconWidget,
  },
  data() {
    return {
      recognition: null,
      listening: false,
      transcript: '',
      compatibility: true,
    }
  },
  mounted() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      console.log("L'API Web Speech n'est pas supportée par ce navigateur.");
      this.compatibility = false;
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'fr-FR';
    this.recognition.interimResults = true;
    this.recognition.continuous = true;

    this.recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';
      
      // Parcourir TOUS les résultats depuis le début
      for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }
      
      // Le transcript complet = final + interim
      this.transcript = finalTranscript + interimTranscript;
      
      // Émettre le texte complet
      this.$emit('text-voiced', this.transcript);
      
      // Si on a du nouveau texte final, appeler le callback
      if (finalTranscript && this.onFinalTranscript) {
        // Pour éviter les doublons, on peut stocker le dernier texte final
        if (!this.lastFinalTranscript || finalTranscript !== this.lastFinalTranscript) {
          const newText = this.lastFinalTranscript ? 
            finalTranscript.substring(this.lastFinalTranscript.length) : 
            finalTranscript;
          
          if (newText.trim()) {
            this.onFinalTranscript(newText.trim());
          }
          this.lastFinalTranscript = finalTranscript;
        }
      }
    };

    this.recognition.onend = () => {
      this.listening = false;
    };

    this.recognition.onerror = (event) => {
      console.error('Erreur de reconnaissance vocale :', event.error);
      this.listening = false;
    };

    this.eventBus.$on('sended-messenger-message', this.stopRecognition);

  },
  methods: {
    toggleListening() {
      if (this.listening) {
        this.recognition.stop();
      } else {
        this.transcript = '';
        this.lastFinalTranscript = '';
        this.recognition.start();
        this.listening = true;
      }
    },
    getFinalText() {
      return this.transcript;
    },
    clearTranscript() {
      this.transcript = '';
      this.lastFinalTranscript = '';
    },
    stopRecognition() {
      if (this.recognition && this.listening) {
        this.recognition.stop();
        this.listening = false;
      }
    }
  }
};
</script>