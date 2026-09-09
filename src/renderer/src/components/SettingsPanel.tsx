import { useEffect, useState } from 'react'
import { Check, ChevronDown, Cpu, Download, ExternalLink, FileText, Github, Globe2, Image, Mail, RefreshCw, ScanLine, Search, ShieldCheck, Sparkles, SquareTerminal, X } from 'lucide-react'
import { getTranslator, type Translate } from '../i18n'
import { activeModelProfile } from '@shared/model'
import type {
  AppSettings,
  CodexConnectionStatus,
  GmailConfiguration,
  GmailConnectionStatus,
  GmailThreadSummary,
  GrokConnectionStatus,
  ModelDescriptor,
  SecretSettings,
  UpdateState
} from '@shared/types'

interface SettingsPanelProps {
  open: boolean
  initialTab: string
  settings: AppSettings
  secrets: SecretSettings
  gmailStatus: GmailConnectionStatus
  grokStatus: GrokConnectionStatus
  codexStatus: CodexConnectionStatus
  appInfo: { version: string; platform: string }
  updateState: UpdateState
  onClose: () => void
  onSettingsChange: (settings: AppSettings) => void
  onSecretsChange: (secrets: SecretSettings) => void
  onGmailStatusChange: (status: GmailConnectionStatus) => void
  onGrokStatusChange: (status: GrokConnectionStatus) => void
  onCodexStatusChange: (status: CodexConnectionStatus) => void
}

type SettingsTab = 'model' | 'plugins' | 'capture' | 'updates'

