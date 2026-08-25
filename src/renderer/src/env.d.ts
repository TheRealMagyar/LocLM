import type { LoclmApi } from '../../shared/api'

declare global {
  interface Window {
    loclm: LoclmApi
  }
}

export {}
