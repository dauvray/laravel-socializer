/*
    binding.value = {
        min: 200,
        max: 600,
        callback: updateSidebarWidth
    }        
*/

export default {
    mounted(el, binding) {
        const resizer = document.createElement("div");
        resizer.style.width = "3px";
        resizer.style.cursor = "ew-resize";
        resizer.style.position = "absolute";
        resizer.style.top = "0";
        resizer.style.right = "0";
        resizer.style.bottom = "0";
        resizer.style.background = "rgba(0,0,0,0.1)";

        el.style.position = "relative";
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

            let newWidth = event.clientX - el.getBoundingClientRect().left;
      
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
        resizer.style.background = "rgba(255,243,205,0.5)";
      }

      function unsetHoverColor() {
        resizer.style.background = "rgba(0,0,0,0.1)";
      }
    },
    unmounted(el) {
      if (el.__resizerCleanup__) {
        el.__resizerCleanup__();
        delete el.__resizerCleanup__;
      }
    }

  };