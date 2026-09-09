import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Cpu, Settings2, Sparkles, SquareTerminal } from 'lucide-react'
import { getTranslator } from '../i18n'
import type { AppLanguage } from '@shared/types'

export interface ChatModelOption {
  key: string
  label: string
  group: 'local' | 'grok' | 'codex'
}

interface ModelPickerProps {
  language: AppLanguage
  options: ChatModelOption[]
  selectedKey: string
  selectedLabel: string
  generating: boolean
  onChange: (key: string) => void
}

export default function ModelPicker(props: ModelPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const t = getTranslator(props.language)
  const selected = props.options.find((option) => option.key === props.selectedKey)
  const selectedGroup = selected?.group ?? (props.selectedKey.startsWith('grok:') ? 'grok' : props.selectedKey.startsWith('codex:') ? 'codex' : 'local')
  const localOptions = props.options.filter((option) => option.group === 'local')
  const grokOptions = props.options.filter((option) => option.group === 'grok')
  const codexOptions = props.options.filter((option) => option.group === 'codex')
  const label = selected?.label || props.selectedLabel || t('noModel')

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const choose = (key: string): void => {
    setOpen(false)
    props.onChange(key)
  }

  return (
    <div className={`model-picker ${open ? 'open' : ''} ${props.generating ? 'running' : ''}`} ref={wrapRef}>
      <button
        className="model-picker-trigger"
        type="button"
        aria-label={t('selectChatModel')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="chat-model-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`model-picker-mark ${selectedGroup}`}>{modelIcon(selectedGroup, 13)}</span>
        <span className="model-picker-copy">
          <strong>{label}</strong>
          {props.generating ? <small><span className="status-dot busy" /> {t('inProgress')}</small> : null}
        </span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="model-picker-menu" id="chat-model-menu" role="listbox" aria-label={t('selectChatModel')}>
          {localOptions.length > 0 ? (
            <div className="model-picker-group">
              <div className="model-picker-label"><Cpu size={12} /> {t('localModelsGroup')}</div>
              {localOptions.map((option) => (
                <ModelOptionButton key={option.key} option={option} selected={option.key === props.selectedKey} onChoose={choose} />
              ))}
            </div>
          ) : null}
          {grokOptions.length > 0 ? (
            <div className="model-picker-group">
              <div className="model-picker-label"><Sparkles size={12} /> {t('grokModelsGroup')}</div>
              {grokOptions.map((option) => (
                <ModelOptionButton key={option.key} option={option} selected={option.key === props.selectedKey} onChoose={choose} />
              ))}
            </div>
          ) : null}
          {codexOptions.length > 0 ? (
            <div className="model-picker-group">
              <div className="model-picker-label"><SquareTerminal size={12} /> {t('codexModelsGroup')}</div>
              {codexOptions.map((option) => (
                <ModelOptionButton key={option.key} option={option} selected={option.key === props.selectedKey} onChoose={choose} />
              ))}
            </div>
          ) : null}
          {!props.options.length ? (
            <div className="model-picker-empty">{t('noModel')}</div>
          ) : null}
          <button className="model-picker-manage" type="button" onClick={() => choose('__settings')}>
            <Settings2 size={14} /> {t('manageModels')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ModelOptionButton({ option, selected, onChoose }: { option: ChatModelOption; selected: boolean; onChoose: (key: string) => void }): React.JSX.Element {
  return (
    <button
      className={`model-picker-option ${selected ? 'active' : ''}`}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onChoose(option.key)}
    >
      <span className={`model-picker-mark ${option.group}`}>{modelIcon(option.group, 12)}</span>
      <span>{option.label}</span>
      {selected ? <Check size={14} /> : null}
    </button>
  )
}

function modelIcon(group: ChatModelOption['group'], size: number): React.JSX.Element {
  if (group === 'grok') return <Sparkles size={size} />
  if (group === 'codex') return <SquareTerminal size={size} />
  return <Cpu size={size} />
}
