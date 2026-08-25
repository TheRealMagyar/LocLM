import { useEffect, useState } from 'react'
import { Copy, Maximize2, Minus, X } from 'lucide-react'
import BrandLogo from './BrandLogo'
import { getTranslator } from '../i18n'
import type { AppLanguage } from '@shared/types'

interface TitleBarProps {
  projectName?: string
  language: AppLanguage
}

export default function TitleBar({ projectName, language }: TitleBarProps): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const t = getTranslator(language)

  useEffect(() => {
    void window.loclm.windowControls.isMaximized().then(setMaximized)
    return window.loclm.windowControls.onMaximizedChange(setMaximized)
  }, [])

  const toggleMaximize = (): void => {
    void window.loclm.windowControls.toggleMaximize().then(setMaximized)
  }

  return (
    <header className="app-titlebar" onDoubleClick={toggleMaximize}>
      <div className="titlebar-brand">
        <BrandLogo size="small" />
        <strong>LocLM</strong>
        {projectName ? <><span className="titlebar-divider" /><span className="titlebar-project">{projectName}</span></> : null}
      </div>
      <div className="titlebar-drag-region" />
      <div className="window-controls" onDoubleClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label={t('minimize')} title={t('minimize')} onClick={() => window.loclm.windowControls.minimize()}><Minus size={15} /></button>
        <button type="button" aria-label={maximized ? t('restore') : t('maximize')} title={maximized ? t('restore') : t('maximize')} onClick={toggleMaximize}>
          {maximized ? <Copy size={13} /> : <Maximize2 size={13} />}
        </button>
        <button className="window-close" type="button" aria-label={t('closeApplication')} title={t('close')} onClick={() => window.loclm.windowControls.close()}><X size={16} /></button>
      </div>
    </header>
  )
}
