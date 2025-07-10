// directive-resize.js
export default {
  mounted(el, binding) {
    const options = binding.value || {};
    const wrapperId = options.wrapperId || null;
    const corner = options.corner || 'bottom-right'; // 'top-left', 'top-right', 'bottom-left', 'bottom-right'
    const minSize = options.minSize || { width: 200, height: 112 };
    const maxSize = options.maxSize || { width: 800, height: 450 };
    
    // Créer l'élément de grip pour le redimensionnement
    const grip = document.createElement('div');
    grip.className = 'resize-grip';
    
    // Styles pour le grip selon le coin
    const gripStyles = {
      'top-left': 'top: -5px; left: -5px; cursor: nw-resize;',
      'top-right': 'top: -5px; right: -5px; cursor: ne-resize;',
      'bottom-left': 'bottom: -5px; left: -5px; cursor: sw-resize;',
      'bottom-right': 'bottom: -5px; right: -5px; cursor: se-resize;'
    };
    
    grip.style.cssText = `
      position: absolute;
      width: 10px;
      height: 10px;
      background: #007bff;
      border: 2px solid white;
      border-radius: 50%;
      z-index: 1000;
      ${gripStyles[corner]}
    `;
    
    // Wrapper pour contenir la vidéo et le grip
    const wrapper = document.createElement('div');
    if (wrapperId) {
      wrapper.id = wrapperId;
    }

    const initialWidth = el.offsetWidth >= minSize.width ? el.offsetWidth : minSize.width;
    const initialHeight = el.offsetHeight >= minSize.height ? el.offsetHeight : minSize.height;

    wrapper.style.cssText = `
      position: relative;
      display: inline-block;
      width: ${initialWidth}px;
      height: ${initialHeight}px;
    `;
    
    // Insérer le wrapper avant l'élément et déplacer l'élément dedans
    el.parentNode.insertBefore(wrapper, el);
    wrapper.appendChild(el);
    wrapper.appendChild(grip);
    
    // Styles pour l'élément vidéo
    el.style.cssText += `
      width: 100%;
      height: 100%;
      display: block;
    `;
    
    let isResizing = false;
    let startX, startY, startWidth, startHeight;
    let startLeft, startTop; // Position initiale du wrapper
    let aspectRatio;
    
    // Calculer le ratio d'aspect initial
    const calculateAspectRatio = () => {
      aspectRatio = wrapper.offsetWidth / wrapper.offsetHeight;
    };
    
    calculateAspectRatio();
    
    const onMouseDown = (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = wrapper.offsetWidth;
      startHeight = wrapper.offsetHeight;
      
      // Récupérer la position initiale du wrapper
      const rect = wrapper.getBoundingClientRect();
      const parentRect = wrapper.parentElement.getBoundingClientRect();
      startLeft = rect.left - parentRect.left;
      startTop = rect.top - parentRect.top;
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      
      e.preventDefault();
      e.stopPropagation();
    };
    
    const updateSize = (newWidth, newHeight) => {
      wrapper.style.width = newWidth + 'px';
      wrapper.style.height = newHeight + 'px';
      
      // Émettre l'événement de changement de taille
      const resizeEvent = new CustomEvent('video-resize', {
        detail: {
          width: newWidth,
          height: newHeight,
          aspectRatio: aspectRatio,
        }
      });
      el.dispatchEvent(resizeEvent);
      
      // Appeler le callback si fourni
      if (options.onResize && typeof options.onResize === 'function') {
        options.onResize({
          width: newWidth,
          height: newHeight,
          aspectRatio: aspectRatio,
        });
      }
    };

    const onMouseMove = (e) => {
      if (!isResizing) return;
      
      let deltaX = e.clientX - startX;
      let deltaY = e.clientY - startY;
      
      let newWidth, newHeight, newLeft, newTop;
      
      // Calculer la nouvelle taille et position selon le coin
      switch (corner) {
        case 'top-left':
          // Le coin bottom-right reste fixe
          newWidth = startWidth - deltaX;
          newHeight = startHeight - deltaY;
          newLeft = startLeft + deltaX;
          newTop = startTop + deltaY;
          break;
          
        case 'top-right':
          // Le coin bottom-left reste fixe
          newWidth = startWidth + deltaX;
          newHeight = startHeight - deltaY;
          newLeft = startLeft;
          newTop = startTop + deltaY;
          break;
          
        case 'bottom-left':
          // Le coin top-right reste fixe
          newWidth = startWidth - deltaX;
          newHeight = startHeight + deltaY;
          newLeft = startLeft + deltaX;
          newTop = startTop;
          break;
          
        case 'bottom-right':
          // Le coin top-left reste fixe
          newWidth = startWidth + deltaX;
          newHeight = startHeight + deltaY;
          newLeft = startLeft;
          newTop = startTop;
          break;
      }
      
      // Maintenir les proportions - recalculer en fonction du changement le plus significatif
      const widthRatio = newWidth / startWidth;
      const heightRatio = newHeight / startHeight;
      const ratio = Math.min(widthRatio, heightRatio);
      
      newWidth = startWidth * ratio;
      newHeight = startHeight * ratio;
      
      // Recalculer la position en fonction de la nouvelle taille
      switch (corner) {
        case 'top-left':
          newLeft = startLeft + (startWidth - newWidth);
          newTop = startTop + (startHeight - newHeight);
          break;
          
        case 'top-right':
          newLeft = startLeft;
          newTop = startTop + (startHeight - newHeight);
          break;
          
        case 'bottom-left':
          newLeft = startLeft + (startWidth - newWidth);
          newTop = startTop;
          break;
          
        case 'bottom-right':
          newLeft = startLeft;
          newTop = startTop;
          break;
      }
      
      // Appliquer les contraintes min/max
      newWidth = Math.max(minSize.width, Math.min(maxSize.width, newWidth));
      newHeight = Math.max(minSize.height, Math.min(maxSize.height, newHeight));
      
      // Recalculer pour maintenir les proportions après les contraintes
      if (newWidth / aspectRatio > newHeight) {
        newWidth = newHeight * aspectRatio;
      } else {
        newHeight = newWidth / aspectRatio;
      }
      
      // Recalculer la position finale après application des contraintes
      switch (corner) {
        case 'top-left':
          newLeft = startLeft + (startWidth - newWidth);
          newTop = startTop + (startHeight - newHeight);
          break;
          
        case 'top-right':
          newLeft = startLeft;
          newTop = startTop + (startHeight - newHeight);
          break;
          
        case 'bottom-left':
          newLeft = startLeft + (startWidth - newWidth);
          newTop = startTop;
          break;
          
        case 'bottom-right':
          newLeft = startLeft;
          newTop = startTop;
          break;
      }
      
      updateSize(newWidth, newHeight);
    };
    
    const onMouseUp = () => {
      isResizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    
    grip.addEventListener('mousedown', onMouseDown);
    
    // Support tactile pour mobile
    const onTouchStart = (e) => {
      const touch = e.touches[0];
      isResizing = true;
      startX = touch.clientX;
      startY = touch.clientY;
      startWidth = wrapper.offsetWidth;
      startHeight = wrapper.offsetHeight;
      
      // Récupérer la position initiale du wrapper
      const rect = wrapper.getBoundingClientRect();
      const parentRect = wrapper.parentElement.getBoundingClientRect();
      startLeft = rect.left - parentRect.left;
      startTop = rect.top - parentRect.top;
      
      document.addEventListener('touchmove', onTouchMove);
      document.addEventListener('touchend', onTouchEnd);
      
      e.preventDefault();
      e.stopPropagation();
    };
    
    const onTouchMove = (e) => {
      if (!isResizing) return;
      
      const touch = e.touches[0];
      let deltaX = touch.clientX - startX;
      let deltaY = touch.clientY - startY;
      
      let newWidth, newHeight, newLeft, newTop;
      
      // Même logique que pour la souris
      switch (corner) {
        case 'top-left':
          newWidth = startWidth - deltaX;
          newHeight = startHeight - deltaY;
          newLeft = startLeft + deltaX;
          newTop = startTop + deltaY;
          break;
          
        case 'top-right':
          newWidth = startWidth + deltaX;
          newHeight = startHeight - deltaY;
          newLeft = startLeft;
          newTop = startTop + deltaY;
          break;
          
        case 'bottom-left':
          newWidth = startWidth - deltaX;
          newHeight = startHeight + deltaY;
          newLeft = startLeft + deltaX;
          newTop = startTop;
          break;
          
        case 'bottom-right':
          newWidth = startWidth + deltaX;
          newHeight = startHeight + deltaY;
          newLeft = startLeft;
          newTop = startTop;
          break;
      }
      
      // Maintenir les proportions
      const widthRatio = newWidth / startWidth;
      const heightRatio = newHeight / startHeight;
      const ratio = Math.min(widthRatio, heightRatio);
      
      newWidth = startWidth * ratio;
      newHeight = startHeight * ratio;
      
      // Recalculer la position
      switch (corner) {
        case 'top-left':
          newLeft = startLeft + (startWidth - newWidth);
          newTop = startTop + (startHeight - newHeight);
          break;
          
        case 'top-right':
          newLeft = startLeft;
          newTop = startTop + (startHeight - newHeight);
          break;
          
        case 'bottom-left':
          newLeft = startLeft + (startWidth - newWidth);
          newTop = startTop;
          break;
          
        case 'bottom-right':
          newLeft = startLeft;
          newTop = startTop;
          break;
      }
      
      newWidth = Math.max(minSize.width, Math.min(maxSize.width, newWidth));
      newHeight = Math.max(minSize.height, Math.min(maxSize.height, newHeight));
      
      if (newWidth / aspectRatio > newHeight) {
        newWidth = newHeight * aspectRatio;
      } else {
        newHeight = newWidth / aspectRatio;
      }
      
      // Recalculer la position finale
      switch (corner) {
        case 'top-left':
          newLeft = startLeft + (startWidth - newWidth);
          newTop = startTop + (startHeight - newHeight);
          break;
          
        case 'top-right':
          newLeft = startLeft;
          newTop = startTop + (startHeight - newHeight);
          break;
          
        case 'bottom-left':
          newLeft = startLeft + (startWidth - newWidth);
          newTop = startTop;
          break;
          
        case 'bottom-right':
          newLeft = startLeft;
          newTop = startTop;
          break;
      }
      
      updateSize(newWidth, newHeight);
    };
    
    const onTouchEnd = () => {
      isResizing = false;
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
    
    grip.addEventListener('touchstart', onTouchStart);
    
    // Stocker les références pour le nettoyage
    el._resizeDirective = {
      wrapper,
      grip,
      cleanup: () => {
        grip.removeEventListener('mousedown', onMouseDown);
        grip.removeEventListener('touchstart', onTouchStart);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
      }
    };
  },
  
  beforeUnmount(el) {
    if (el._resizeDirective) {
      el._resizeDirective.cleanup();
    }
  }
};