export default function SettingsPanel(props: SettingsPanelProps): React.JSX.Element | null {
  const [tab, setTab] = useState<SettingsTab>('model')
  const [models, setModels] = useState<ModelDescriptor[]>([])
  const [modelStatus, setModelStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [gmailQuery, setGmailQuery] = useState('is:unread')
  const [gmailResults, setGmailResults] = useState<GmailThreadSummary[]>([])
  const [gmailBusy, setGmailBusy] = useState(false)
  const [gmailConfiguration, setGmailConfiguration] = useState<GmailConfiguration>({ hasBuiltInClientId: false })
  const [gmailConnectionMessage, setGmailConnectionMessage] = useState('')
  const [gmailAdvancedOpen, setGmailAdvancedOpen] = useState(false)
  const [grokBusy, setGrokBusy] = useState(false)
  const [grokConnectionMessage, setGrokConnectionMessage] = useState('')
  const [codexBusy, setCodexBusy] = useState(false)
  const [codexConnectionMessage, setCodexConnectionMessage] = useState('')
  const [shortcutStatus, setShortcutStatus] = useState('')
  const [webTestQuery, setWebTestQuery] = useState('LocLM local AI')
  const [webTestState, setWebTestState] = useState<{ status: 'idle' | 'busy' | 'success' | 'error'; message: string }>({ status: 'idle', message: '' })
  const t = getTranslator(props.settings.language)

  useEffect(() => {
    if (props.open && ['model', 'plugins', 'capture', 'updates'].includes(props.initialTab)) {
      setTab(props.initialTab as SettingsTab)
    }
  }, [props.initialTab, props.open])

  useEffect(() => {
    if (!props.open) return
    void window.loclm.gmail.configuration().then(setGmailConfiguration)
    void window.loclm.grok.status().then(props.onGrokStatusChange)
    void window.loclm.codex.status().then(props.onCodexStatusChange)
  }, [props.open])

  useEffect(() => {
    const source = props.settings.modelSource
    const connected = source === 'grok' ? props.grokStatus.connected : source === 'codex' ? props.codexStatus.connected : false
    if (!props.open || tab !== 'model' || source === 'local' || !connected) return
    let cancelled = false
    setBusy(true)
    setModelStatus(t('connecting'))
    void window.loclm.models.test(activeModelProfile(props.settings)).then((result) => {
      if (cancelled) return
      setModels(result.models)
      setModelStatus(t('availableModels', { latency: result.latencyMs, count: result.models.length }))
      const first = result.models[0]
      if (first && source === 'grok' && !props.settings.grok.modelId) {
        props.onSettingsChange({
          ...props.settings,
          grok: {
            ...props.settings.grok,
            modelId: first.id,
            contextLength: first.contextLength || props.settings.grok.contextLength
          }
        })
      } else if (first && source === 'codex' && !props.settings.codex.modelId) {
        props.onSettingsChange({
          ...props.settings,
          codex: {
            ...props.settings.codex,
            modelId: first.id,
            contextLength: first.contextLength || props.settings.codex.contextLength
          }
        })
      }
    }).catch((error) => {
      if (!cancelled) setModelStatus(errorMessage(error))
    }).finally(() => {
      if (!cancelled) setBusy(false)
    })
    return () => { cancelled = true }
  }, [props.open, tab, props.settings.modelSource, props.grokStatus.connected, props.codexStatus.connected])

  if (!props.open) return null

  const updateSettings = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    props.onSettingsChange({ ...props.settings, [key]: value })
  }

  const updateModel = (patch: Partial<AppSettings['model']>): void => updateSettings('model', { ...props.settings.model, ...patch })
  const updateGrok = (patch: Partial<AppSettings['grok']>): void => updateSettings('grok', { ...props.settings.grok, ...patch })
  const updateCodex = (patch: Partial<AppSettings['codex']>): void => updateSettings('codex', { ...props.settings.codex, ...patch })
  const isGrok = props.settings.modelSource === 'grok'
  const isCodex = props.settings.modelSource === 'codex'
  const isLocal = props.settings.modelSource === 'local'
  const updateCapture = (patch: Partial<AppSettings['capture']>): void => updateSettings('capture', { ...props.settings.capture, ...patch })
  const updateUpdates = (patch: Partial<AppSettings['updates']>): void => updateSettings('updates', { ...props.settings.updates, ...patch })
  const updateWeb = (patch: Partial<AppSettings['web']>): void => updateSettings('web', { ...props.settings.web, ...patch })

  const testModel = async (): Promise<void> => {
    setBusy(true)
    setModelStatus(t('connecting'))
    try {
      await window.loclm.secrets.set(props.secrets)
      const profile = activeModelProfile(props.settings)
      const result = await window.loclm.models.test(profile)
      setModels(result.models)
      setModelStatus(t('availableModels', { latency: result.latencyMs, count: result.models.length }))
      const first = result.models[0]
      if (first && isGrok && !props.settings.grok.modelId) {
        updateGrok({ modelId: first.id, contextLength: first.contextLength || props.settings.grok.contextLength })
      } else if (first && isCodex && !props.settings.codex.modelId) {
        updateCodex({ modelId: first.id, contextLength: first.contextLength || props.settings.codex.contextLength })
      } else if (first && isLocal && !props.settings.model.modelId) {
        updateModel({ modelId: first.id })
      }
    } catch (error) {
      setModelStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const togglePlugin = (plugin: keyof AppSettings['plugins']): void => {
    updateSettings('plugins', { ...props.settings.plugins, [plugin]: !props.settings.plugins[plugin] })
  }

  const connectGmail = async (): Promise<void> => {
    if (!gmailConfiguration.hasBuiltInClientId && !props.settings.gmail.clientId.trim()) {
      setGmailAdvancedOpen(true)
      setGmailConnectionMessage(t('gmailClientIdRequired'))
      return
    }
    setGmailBusy(true)
    setGmailConnectionMessage(t('openingGoogleBrowser'))
    try {
      props.onGmailStatusChange(await window.loclm.gmail.connect(props.settings.gmail.clientId))
      setGmailConnectionMessage(t('gmailConnectedSuccess'))
      if (!props.settings.plugins.gmail) togglePlugin('gmail')
    } catch (error) {
      setGmailConnectionMessage(errorMessage(error))
    } finally {
      setGmailBusy(false)
    }
  }

  const connectGrok = async (): Promise<void> => {
    setGrokBusy(true)
    setGrokConnectionMessage(t('openingGrokBrowser'))
    try {
      props.onGrokStatusChange(await window.loclm.grok.connect())
      setGrokConnectionMessage(t('grokConnectedSuccess'))
      await testModel()
    } catch (error) {
      setGrokConnectionMessage(errorMessage(error))
    } finally {
      setGrokBusy(false)
    }
  }

  const disconnectGrok = async (): Promise<void> => {
    await window.loclm.grok.disconnect()
    props.onGrokStatusChange({ connected: false })
    setGrokConnectionMessage('')
    setModels([])
    updateSettings('modelSource', 'local')
  }

  const connectCodex = async (): Promise<void> => {
    setCodexBusy(true)
    setCodexConnectionMessage(t('openingCodexBrowser'))
    try {
      props.onCodexStatusChange(await window.loclm.codex.connect())
      setCodexConnectionMessage(t('codexConnectedSuccess'))
      await testModel()
    } catch (error) {
      setCodexConnectionMessage(errorMessage(error))
    } finally {
      setCodexBusy(false)
    }
  }

  const disconnectCodex = async (): Promise<void> => {
    props.onCodexStatusChange(await window.loclm.codex.disconnect())
    setCodexConnectionMessage('')
    setModels([])
    updateSettings('modelSource', 'local')
  }

  const disconnectGmail = async (): Promise<void> => {
    await window.loclm.gmail.disconnect()
    props.onGmailStatusChange({ connected: false })
    setGmailConnectionMessage('')
  }

  const searchGmail = async (): Promise<void> => {
    setGmailBusy(true)
    try {
      setGmailResults(await window.loclm.gmail.search(gmailQuery))
    } catch (error) {
      setModelStatus(errorMessage(error))
    } finally {
      setGmailBusy(false)
    }
  }

  const applyShortcut = async (): Promise<void> => {
    const registered = await window.loclm.capture.setShortcut(props.settings.capture.shortcut, props.settings.capture.enabled)
    setShortcutStatus(registered ? t('shortcutRegistered') : t('shortcutInUse'))
  }

  const testWebSearch = async (): Promise<void> => {
    if (!webTestQuery.trim()) return
    setWebTestState({ status: 'busy', message: t('testingSearch') })
    try {
      await window.loclm.secrets.set(props.secrets)
      const results = await window.loclm.web.search(webTestQuery, props.settings.web, props.settings.language)
      setWebTestState(results.length
        ? { status: 'success', message: t('webTestReady', { count: results.length }) }
        : { status: 'error', message: t('webTestNoResults') })
    } catch (error) {
      setWebTestState({ status: 'error', message: errorMessage(error) })
    }
  }

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="settings-header">
          <div>
            <h2 id="settings-title">{t('settings')}</h2>
            <p>{t('settingsSubtitle')}</p>
          </div>
          <button className="icon-button" type="button" aria-label={t('close')} onClick={props.onClose}><X size={17} /></button>
        </div>

        <div className="settings-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'model'} onClick={() => setTab('model')}><Cpu size={15} /> {t('localAi')}</button>
          <button type="button" role="tab" aria-selected={tab === 'plugins'} onClick={() => setTab('plugins')}><ShieldCheck size={15} /> {t('plugins')}</button>
          <button type="button" role="tab" aria-selected={tab === 'capture'} onClick={() => setTab('capture')}><ScanLine size={15} /> {t('screenCapture')}</button>
          <button type="button" role="tab" aria-selected={tab === 'updates'} onClick={() => setTab('updates')}><RefreshCw size={15} /> {t('updates')}</button>
        </div>

        <div className="settings-content">
          {tab === 'model' && (
            <div className="settings-section">
              <div className="field-grid two-columns">
                <label className="field"><span>{t('theme')}</span><select value={props.settings.theme} onChange={(event) => updateSettings('theme', event.target.value as AppSettings['theme'])}><option value="system">{t('systemTheme')}</option><option value="dark">{t('darkTheme')}</option><option value="light">{t('lightTheme')}</option></select></label>
                <label className="field"><span>{t('language')}</span><select aria-label={t('language')} value={props.settings.language} onChange={(event) => updateSettings('language', event.target.value as AppSettings['language'])}><option value="en">{t('english')}</option><option value="hu">{t('hungarian')}</option></select></label>
              </div>
              <div className="source-toggle" role="tablist" aria-label={t('provider')}>
                <button type="button" role="tab" aria-selected={isLocal} onClick={() => { updateSettings('modelSource', 'local'); setModelStatus(''); setModels([]) }}><Cpu size={14} /> {t('localProvider')}</button>
                <button type="button" role="tab" aria-selected={isGrok} onClick={() => { updateSettings('modelSource', 'grok'); setModelStatus(''); setModels([]) }}><Sparkles size={14} /> {t('grokProvider')}</button>
                <button type="button" role="tab" aria-selected={isCodex} onClick={() => { updateSettings('modelSource', 'codex'); setModelStatus(''); setModels([]) }}><SquareTerminal size={14} /> {t('codexProvider')}</button>
              </div>

              {isLocal ? (
                <>
                  <label className="field"><span>{t('provider')}</span><input value={props.settings.model.providerName} onChange={(event) => updateModel({ providerName: event.target.value })} /></label>
                  <label className="field"><span>{t('endpoint')}</span><input value={props.settings.model.baseUrl} onChange={(event) => updateModel({ baseUrl: event.target.value })} placeholder="http://127.0.0.1:1234/v1" /></label>
                  <label className="field"><span>{t('apiKey')} <small>{t('optional')}</small></span><input type="password" value={props.secrets.modelApiKey ?? ''} onChange={(event) => props.onSecretsChange({ ...props.secrets, modelApiKey: event.target.value })} onBlur={() => void window.loclm.secrets.set(props.secrets)} /></label>
                  <div className="field-grid two-columns">
                    <label className="field"><span>{t('model')}</span>
                      {models.length ? <select value={props.settings.model.modelId} onChange={(event) => updateModel({ modelId: event.target.value })}><option value="">{t('selectModel')}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name ? `${model.name} (${model.id})` : model.id}</option>)}</select>
                        : <input value={props.settings.model.modelId} onChange={(event) => updateModel({ modelId: event.target.value })} placeholder="Model ID" />}
                    </label>
                    <label className="field"><span>{t('contextLimit')}</span><input type="number" min="1024" step="1024" value={props.settings.model.contextLength} onChange={(event) => updateModel({ contextLength: Number(event.target.value) || 8192 })} /></label>
                  </div>
                  <div className="setting-row">
                    <div><strong>{t('visionModel')}</strong><small>{t('visionModelDescription')}</small></div>
                    <Switch checked={props.settings.model.supportsVision} onChange={(checked) => updateModel({ supportsVision: checked })} label={t('visionModel')} />
                  </div>
                  <div className="settings-action-row">
                    <button className="secondary-button" type="button" onClick={() => void testModel()} disabled={busy}>{busy ? t('testing') : t('testConnection')}</button>
                    {modelStatus && <span className="muted-text">{modelStatus}</span>}
                  </div>
                  <div className="settings-note"><ShieldCheck size={15} /> {t('localDataNote')}</div>
                </>
              ) : isGrok ? (
                <>
                  <div className="integration-box">
                    <div className="integration-title"><Sparkles size={16} /><strong>{t('grokSubscription')}</strong><span className={props.grokStatus.connected ? 'connected-badge' : 'muted-badge'}>{props.grokStatus.connected ? props.grokStatus.email ?? t('connected') : t('notConnected')}</span></div>
                    {!props.grokStatus.connected ? (
                      <>
                        <p className="gmail-connect-description">{t('grokConnectDescription')}</p>
                        <button className="oauth-connect-button" type="button" disabled={grokBusy} onClick={() => void connectGrok()}>
                          <span className="oauth-mark">G</span>
                          <span><strong>{grokBusy ? t('signingInGrok') : t('signInGrok')}</strong><small>{t('opensDefaultBrowser')}</small></span>
                          <ExternalLink size={15} />
                        </button>
                        {grokConnectionMessage ? <div className={grokConnectionMessage === t('grokConnectedSuccess') ? 'success-text' : 'warning-text'} role="status">{grokConnectionMessage}</div> : null}
                        <div className="settings-note"><ShieldCheck size={15} /> {t('grokPrivacyNote')}</div>
                      </>
                    ) : (
                      <>
                        <div className="settings-note"><Check size={15} /> {t('grokSessionNote')}</div>
                        {grokConnectionMessage ? <div className="success-text" role="status">{grokConnectionMessage}</div> : null}
                        <button className="text-button destructive" type="button" onClick={() => void disconnectGrok()}>{t('disconnectGrok')}</button>
                        <small className="muted-text">{t('grokSignOutNote')}</small>
                      </>
                    )}
                  </div>
                  {props.grokStatus.connected ? (
                    <>
                      <div className="field-grid two-columns">
                        <label className="field"><span>{t('model')}</span>
                          {models.length ? <select value={props.settings.grok.modelId} onChange={(event) => {
                            const selected = models.find((model) => model.id === event.target.value)
                            updateGrok({ modelId: event.target.value, contextLength: selected?.contextLength || props.settings.grok.contextLength })
                          }}><option value="">{t('selectGrokModel')}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name ? `${model.name} (${model.id})` : model.id}</option>)}</select>
                            : <input value={props.settings.grok.modelId} onChange={(event) => updateGrok({ modelId: event.target.value })} placeholder="grok-4.6" />}
                        </label>
                        <label className="field"><span>{t('contextLimit')}</span><input type="number" min="1024" step="1024" value={props.settings.grok.contextLength} onChange={(event) => updateGrok({ contextLength: Number(event.target.value) || 500000 })} /></label>
                      </div>
                      <div className="setting-row">
                        <div><strong>{t('visionModel')}</strong><small>{t('visionModelDescription')}</small></div>
                        <Switch checked={props.settings.grok.supportsVision} onChange={(checked) => updateGrok({ supportsVision: checked })} label={t('visionModel')} />
                      </div>
                      <div className="settings-action-row">
                        <button className="secondary-button" type="button" onClick={() => void testModel()} disabled={busy}>{busy ? t('testing') : t('testConnection')}</button>
                        {modelStatus && <span className="muted-text">{modelStatus}</span>}
                      </div>
                      <div className="settings-note"><Sparkles size={15} /> {t('grokDataNote')}</div>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="integration-box">
                    <div className="integration-title">
                      <SquareTerminal size={16} />
                      <strong>{t('codexCli')}</strong>
                      <span className={props.codexStatus.connected ? 'connected-badge' : 'muted-badge'}>
                        {props.codexStatus.connected ? props.codexStatus.authMode ?? t('connected') : props.codexStatus.installed ? t('notConnected') : t('notInstalled')}
                      </span>
                    </div>
                    {!props.codexStatus.installed ? (
                      <>
                        <p className="gmail-connect-description">{t('codexInstallDescription')}</p>
                        <button className="secondary-button" type="button" onClick={() => void window.loclm.web.openExternal('https://developers.openai.com/codex/cli')}>
                          <ExternalLink size={14} /> {t('openCodexInstallGuide')}
                        </button>
                        {props.codexStatus.error ? <div className="warning-text" role="status">{props.codexStatus.error}</div> : null}
                      </>
                    ) : !props.codexStatus.connected ? (
                      <>
                        <p className="gmail-connect-description">{t('codexConnectDescription')}</p>
                        <button className="oauth-connect-button" type="button" disabled={codexBusy} onClick={() => void connectCodex()}>
                          <span className="oauth-mark">O</span>
                          <span><strong>{codexBusy ? t('signingInCodex') : t('signInCodex')}</strong><small>{t('opensDefaultBrowser')}</small></span>
                          <ExternalLink size={15} />
                        </button>
                        {codexConnectionMessage ? <div className={codexConnectionMessage === t('codexConnectedSuccess') ? 'success-text' : 'warning-text'} role="status">{codexConnectionMessage}</div> : null}
                        <div className="settings-note"><ShieldCheck size={15} /> {t('codexPrivacyNote')}</div>
                      </>
                    ) : (
                      <>
                        <div className="settings-note"><Check size={15} /> {t('codexSessionNote', { version: props.codexStatus.version ?? '?' })}</div>
                        {codexConnectionMessage ? <div className="success-text" role="status">{codexConnectionMessage}</div> : null}
                        <button className="text-button destructive" type="button" onClick={() => void disconnectCodex()}>{t('disconnectCodex')}</button>
                        <small className="muted-text">{t('codexSignOutNote')}</small>
                      </>
                    )}
                  </div>
                  {props.codexStatus.connected ? (
                    <>
                      <div className="field-grid two-columns">
                        <label className="field"><span>{t('model')}</span>
                          {models.length ? <select value={props.settings.codex.modelId} onChange={(event) => {
                            const selected = models.find((model) => model.id === event.target.value)
                            updateCodex({ modelId: event.target.value, contextLength: selected?.contextLength || props.settings.codex.contextLength })
                          }}><option value="">{t('selectCodexModel')}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name ? `${model.name} (${model.id})` : model.id}</option>)}</select>
                            : <input value={props.settings.codex.modelId} onChange={(event) => updateCodex({ modelId: event.target.value })} placeholder="gpt-5.6-sol" />}
                        </label>
                        <label className="field"><span>{t('contextLimit')}</span><input type="number" min="1024" step="1024" value={props.settings.codex.contextLength} onChange={(event) => updateCodex({ contextLength: Number(event.target.value) || 272000 })} /></label>
                      </div>
                      <div className="settings-action-row">
                        <button className="secondary-button" type="button" onClick={() => void testModel()} disabled={busy}>{busy ? t('testing') : t('testConnection')}</button>
                        {modelStatus && <span className="muted-text">{modelStatus}</span>}
                      </div>
                      <div className="settings-note"><SquareTerminal size={15} /> {t('codexDataNote')}</div>
                    </>
                  ) : null}
                </>
              )}
            </div>
          )}

          {tab === 'plugins' && (
            <div className="settings-section">
              <PluginRow icon={<Mail size={17} />} title="Gmail" description={t('gmailDescription')} checked={props.settings.plugins.gmail} onChange={() => togglePlugin('gmail')} />
              <PluginRow icon={<Globe2 size={17} />} title={t('webSearch')} description={t('webSearchDescription')} checked={props.settings.plugins.web} onChange={() => togglePlugin('web')} />
              <PluginRow icon={<Image size={17} />} title={t('imageScreenshot')} description={t('imageScreenshotDescription')} checked={props.settings.plugins.vision} onChange={() => togglePlugin('vision')} />
              <PluginRow icon={<FileText size={17} />} title={t('documents')} description={t('documentsDescription')} checked={props.settings.plugins.documents} onChange={() => togglePlugin('documents')} />

              {props.settings.plugins.gmail && (
                <div className="integration-box">
                  <div className="integration-title"><Mail size={16} /><strong>{t('gmailConnection')}</strong><span className={props.gmailStatus.connected ? 'connected-badge' : 'muted-badge'}>{props.gmailStatus.connected ? props.gmailStatus.email ?? t('connected') : t('notConnected')}</span></div>
                  {!props.gmailStatus.connected ? (
                    <>
                      <p className="gmail-connect-description">{t('gmailConnectDescription')}</p>
                      <button className="gmail-connect-button" type="button" disabled={gmailBusy} onClick={() => void connectGmail()}>
                        <span className="google-mark">G</span>
                        <span><strong>{gmailBusy ? t('connectingGmail') : t('connectGmail')}</strong><small>{t('opensDefaultBrowser')}</small></span>
                        <ExternalLink size={15} />
                      </button>
                      {gmailConnectionMessage ? <div className={gmailConnectionMessage === t('gmailConnectedSuccess') ? 'success-text' : 'warning-text'} role="status">{gmailConnectionMessage}</div> : null}
                      <button className="advanced-toggle" type="button" aria-expanded={gmailAdvancedOpen} onClick={() => setGmailAdvancedOpen((open) => !open)}>{t('advancedSetup')}<ChevronDown className={gmailAdvancedOpen ? 'expanded' : ''} size={14} /></button>
                      {gmailAdvancedOpen ? (
                        <div className="advanced-content">
                          <label className="field"><span>{t('googleClientId')}</span><input value={props.settings.gmail.clientId} onChange={(event) => { updateSettings('gmail', { ...props.settings.gmail, clientId: event.target.value }); setGmailConnectionMessage('') }} placeholder="…apps.googleusercontent.com" /></label>
                          <small>{t('gmailClientIdHelp')}</small>
                        </div>
                      ) : null}
                      <div className="settings-note"><ShieldCheck size={15} /> {t('gmailPrivacyNote')}</div>
                    </>
                  ) : (
                    <>
                      <div className="gmail-search-row"><input value={gmailQuery} onChange={(event) => setGmailQuery(event.target.value)} placeholder={t('gmailSearchQuery')} /><button className="secondary-button" type="button" onClick={() => void searchGmail()} disabled={gmailBusy}><Search size={14} /> {t('search')}</button></div>
                      {gmailResults.length > 0 && <div className="gmail-results">{gmailResults.slice(0, 5).map((thread) => <div key={thread.id}><span className={thread.unread ? 'unread-dot' : 'read-dot'} /><div><strong>{thread.subject}</strong><small>{thread.from} · {thread.snippet}</small></div><button type="button" aria-label={t('archive')} onClick={() => void window.loclm.gmail.modifyThread(thread.id, [], ['INBOX'])}>{t('archive')}</button></div>)}</div>}
                      <button className="text-button destructive" type="button" onClick={() => void disconnectGmail()}>{t('disconnectGmail')}</button>
                    </>
                  )}
                </div>
              )}

              {props.settings.plugins.web && (
                <div className="integration-box">
                  <div className="integration-title"><Globe2 size={16} /><strong>{t('webSearchProvider')}</strong></div>
                  <label className="field"><span>{t('provider')}</span><select value={props.settings.web.provider} onChange={(event) => { updateWeb({ provider: event.target.value as AppSettings['web']['provider'] }); setWebTestState({ status: 'idle', message: '' }) }}><option value="browser">{t('builtInBrowser')}</option><option value="brave">Brave Search API</option><option value="searxng">{t('customSearxng')}</option></select></label>
                  {props.settings.web.provider === 'brave' ? <label className="field"><span>{t('braveApiKey')}</span><input type="password" value={props.secrets.braveApiKey ?? ''} onChange={(event) => props.onSecretsChange({ ...props.secrets, braveApiKey: event.target.value })} onBlur={() => void window.loclm.secrets.set(props.secrets)} /></label> : null}
                  {props.settings.web.provider === 'searxng' ? <label className="field"><span>SearXNG URL</span><input value={props.settings.web.searxngUrl} onChange={(event) => updateWeb({ searxngUrl: event.target.value })} /></label> : null}
                  <div className="settings-note"><Globe2 size={15} /> {props.settings.web.provider === 'browser' ? t('browserSearchHint') : props.settings.web.provider === 'brave' ? t('braveSetupHint') : t('searxngSetupHint')}</div>
                  <div className="gmail-search-row"><input aria-label={t('webTestQuery')} value={webTestQuery} onChange={(event) => setWebTestQuery(event.target.value)} placeholder={t('webTestQuery')} /><button className="secondary-button" type="button" disabled={webTestState.status === 'busy' || !webTestQuery.trim()} onClick={() => void testWebSearch()}><Search size={14} /> {webTestState.status === 'busy' ? t('testingSearch') : t('testSearch')}</button></div>
                  {webTestState.message ? <div className={webTestState.status === 'success' ? 'success-text' : webTestState.status === 'error' ? 'warning-text' : 'muted-text'} role="status">{webTestState.message}</div> : null}
                </div>
              )}
            </div>
          )}

          {tab === 'capture' && (
            <div className="settings-section">
              <div className="setting-row"><div><strong>{t('globalCapture')}</strong><small>{t('globalCaptureDescription')}</small></div><Switch checked={props.settings.capture.enabled} onChange={(enabled) => updateCapture({ enabled })} label={t('globalCapture')} /></div>
              <label className="field"><span>{t('shortcut')}</span><div className="inline-field"><input value={props.settings.capture.shortcut} onChange={(event) => updateCapture({ shortcut: event.target.value })} /><button className="secondary-button" type="button" onClick={() => void applyShortcut()}>{t('apply')}</button></div></label>
              {shortcutStatus ? <div className="muted-text">{shortcutStatus}</div> : null}
              <div className="shortcut-preview"><span>Ctrl</span><i>+</i><span>Shift</span><i>+</i><span>S</span><small>{t('default')}</small></div>
              <div className="setting-row"><div><strong>{t('automaticProcessing')}</strong><small>{t('automaticProcessingDescription')}</small></div><Switch checked={props.settings.capture.autoAnalyze} onChange={(autoAnalyze) => updateCapture({ autoAnalyze })} label={t('automaticProcessing')} /></div>
              <div className="setting-row"><div><strong>{t('temporaryImages')}</strong><small>{t('temporaryImagesDescription')}</small></div><Switch checked={props.settings.capture.ephemeral} onChange={(ephemeral) => updateCapture({ ephemeral })} label={t('temporaryImages')} /></div>
              <button className="primary-button capture-test-button" type="button" onClick={() => void window.loclm.capture.open()}><ScanLine size={16} /> {t('tryCapture')}</button>
            </div>
          )}

          {tab === 'updates' && (
            <div className="settings-section">
              <div className="update-card">
                <div className="update-icon"><Github size={20} /></div>
                <div><strong>LocLM {props.appInfo.version}</strong><small>{t('stableChannel', { platform: props.appInfo.platform })}</small></div>
                <button className="secondary-button" type="button" onClick={() => void window.loclm.updater.check()}><RefreshCw size={14} /> {t('check')}</button>
                <div className="update-message">{localizedUpdateMessage(props.updateState, t)}</div>
                {props.updateState.status === 'downloading' && <div className="progress-track"><span style={{ width: `${props.updateState.percent ?? 0}%` }} /></div>}
                {props.updateState.status === 'downloaded' && <button className="primary-button install-button" type="button" onClick={() => window.loclm.updater.install()}><Download size={15} /> {t('restartInstall')}</button>}
              </div>
              <div className="setting-row"><div><strong>{t('automaticCheck')}</strong><small>{t('automaticCheckDescription')}</small></div><Switch checked={props.settings.updates.autoCheck} onChange={(autoCheck) => updateUpdates({ autoCheck })} label={t('automaticCheck')} /></div>
              <div className="setting-row"><div><strong>{t('backgroundDownload')}</strong><small>{t('backgroundDownloadDescription')}</small></div><Switch checked={props.settings.updates.autoDownload} onChange={(autoDownload) => updateUpdates({ autoDownload })} label={t('backgroundDownload')} /></div>
              <div className="setting-row"><div><strong>{t('installOnQuit')}</strong><small>{t('installOnQuitDescription')}</small></div><Switch checked={props.settings.updates.installOnQuit} onChange={(installOnQuit) => updateUpdates({ installOnQuit })} label={t('installOnQuit')} /></div>
              <div className="settings-note"><Check size={15} /> {t('signedReleaseNote')}</div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }): React.JSX.Element {
  return <button className={`switch ${checked ? 'checked' : ''}`} type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>
}

function PluginRow({ icon, title, description, checked, onChange }: { icon: React.ReactNode; title: string; description: string; checked: boolean; onChange: () => void }): React.JSX.Element {
  return <div className="plugin-row"><div className="plugin-icon">{icon}</div><div><strong>{title}</strong><small>{description}</small></div><Switch checked={checked} onChange={onChange} label={`${title} plugin`} /></div>
}

function localizedUpdateMessage(state: UpdateState, t: Translate): string {
  if (state.status === 'checking') return t('updateChecking')
  if (state.status === 'available') return t('updateAvailable', { version: state.version ?? '' })
  if (state.status === 'downloading') return t('updateDownloading')
  if (state.status === 'downloaded') return t('updateDownloaded')
  if (state.status === 'error') return t('updateError')
  return state.version ? t('noUpdateAvailable') : t('updateNotChecked')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
