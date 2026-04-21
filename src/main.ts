import { App } from './ui/App';
import './styles/main.css';

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = (window as any).__BASE__ ?? '/';
    navigator.serviceWorker
      .register(`${base}sw.js`)
      .catch((err) => console.warn('[SW] Registration failed:', err));
  });
}

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');

const app = new App(root);
app.mount();
