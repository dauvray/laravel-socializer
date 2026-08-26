/**
 * Redimensionne la HAUTEUR de l'élément — poignée horizontale (`ns-resize`),
 * posée en haut ou en bas selon `options.position`.
 *
 * Écrit une variable CSS (`options.cssVarName`), jamais `style.height` : c'est
 * la feuille de style qui décide quoi en faire.
 *
 * binding.value = {
 *   min: 100,                        // px
 *   max: 600,                        // px
 *   position: 'top' | 'bottom',      // côté de la poignée (défaut: 'bottom')
 *   cssVarName: '--messenger-height',// défaut: '--resizable-height'
 *   callback: (newHeight) => {},
 * }
 *
 * `useResizableElement()` produit cet objet prêt à brancher.
 */
export default {
  mounted(el, binding) {
    const options = binding.value || {};
    const position = options.position || "bottom"; // 'top' ou 'bottom'
    const minHeight = options.min ?? 100;
    const maxHeight = options.max ?? 600;
    const cssVarName = options.cssVarName || "--resizable-height";
    const callback = typeof options.callback === "function" ? options.callback : null;

    const resizer = document.createElement("div");
    resizer.style.height = "6px";
    resizer.style.position = "absolute";
    resizer.style.left = "0";
    resizer.style.right = "0";
    resizer.style.cursor = "ns-resize";
    resizer.style.background = "rgba(0,0,0,0.1)";
    resizer.style.zIndex = "10";
    resizer.style[position] = "0";

    el.appendChild(resizer);

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    function handleMouseDown(e) {
      isResizing = true;
      startY = e.clientY;
      startHeight = el.offsetHeight;

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      e.preventDefault();
    }

    function handleMouseMove(e) {
      if (!isResizing) return;

      const deltaY = e.clientY - startY;
      let newHeight = position === "bottom"
        ? startHeight + deltaY
        : startHeight - deltaY;

      newHeight = Math.min(Math.max(newHeight, minHeight), maxHeight);

      // Appliquer dynamiquement via variable CSS
      el.style.setProperty(cssVarName, `${newHeight}px`);

      if (callback) callback(newHeight);
    }

    function handleMouseUp() {
      isResizing = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    }

    resizer.addEventListener("mousedown", handleMouseDown);
    resizer.addEventListener("mouseover", () => {
      resizer.style.background = "rgba(255,243,205,0.5)";
    });
    resizer.addEventListener("mouseout", () => {
      resizer.style.background = "rgba(0,0,0,0.1)";
    });

    el.__resizerCleanup__ = () => {
      resizer.removeEventListener("mousedown", handleMouseDown);
      resizer.removeEventListener("mouseover", () => {});
      resizer.removeEventListener("mouseout", () => {});
      el.removeChild(resizer);
    };
  },

  unmounted(el) {
    if (el.__resizerCleanup__) {
      el.__resizerCleanup__();
      delete el.__resizerCleanup__;
    }
  },
};
