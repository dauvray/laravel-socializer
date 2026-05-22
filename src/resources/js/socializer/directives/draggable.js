export default {
  mounted(el, binding) {
    const options = binding.value || {};
    if (!options?.draggable) return;

    // 🔑 Si la directive resize a wrappé l'élément, on drag le wrapper
    const target = el._resizeDirective?.wrapper || el;

    let startX = 0, startY = 0, offsetX = 0, offsetY = 0;
    let isDragging = false;

    target.style.touchAction = target.style.touchAction || 'none';

    const onPointerDown = (e) => {
      if (e.button && e.button !== 0) return;
      // 🔑 Ne pas démarrer le drag si on a cliqué sur le grip de resize
      if (e.target.classList?.contains('resize-grip')) return;

      e.preventDefault();
      (e.target || e).setPointerCapture?.(e.pointerId);

      const rect = target.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      offsetX = startX - rect.left;
      offsetY = startY - rect.top;

      isDragging = true;
      target.classList.add('dragging');

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      e.preventDefault();

      const screenWidth = document.documentElement.clientWidth;
      const screenHeight = document.documentElement.clientHeight;
      const rect = target.getBoundingClientRect();

      let x = e.clientX - offsetX;
      let y = e.clientY - offsetY;

      x = Math.max(0, Math.min(x, screenWidth - rect.width));
      y = Math.max(0, Math.min(y, screenHeight - rect.height));

      target.style.position = 'fixed';
      target.style.left = `${x}px`;
      target.style.top = `${y}px`;
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      target.classList.remove('dragging');
      try { (e.target || e).releasePointerCapture?.(e.pointerId); } catch (err) {}
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    // 🔑 On écoute sur `target` (le wrapper), pas sur `el`
    target.addEventListener('pointerdown', onPointerDown);

    el._cleanupDraggable = () => {
      target.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  },

  beforeUnmount(el) {
    if (el._cleanupDraggable) el._cleanupDraggable();
  },
};