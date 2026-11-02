import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startSim } from './mock/store';
import './index.css';

startSim();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
