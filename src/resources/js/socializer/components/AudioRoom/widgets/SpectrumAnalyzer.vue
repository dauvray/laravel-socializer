<template>
    <canvas :id="uid"></canvas>
</template>

<script>
    import { uniqueId } from '~estarter/services/helpers.js'

    export default {
        name: 'SpectrumAnalyzer',
        props: {
            streams: {
                type: Array, // Liste des MediaStreams distants
                required: true
            }
        },
        data() {
            return {
                audioContext: null,
                analyser: null,
                mixer: null,
                source: null, // pas besoin de source pour l'analyseur
                dataArray: null,
                canvas: null,
                ctx: null,
                uid: uniqueId('spectrum-analyzer-'),
                sourceMap: new Map(), // Map(MediaStream -> MediaStreamAudioSourceNode)
                draw: null, 
            }
        },
        watch: {
            streams: {
                immediate: true,
                deep: true,
                handler(newStreams, oldStreams) {
                    if(!newStreams) newStreams = []
                    if(!oldStreams) oldStreams = []
                    if(this.audioContext) {
                        // Met à jour les sources audio en fonction des streams
                        this.updateStreams(newStreams, oldStreams)
                    }
                    
                }
            }
        },
        mounted() {
            // Dans certains navigateurs (surtout Chrome), l’audio context peut être en suspended
            //  tant qu’il n’y a pas eu de clic utilisateur.
            document.addEventListener('click', () => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume()
            }
            }, { once: true })


            this.canvas = document.getElementById(this.uid);
            this.ctx = this.canvas.getContext('2d');
            window.addEventListener('resize', this.resizeCanvas);
            this.resizeCanvas();
            this.startVisualizer(this.streams)

            this.draw = () => {

                requestAnimationFrame(this.draw);
                this.analyser.getByteFrequencyData(this.dataArray);
                this.ctx.fillStyle = 'rgba(0, 0, 0, 0.1)'; // effet glow
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                const barWidth = (this.canvas.width / this.dataArray.length) * 2.5;
                let x = 0;

                for (let i = 0; i < this.dataArray.length; i++) {
                    const barHeight = this.dataArray[i] * 0.7;
                    const hue = (i / this.dataArray.length) * 360;

                    this.ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
                    this.ctx.fillRect(x, this.canvas.height - barHeight, barWidth, barHeight);

                    x += barWidth + 1;
                }
            }

            this.draw()
        },
        beforeUnmount() {
             window.removeEventListener('resize', this.resizeCanvas);

            if (this.audioContext) {
                for (const source of this.sourceMap.values()) {
                    try {
                        source.disconnect()
                    } catch (e) {
                        console.warn('Erreur lors du disconnect', e)
                    }
                }

                this.mixer?.disconnect()
                this.analyser?.disconnect()
                this.audioContext.close()
            }
        },
        methods: {
            startVisualizer(streams) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 256; // Taille FFT (résolution)
                this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

                 // 🎛️ Mixer (gain ou merger)
                 this.mixer = this.audioContext.createGain() // ou createChannelMerger()

                // Connecte chaque stream distant au mixer
                streams.forEach(stream => {
                    const source = this.audioContext.createMediaStreamSource(stream)
                    source.connect(this.mixer)
                })

                 // Connecte le mixer à l'analyser
                this.mixer.connect(this.analyser)

                // Optionnel : entendre aussi
                this.mixer.connect(this.audioContext.destination)

               
            },
            updateStreams(newStreams, oldStreams) {

                const newSet = new Set(newStreams)
                const oldSet = new Set(oldStreams)

                // ➕ Ajoutés
                for (const stream of newStreams) {
                    if (!oldSet.has(stream)) {
                        const source = this.audioContext.createMediaStreamSource(stream)
                        source.connect(this.mixer)
                        this.sourceMap.set(stream, source)
                    }
                }

                // ➖ Supprimés
                for (const stream of oldStreams) {
                    if (!newSet.has(stream)) {
                        const source = this.sourceMap.get(stream)
                        if (source) {
                            try {
                                source.disconnect()
                            } catch (e) {
                                console.warn('Erreur lors du disconnect de la source audio', e)
                            }
                            this.sourceMap.delete(stream)
                        }
                    }
                }
            },
            resizeCanvas() {
                const canvas = this.canvas;
                if (!canvas) return;

                // Taille affichée sur la page (CSS)
                const parent = canvas.parentElement;
                const displayWidth = parent.clientWidth;
                const displayHeight = parent.clientHeight;

                // On évite de redessiner trop souvent
                if (canvas.width === displayWidth && canvas.height === displayHeight) return;

                // Mise à jour de la résolution interne
                canvas.width = displayWidth;
                canvas.height = displayHeight;
            }
        }
    }
</script>