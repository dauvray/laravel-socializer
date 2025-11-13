import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { Excalidraw, loadFromBlob } from "@excalidraw/excalidraw";
const cssPath = "/css/Excalidraw.css";

class ExcalidrawElement extends HTMLElement {
    constructor() {
      super();
      this.container = document.createElement("div");
      this.container.style.width = "100%";
      this.container.style.height = "100%";
      this.attachShadow({ mode: "open" }).appendChild(this.container);
      this.excalidrawAPI = null; // Stocker une référence API Excalidraw
      this.lastPointer = { x: 0, y: 0 };
      this.lastSentTime = 0;
      this.sendRateLimit = 150; // ✅ Envoi max toutes les 50ms (~20FPS)
    }

    connectedCallback() {
      this.injectCSS();
      this.mountReactComponent();
    }

    injectCSS() {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssPath;
      this.shadowRoot.appendChild(link);
    }

    mountReactComponent() {
      const root = ReactDOM.createRoot(this.container);

      root.render(
        React.createElement(Excalidraw, {
          // onChange: (elements, state) => {
          //   this.dispatchEvent(
          //     new CustomEvent("excalidraw-change", {
          //       detail: { elements, state },
          //       bubbles: true,
          //       composed: true,
          //     })
          //   );
          // },
          // Capture l'API Excalidraw
          excalidrawAPI: (api) => {
            if (!this.excalidrawAPI) {
              this.excalidrawAPI = api;
              this.attachMouseUpListener();
              this.attachPointerTracking();
            }
          },
          theme: document.querySelector("html").dataset.bsTheme || "light",
          gridModeEnabled: true,
        })
      );
    }

    // Capture `mouseUp` pour envoyer les données
    attachMouseUpListener() {
      if (this.excalidrawAPI) {
        this.container.addEventListener("pointerup", () => {
          const elements = this.excalidrawAPI.getSceneElements();
          const appState = this.excalidrawAPI.getAppState();
          const files = this.excalidrawAPI.getFiles();
          this.dispatchEvent(
            new CustomEvent("excalidraw-mouseup", {
              detail: { elements, appState, files },
              bubbles: true,
              composed: true,
            })
          );
        });
      }
    }

    // Envoie les positions du curseur
    attachPointerTracking() {
      this.container.addEventListener("pointermove", (event) => {
        const now = Date.now();
        // ✅ Calculer les coordonnées relatives à Excalidraw
        const rect = this.container.getBoundingClientRect();
        const relativeX = event.clientX - rect.left;
        const relativeY = event.clientY - rect.top;

        const deltaX = Math.abs(relativeX - this.lastPointer.x);
        const deltaY = Math.abs(relativeY - this.lastPointer.y);
  
        // Évite d'envoyer les mêmes positions et réduit la fréquence
        if (now - this.lastSentTime > this.sendRateLimit && (deltaX > 5 || deltaY > 5)) {
          this.lastPointer = { x: relativeX, y: relativeY };
          this.lastSentTime = now;

          const pointerData = {
            type: "pointerMove",
            x: this.lastPointer.x,
            y: this.lastPointer.y,
          };
  
          this.dispatchEvent(
            new CustomEvent("excalidraw-pointer", {
              detail: pointerData,
              bubbles: true,
              composed: true,
            })
          );
        }
      });
    }

    /*------------------------------------------------------
    | excalidrawAPI : Méthodes accessibles depuis le parent |
    --------------------------------------------------------*/

    updateScene(data) {
      if (this.excalidrawAPI) {
        this.excalidrawAPI.updateScene({ elements: data.elements, appState: data.state, files: data.files });
      } else {
        console.error("Excalidraw API non encore disponible.");
      }
    }

    addFiles(files) {
      if (this.excalidrawAPI) {
        this.excalidrawAPI.addFiles(files);
      } else {
        console.error("Excalidraw API non encore disponible.");
      }
    }

    getFiles() {
      if (this.excalidrawAPI) {
        return this.excalidrawAPI.getFiles();
      } else {
        console.error("Excalidraw API non encore disponible.");
        return {};
      }
    }

    // todo Méthode pour importer des libraries
    async importLibrary(fileContent) {
        const parsedContent = JSON.parse(fileContent);
        this.excalidrawAPI.updateLibrary({
          libraryItems: parsedContent.libraryItems,
          merge: true,
          openLibraryMenu: true,
        });
      
    }
}

customElements.define("excalidraw-element", ExcalidrawElement);