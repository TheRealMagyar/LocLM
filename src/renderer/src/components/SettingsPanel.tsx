import { useEffect, useState } from 'react'
import { Check, Cpu, Download, FileText, Github, Globe2, Image, Mail, RefreshCw, ScanLine, Search, ShieldCheck, X } from 'lucide-react'
import { getTranslator } from '../i18n'
import type {
  AppSettings,
  GmailConnectionStatus,
  GmailThreadSummary,
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
  appInfo: { version: string; platform: string }
  updateState: UpdateState
  onClose: () => void
  onSettingsChange: (settings: AppSettings) => void
  onSecretsChange: (secrets: SecretSettings) => void
  onGmailStatusChange: (status: GmailConnectionStatus) => void
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
  const [shortcutStatus, setShortcutStatus] = useState('')
  const t = getTranslator(props.settings.language)

  useEffect(() => {
    if (props.open && ['model', 'plugins', 'capture', 'updates'].includes(props.initialTab)) {
      setTab(props.initialTab as SettingsTab)
    }
  }, [props.initialTab, props.open])

  if (!props.open) return null

  const updateSettings = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    props.onSettingsChange({ ...props.settings, [key]: value })
  }

  const updateModel = (patch: Partial<AppSettings['model']>): void => updateSettings('model', { ...props.settings.model, ...patch })
  const updateCapture = (patch: Partial<AppSettings['capture']>): void => updateSettings('capture', { ...props.settings.capture, ...patch })
  const updateUpdates = (patch: Partial<AppSettings['updates']>): void => updateSettings('updates', { ...props.settings.updates, ...patch })
  const updateWeb = (patch: Partial<AppSettings['web']>): void => updateSettings('web', { ...props.settings.web, ...patch })

  const testModel = async (): Promise<void> => {
    setBusy(true)
    setModelStatus(t('connecting'))
    try {
      await window.loclm.secrets.set(props.secrets)
      const result = await window.loclm.models.test(props.settings.model)
      setModels(result.models)
      setModelStatus(t('availableModels', { latency: result.latencyMs, count: result.models.length }))
      if (!props.settings.model.modelId && result.models[0]) updateModel({ modelId: result.models[0].id })
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
    setGmailBusy(true)
    try {
      props.onGmailStatusChange(await window.loclm.gmail.connect(props.settings.gmail.clientId))
      if (!props.settings.plugins.gmail) togglePlugin('gmail')
    } catch (error) {
      setModelStatus(errorMessage(error))
    } finally {
      setGmailBusy(false)
    }
  }

  const disconnectGmail = async (): Promise<void> => {
    await window.loclm.gmail.disconnect()
    props.onGmailStatusChange({ connected: false })
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
                <label className="field"><span>{t('provider')}</span><input value={props.settings.model.providerName} onChange={(event) => updateModel({ providerName: event.target.value })} /></label>
                <label className="field"><span>{t('theme')}</span><select value={props.settings.theme} onChange={(event) => updateSettings('theme', event.target.value as AppSettings['theme'])}><option value="system">{t('systemTheme')}</option><option value="dark">{t('darkTheme')}</option><option value="light">{t('lightTheme')}</option></select></label>
              </div>
              <label className="field"><span>{t('language')}</span><select value={props.settings.language} onChange={(event) => updateSettings('language', event.target.value as AppSettings['language'])}><option value="en">English</option><option value="hu">Magyar</option></select></label>
              <label className="field"><span>{t('endpoint')}</span><input value={props.settings.model.baseUrl} onChange={(event) => updateModel({ baseUrl: event.target.value })} placeholder="http://127.0.0.1:1234/v1" /></label>
              <label className="field"><span>{t('apiKey')} <small>{t('optional')}</small></span><input type="password" value={props.secrets.modelApiKey ?? ''} onChange={(event) => props.onSecretsChange({ ...props.secrets, modelApiKey: event.target.value })} onBlur={() => void window.loclm.secrets.set(props.secrets)} /></label>
              <div className="field-grid two-columns">
                <label className="field"><span>{t('model')}</span>
                  {models.length ? <select value={props.settings.model.modelId} onChange={(event) => updateModel({ modelId: event.target.value })}><option value="">{t('selectModel')}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}</select>
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
                      <label className="field"><span>{t('googleClientId')}</span><input value={props.settings.gmail.clientId} onChange={(event) => updateSettings('gmail', { ...props.settings.gmail, clientId: event.target.value })} placeholder="…apps.googleusercontent.com" /></label>
                      <button className="primary-button" type="button" disabled={gmailBusy || !props.settings.gmail.clientId} onClick={() => void connectGmail()}>{gmailBusy ? t('connectingGmail') : t('connectGmail')}</button>
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
                  <label className="field"><span>{t('provider')}</span><select value={props.settings.web.provider} onChange={(event) => updateWeb({ provider: event.target.value as AppSettings['web']['provider'] })}><option value="brave">Brave Search</option><option value="searxng">{t('customSearxng')}</option></select></label>
                  {props.settings.web.provider === 'brave'
                    ? <label className="field"><span>{t('braveApiKey')}</span><input type="password" value={props.secrets.braveApiKey ?? ''} onChange={(event) => props.onSecretsChange({ ...props.secrets, braveApiKey: event.target.value })} onBlur={() => void window.loclm.secrets.set(props.secrets)} /></label>
                    : <label className="field"><span>SearXNG URL</span><input value={props.settings.web.searxngUrl} onChange={(event) => updateWeb({ searxngUrl: event.target.value })} /></label>}
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
