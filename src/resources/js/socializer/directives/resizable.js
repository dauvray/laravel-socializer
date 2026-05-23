// directive-resize.js
export default {
  mounted(el, binding) {
    const options = binding.value || {};
    if (options.resizable === false) return;

    const wrapperId = options.wrapperId || null;
    const corner = options.corner || 'bottom-right';
    const minSize = options.minSize || { width: 200, height: 112 };
    const maxSize = options.maxSize || { width: 800, height: 450 };

    // --- Grip ---
    const grip = document.createElement('div');
    grip.className = 'resize-grip';
    const gripStyles = {
      'top-left':     'top: -5px; left: -5px; cursor: nw-resize;',
      'top-right':    'top: -5px; right: -5px; cursor: ne-resize;',
      'bottom-left':  'bottom: -5px; left: -5px; cursor: sw-resize;',
      'bottom-right': 'bottom: -5px; right: -5px; cursor: se-resize;'
    };
    grip.style.cssText = `
      position: absolute;
      width: 10px; height: 10px;
      background: #007bff;
      border: 2px solid white;
      border-radius: 50%;
      z-index: 1000;
      ${gripStyles[corner]}
    `;

    // --- Wrapper ---
    const wrapper = document.createElement('div');
    if (wrapperId) wrapper.id = wrapperId;

    const initialWidth  = Math.max(el.offsetWidth,  minSize.width);
    const initialHeight = Math.max(el.offsetHeight, minSize.height);

    wrapper.style.cssText = `
      position: relative;
      display: inline-block;
      width: ${initialWidth}px;
      height: ${initialHeight}px;
      left: 0px;
      top: 0px;
    `;

    el.parentNode.insertBefore(wrapper, el);
    wrapper.appendChild(el);
    wrapper.appendChild(grip);

    el.style.cssText += `width: 100%; height: 100%; display: block;`;

    // --- State ---
    let isResizing = false;
    let startX, startY, startWidth, startHeight;
    let startOffsetX = 0, startOffsetY = 0;
    const aspectRatio = wrapper.offsetWidth / wrapper.offsetHeight;

    const updateSize = (w, h, ox, oy) => {
      wrapper.style.width  = w + 'px';
      wrapper.style.height = h + 'px';
      wrapper.style.left   = ox + 'px';
      wrapper.style.top    = oy + 'px';

      const detail = { width: w, height: h, aspectRatio };
      el.dispatchEvent(new CustomEvent('video-resize', { detail }));
      if (typeof options.onResize === 'function') options.onResize(detail);
    };

    // Calcule la nouvelle taille ET le décalage nécessaire pour que
    // le coin OPPOSÉ à la poignée reste fixe (donc la poignée suit la souris).
    const computeResize = (deltaX, deltaY) => {
      let newWidth, newHeight;
      switch (corner) {
        case 'top-left':
          newWidth  = startWidth  - deltaX;
          newHeight = startHeight - deltaY;
          break;
        case 'top-right':
          newWidth  = startWidth  + deltaX;
          newHeight = startHeight - deltaY;
          break;
        case 'bottom-left':
          newWidth  = startWidth  - deltaX;
          newHeight = startHeight + deltaY;
          break;
        case 'bottom-right':
          newWidth  = startWidth  + deltaX;
          newHeight = startHeight + deltaY;
          break;
      }

      // Conserver le ratio
      const ratio = Math.min(newWidth / startWidth, newHeight / startHeight);
      newWidth  = startWidth  * ratio;
      newHeight = startHeight * ratio;

      // Contraintes min/max
      newWidth  = Math.max(minSize.width,  Math.min(maxSize.width,  newWidth));
      newHeight = Math.max(minSize.height, Math.min(maxSize.height, newHeight));

      // Re-caler sur le ratio après contraintes
      if (newWidth / aspectRatio > newHeight) newWidth  = newHeight * aspectRatio;
      else                                    newHeight = newWidth  / aspectRatio;

      // Décalage pour ancrer le coin opposé
      let dx = 0, dy = 0;
      switch (corner) {
        case 'top-left':
          dx = startWidth  - newWidth;
          dy = startHeight - newHeight;
          break;
        case 'top-right':
          dy = startHeight - newHeight;
          break;
        case 'bottom-left':
          dx = startWidth - newWidth;
          break;
        case 'bottom-right':
          // ancre = top-left, rien à décaler
          break;
      }

      updateSize(newWidth, newHeight, startOffsetX + dx, startOffsetY + dy);
    };

    const startResize = (clientX, clientY) => {
      isResizing  = true;
      startX      = clientX;
      startY      = clientY;
      startWidth  = wrapper.offsetWidth;
      startHeight = wrapper.offsetHeight;
      // 🔑 On lit la position actuelle depuis le DOM (mise à jour par
      // le drag ou par un resize précédent), pas une variable cache.
      startOffsetX = parseFloat(wrapper.style.left) || 0;
      startOffsetY = parseFloat(wrapper.style.top)  || 0;
    };

    // --- Souris ---
    const onMouseDown = (e) => {
      startResize(e.clientX, e.clientY);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
      e.stopPropagation();
    };
    const onMouseMove = (e) => {
      if (!isResizing) return;
      computeResize(e.clientX - startX, e.clientY - startY);
    };
    const onMouseUp = () => {
      isResizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    // --- Tactile ---
    const onTouchStart = (e) => {
      const t = e.touches[0];
      startResize(t.clientX, t.clientY);
      document.addEventListener('touchmove', onTouchMove);
      document.addEventListener('touchend', onTouchEnd);
      e.preventDefault();
      e.stopPropagation();
    };
    const onTouchMove = (e) => {
      if (!isResizing) return;
      const t = e.touches[0];
      computeResize(t.clientX - startX, t.clientY - startY);
    };
    const onTouchEnd = () => {
      isResizing = false;
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };

    grip.addEventListener('mousedown',  onMouseDown);
    grip.addEventListener('touchstart', onTouchStart);

    el._resizeDirective = {
      wrapper, grip,
      cleanup: () => {
        grip.removeEventListener('mousedown',  onMouseDown);
        grip.removeEventListener('touchstart', onTouchStart);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup',   onMouseUp);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend',  onTouchEnd);
      }
    };
  },

  beforeUnmount(el) {
    if (el._resizeDirective) el._resizeDirective.cleanup();
  }
};