<template>
    <canvas :id="uid"></canvas>
</template>

<script>
    import { uniqueId } from '~estarter/services/helpers.js'

    export default {
        name: 'SpectrumAnalyzer',
        props: {
            stream: {
                type: MediaStream,
                required: true,
                default: null
            }
        },
        data() {
            return {
                audioContext: null,
                analyser: null,
                source: null,
                dataArray: null,
                canvas: null,
                ctx: null,
                uid: uniqueId('spectrum-analyzer-')
            }
        },
        mounted() {
            this.canvas = document.getElementById(this.uid);
            this.ctx = this.canvas.getContext('2d');
            window.addEventListener('resize', this.resizeCanvas);
            this.resizeCanvas();
            this.startVisualizer(this.stream)
        },
        beforeUnmount() {
             window.removeEventListener('resize', this.resizeCanvas);
        },
        methods: {
            startVisualizer(stream) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 256; // Taille FFT (résolution)
                const bufferLength = this.analyser.frequencyBinCount;
                this.dataArray = new Uint8Array(bufferLength);

                this.source = this.audioContext.createMediaStreamSource(stream);
                this.source.connect(this.analyser);

                this.analyser.connect(this.audioContext.destination); // Pour entendre le son aussi

                this.draw();
            },
            draw() {
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