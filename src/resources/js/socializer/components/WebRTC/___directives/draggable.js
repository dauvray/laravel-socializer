export default {
    mounted(el) {
        let offsetX = 0;
        let offsetY = 0;
        let isDragging = false;

        const startDragging = (e) => {
            e.preventDefault();

            // Calculer l'offset relatif à la souris
            const rect = el.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top + 100;

            isDragging = true;
            el.classList.add('dragging');

            // Ajouter les écouteurs globaux pour le déplacement et l'arrêt
            window.addEventListener('mousemove', dragElement);
            window.addEventListener('mouseup', stopDragging);
        };

        const dragElement = (e) => {
            if (!isDragging) return;

            // Dimensions de l'écran visible
            const screenWidth = document.documentElement.clientWidth;
            const screenHeight = document.documentElement.clientHeight;

            // Dimensions de l'élément
            const rect = el.getBoundingClientRect();
            const elementWidth = rect.width;
            const elementHeight = rect.height;

            // Calculer la nouvelle position avec limites
            let x = e.clientX - offsetX;
            let y = e.clientY - offsetY;

            // Limiter la position horizontale (gauche et droite)
            x = Math.max(0, Math.min(x, screenWidth - elementWidth));

            // Limiter la position verticale (haut et bas)
            y = Math.max(0, Math.min(y, screenHeight - elementHeight));

            // Appliquer les nouvelles coordonnées à l'élément
            el.style.position = 'fixed';
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
        };

        const stopDragging = () => {
            if (!isDragging) return;

            isDragging = false;
            el.classList.remove('dragging');

            // Nettoyer les écouteurs globaux
            window.removeEventListener('mousemove', dragElement);
            window.removeEventListener('mouseup', stopDragging);
        };

        // Attacher les écouteurs locaux
        el.addEventListener('mousedown', startDragging);

        // Nettoyer lors du démontage
        el._cleanupDraggable = () => {
            el.removeEventListener('mousedown', startDragging);
            window.removeEventListener('mousemove', dragElement);
            window.removeEventListener('mouseup', stopDragging);
        };
    },
    beforeUnmount(el) {
        if (el._cleanupDraggable) {
            el._cleanupDraggable();
        }
    },
};