import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import CaptureOverlay from './components/CaptureOverlay'
import './styles.css'

const isCaptureRoute = window.location.hash === '#/capture'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isCaptureRoute ? <CaptureOverlay /> : <App />}
  </StrictMode>
)
