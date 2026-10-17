import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('No se encontró el elemento #root para montar la aplicación.')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
