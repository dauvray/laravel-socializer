export default {
  mounted(el, binding) {

   const options = binding.value || {};

    // autoriser ou non le glissement
    if(!options?.draggable) return

    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;
    let isDragging = false;

    // Désactiver le comportement tactile natif (scroll) sur cet élément
    // IMPORTANT : ajouter aussi en CSS `touch-action: none;` si possible.
    el.style.touchAction = el.style.touchAction || 'none';

    const onPointerDown = (e) => {
      // ignore les boutons secondaires / wheel click
      if (e.button && e.button !== 0) return;

      e.preventDefault();
      (e.target || e).setPointerCapture?.(e.pointerId);

      const rect = el.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      offsetX = startX - rect.left;
      offsetY = startY - rect.top;

      isDragging = true;
      el.classList.add('dragging');

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();

      const clientX = e.clientX;
      const clientY = e.clientY;

      const screenWidth = document.documentElement.clientWidth;
      const screenHeight = document.documentElement.clientHeight;
      const rect = el.getBoundingClientRect();
      const elementWidth = rect.width;
      const elementHeight = rect.height;

      let x = clientX - offsetX;
      let y = clientY - offsetY;

      x = Math.max(0, Math.min(x, screenWidth - elementWidth));
      y = Math.max(0, Math.min(y, screenHeight - elementHeight));

      el.style.position = 'fixed';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      el.classList.remove('dragging');

      try { (e.target || e).releasePointerCapture?.(e.pointerId); } catch (err) {}
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    // Attacher
    el.addEventListener('pointerdown', onPointerDown);

    // Cleanup
    el._cleanupDraggable = () => {
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  },

  beforeUnmount(el) {
    if (el._cleanupDraggable) el._cleanupDraggable();
  },
};
