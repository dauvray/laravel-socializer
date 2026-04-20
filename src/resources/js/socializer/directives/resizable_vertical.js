/*
    binding.value = {
        min: 200,
        max: 600,
    callback: updateSidebarWidth,
    handle: 'right',      // 'left' | 'right' (default: 'right')
    handleWidth: 3,       // visual line width in px
    handleHitArea: 10     // draggable zone width in px
    }        
*/

export default {
    mounted(el, binding) {
      const handleSide = binding?.value?.handle === "left" ? "left" : "right";
      const visualWidth = Math.max(1, Number(binding?.value?.handleWidth) || 3);
      const hitArea = Math.max(visualWidth, Number(binding?.value?.handleHitArea) || 10);

      const resizer = document.createElement("div");
      const handleLine = document.createElement("div");

      resizer.style.width = `${hitArea}px`;
      resizer.style.cursor = "ew-resize";
      resizer.style.position = "absolute";
      resizer.style.top = "0";
      resizer.style[handleSide] = "0";
      resizer.style.bottom = "0";
      resizer.style.background = "transparent";

      // Visual line stays thin while keeping a wider invisible draggable area.
      handleLine.style.position = "absolute";
      handleLine.style.top = "0";
      handleLine.style.bottom = "0";
      handleLine.style.width = `${visualWidth}px`;
      handleLine.style.left = "50%";
      handleLine.style.transform = "translateX(-50%)";
      handleLine.style.background = "rgba(0,0,0,0.1)";
      handleLine.style.pointerEvents = "none";

      el.style.position = "relative";
      resizer.appendChild(handleLine);
      el.appendChild(resizer);

      let isResizing = false;

      resizer.addEventListener("mouseover", setHoverColor);
      resizer.addEventListener("mouseout", unsetHoverColor);
      resizer.addEventListener("mousedown", handleMouseDown);

      // Stockage des références pour suppression ultérieure
      el.__resizerCleanup__ = () => {
        resizer.removeEventListener("mouseover", setHoverColor);
        resizer.removeEventListener("mouseout", unsetHoverColor);
        resizer.removeEventListener("mousedown", handleMouseDown);
      };
  
      function handleMouseMove(event) {
        if (!isResizing) return;

        if (binding?.value) {

            let newWidth;
            const rect = el.getBoundingClientRect();

            if (handleSide === "left") {
              newWidth = rect.right - event.clientX;
            } else {
              newWidth = event.clientX - rect.left;
            }
      
            // Appliquer des limites min/max
            if(newWidth > binding.value.min && newWidth < binding.value.max) {
    
                el.style.width = `${newWidth}px`;
    
                // Déclenche la mise à jour du contenu adjacent
                if (typeof binding.value?.callback === "function") {
                    binding.value.callback(newWidth);
                }
            }
        }
      }
  
      function handleMouseUp() {
        isResizing = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      }

      function handleMouseDown(event) {
        isResizing = true;
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        event.preventDefault();
      }

      function setHoverColor() {
        handleLine.style.background = "rgba(255,243,205,0.7)";
      }

      function unsetHoverColor() {
        handleLine.style.background = "rgba(0,0,0,0.1)";
      }
    },
    unmounted(el) {
      if (el.__resizerCleanup__) {
        el.__resizerCleanup__();
        delete el.__resizerCleanup__;
      }
    }

  };