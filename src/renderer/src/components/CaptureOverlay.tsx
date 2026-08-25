import { useEffect, useRef, useState } from 'react'
import { Check, ScanLine, X } from 'lucide-react'
import { getTranslator } from '../i18n'
import type { AppLanguage, CaptureSource } from '@shared/types'

interface Point { x: number; y: number }
interface Selection { x: number; y: number; width: number; height: number }

export default function CaptureOverlay(): React.JSX.Element {
  const [source, setSource] = useState<CaptureSource>()
  const [language, setLanguage] = useState<AppLanguage>('en')
  const [start, setStart] = useState<Point>()
  const [selection, setSelection] = useState<Selection>()
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void Promise.all([window.loclm.capture.getSource(), window.loclm.state.load()]).then(([captureSource, state]) => {
      setSource(captureSource)
      setLanguage(state.settings.language)
      document.documentElement.lang = state.settings.language
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.loclm.capture.cancel()
      if (event.key === 'Enter' && selection) submit(selection)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selection])

  const t = getTranslator(language)

  const pointFromEvent = (event: React.PointerEvent): Point => {
    const bounds = stageRef.current?.getBoundingClientRect()
    return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('button')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointFromEvent(event)
    setStart(point)
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 })
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!start) return
    const point = pointFromEvent(event)
    setSelection({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y)
    })
  }

  const onPointerUp = (): void => setStart(undefined)

  const submit = (value: Selection): void => {
    if (!source || value.width < 8 || value.height < 8 || !stageRef.current) return
    const bounds = stageRef.current.getBoundingClientRect()
    window.loclm.capture.complete({
      sourceDataUrl: source.dataUrl,
      sourceWidth: source.width,
      sourceHeight: source.height,
      displayWidth: bounds.width,
      displayHeight: bounds.height,
      ...value
    })
  }

  return (
    <div
      ref={stageRef}
      className="capture-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {source && <img className="capture-background" src={source.dataUrl} alt={t('capturedScreen')} draggable={false} />}
      <div className="capture-shade" />
      <div className="capture-hint"><ScanLine size={16} /> {t('captureHint')} <span>{t('escapeCancel')}</span></div>
      {selection && selection.width > 0 && (
        <div className="capture-selection" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }}>
          <div className="capture-selection-image" style={{
            backgroundImage: `url(${source?.dataUrl})`,
            backgroundSize: `${stageRef.current?.clientWidth ?? 0}px ${stageRef.current?.clientHeight ?? 0}px`,
            backgroundPosition: `${-selection.x}px ${-selection.y}px`
          }} />
          <span className="capture-dimensions">{Math.round(selection.width)} × {Math.round(selection.height)} px</span>
          {!start && selection.width >= 8 && selection.height >= 8 && (
            <div className="capture-actions">
              <button type="button" className="icon-button" aria-label={t('cancel')} onClick={() => window.loclm.capture.cancel()}><X size={16} /></button>
              <button type="button" className="primary-button" onClick={() => submit(selection)}><Check size={16} /> {t('sendCapture')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
