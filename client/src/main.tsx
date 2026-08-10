import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initSentry } from "./lib/sentry";

initSentry();

if ('serviceWorker' in navigator) {
  // När en ny service worker tar över (skipWaiting + clients.claim i sw.js)
  // laddas sidan om EN gång så att användaren inte blir sittande med gammalt
  // JS-bundle + gamla cachade API-svar tills de manuellt laddar om.
  // Guarden förhindrar omladdningsloop om controllern byts flera gånger.
  let swReloaded = false;
  // Hade sidan en controller när den laddades? Om inte är controllerchange
  // bara första installationens clients.claim — inget gammalt bundle att byta.
  const hadControllerAtLoad = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtLoad) return;
    if (swReloaded) return;
    swReloaded = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);
        
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('New content available, updating…');
              }
            });
          }
        });
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
