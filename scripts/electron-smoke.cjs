const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')
const { _electron: electron } = require('playwright-core')

delete process.env.ELECTRON_RUN_AS_NODE

async function main() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loclm-smoke-'))
  const screenshotDir = process.env.LOCLM_SMOKE_SCREENSHOT_DIR
  if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true })
  const requests = []
  const chatBodies = []
  const server = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    if (request.url === '/v1/models') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'loclm-test-model' }] }))
      return
    }
    if (request.url?.startsWith('/tools/searxng/search?')) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ results: [{ title: '<b>LocLM web result</b>', url: 'https://example.com/fresh', content: 'Current fact from the web &amp; verified.' }] }))
      return
    }
    if (request.url?.startsWith('/browser-search?')) {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end('<!doctype html><html><body><div class="result"><h2><a class="result__a" href="https://example.com/browser-fresh"><b>LocLM browser result</b></a></h2><div class="result__snippet">Current fact from the background browser &amp; verified.</div></div></body></html>')
      return
    }
    if (request.url === '/v1/chat/completions') {
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        const parsedBody = JSON.parse(body)
        chatBodies.push(parsedBody)
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        const userContent = parsedBody.messages?.filter((message) => message.role === 'user').at(-1)?.content ?? ''
        if (userContent.includes('Create exactly')) {
          const learningItems = JSON.stringify({
            items: [
              { prompt: 'Which planet is known as the Red Planet?', options: ['Mars', 'Venus', 'Jupiter', 'Mercury'], correctIndex: 0 },
              { prompt: 'What is the capital of France?', options: ['Berlin', 'Paris', 'Rome', 'Madrid'], correctIndex: 1 }
            ]
          })
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: learningItems } }] })}\n\n`)
          response.end('data: [DONE]\n\n')
          return
        }
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'A strukturált modell-indoklás. ' } }] })}\n\n`)
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '<thi' } }] })}\n\n`)
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'nk>Címkés gondolat.</think>Teszt ' } }] })}\n\n`)
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'válasz rendben.' } }] })}\n\n`)
        response.end('data: [DONE]\n\n')
      })
      return
    }
    response.writeHead(404)
    response.end()
  })

  await new Promise((resolve) => server.listen(12345, '127.0.0.1', resolve))
  let electronApp
  try {
    const errors = []
    const packagedExecutable = process.env.LOCLM_EXECUTABLE_PATH
    electronApp = await electron.launch({
      executablePath: packagedExecutable || path.join(process.cwd(), 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
      args: packagedExecutable ? [] : ['.'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        LOCLM_USER_DATA_DIR: userDataDir,
        GROK_HOME: path.join(userDataDir, 'grok-home'),
        LOCLM_BROWSER_SEARCH_URL_TEMPLATE: 'http://127.0.0.1:12345/browser-search?q={query}&language={language}'
      }
    })
    electronApp.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    const window = await electronApp.firstWindow()
    window.on('pageerror', (error) => errors.push(error.stack ?? error.message))
    await window.waitForSelector('.app-shell')
    await window.waitForSelector('.app-titlebar')
    await window.waitForSelector('.brand-logo')
    await window.waitForFunction(() => document.documentElement.lang === 'en' && document.querySelector('.empty-chat h1')?.textContent === 'How can I help?')

    await window.click('[aria-label="Settings"]')
    const languageSelect = window.locator('select[aria-label="Language"]')
    if (await languageSelect.inputValue() !== 'en') throw new Error('English is not the default language.')
    await languageSelect.selectOption('hu')
    await window.waitForFunction(() => document.documentElement.lang === 'hu' && document.querySelector('#settings-title')?.textContent === 'Beállítások')
    await window.waitForFunction(async () => (await window.loclm.state.load()).settings.language === 'hu')
    if (screenshotDir) await window.screenshot({ path: path.join(screenshotDir, 'settings-hu.png') })
    await window.locator('select[aria-label="Nyelv"]').selectOption('en')
    await window.waitForFunction(() => document.documentElement.lang === 'en' && document.querySelector('#settings-title')?.textContent === 'Settings')
    await window.waitForFunction(async () => (await window.loclm.state.load()).settings.language === 'en')
    if (screenshotDir) await window.screenshot({ path: path.join(screenshotDir, 'settings-en.png') })
    await window.locator('.settings-header .icon-button').click()

    await window.click('[aria-label="New project"]')
    await window.locator('.modal-panel input').fill('Smoke projekt')
    await window.locator('.modal-actions .primary-button').click()
    await window.waitForFunction(() => document.querySelector('.project-switcher')?.textContent?.includes('Smoke projekt'))

    await window.locator('.project-switcher').click()
    await window.waitForSelector('#project-menu')
    await window.locator('.chat-main').click({ position: { x: 24, y: 120 } })
    await window.waitForFunction(() => !document.querySelector('#project-menu'))

    await window.locator('.project-switcher').click()
    await window.locator('[aria-label="Rename: Smoke projekt"]').click()
    await window.locator('.modal-panel input').fill('Átnevezett projekt')
    await window.locator('.modal-actions .primary-button').click()
    await window.waitForFunction(() => document.querySelector('.project-switcher')?.textContent?.includes('Átnevezett projekt'))

    await window.locator('[aria-label="Project files"]').click()
    await window.waitForSelector('.files-main .files-empty')
    if (screenshotDir) await window.screenshot({ path: path.join(screenshotDir, 'project-files.png') })
    await window.click('[aria-label="Learning"]')
    await window.waitForSelector('.learn-main')
    await window.waitForFunction(() => document.querySelector('.learn-main h1')?.textContent === 'No learning games yet')
    await window.locator('.learn-main .primary-button, .learn-main .secondary-button').filter({ hasText: 'New game' }).first().click()
    await window.waitForFunction(() => document.querySelector('.learn-type-grid'))
    if (await window.locator('.learn-content input').first().inputValue()) throw new Error('A new learning game should start with an empty name field.')
    const learningHeader = await window.locator('.learn-edit-header').boundingBox()
    const deleteGameButton = await window.locator('[aria-label="Delete game"]').boundingBox()
    if (!learningHeader || !deleteGameButton || deleteGameButton.y + deleteGameButton.height > learningHeader.y + learningHeader.height + 1) {
      throw new Error('The learning game delete button wrapped outside the header.')
    }
    if (screenshotDir) await window.screenshot({ path: path.join(screenshotDir, 'learning.png') })
    let deleteDialogMessage = ''
    await Promise.all([
      window.waitForEvent('dialog').then(async (dialog) => {
        deleteDialogMessage = dialog.message()
        await dialog.dismiss()
      }),
      window.locator('[aria-label="Delete game"]').click()
    ])
    if (deleteDialogMessage !== 'Delete this learning game?') throw new Error('The learning game deletion confirmation is missing or incorrect.')
    await window.waitForSelector('.learn-type-grid')
    await window.locator('[aria-label="Chats"]').click()
    await window.waitForSelector('.chat-main .composer')

    await window.click('[aria-label="New project"]')
    await window.locator('.modal-panel input').fill('Törlendő projekt')
    await window.locator('.modal-actions .primary-button').click()
    await window.locator('.project-switcher').click()
    await window.locator('[aria-label="Delete: Törlendő projekt"]').click()
    await window.locator('.modal-actions .danger-button').click()
    await window.waitForFunction(() => !document.querySelector('.project-switcher')?.textContent?.includes('Törlendő projekt'))

    await window.locator('.composer .tool-button').filter({ hasText: 'Web' }).click()
    await window.waitForFunction(() => [...document.querySelectorAll('.composer .tool-button')].some((button) => button.textContent?.includes('Web') && button.classList.contains('active')))

    await window.click('[aria-label="Settings"]')
    if (screenshotDir) await window.screenshot({ path: path.join(screenshotDir, 'settings.png') })
    await window.getByRole('tab', { name: 'Grok' }).click()
    await window.waitForFunction(() => [...document.querySelectorAll('.source-toggle button')].some((button) => button.getAttribute('aria-selected') === 'true' && button.textContent?.includes('Grok')))
    if (!(await window.locator('.oauth-connect-button, .connected-badge').count())) throw new Error('The Grok sign-in UI did not appear.')
    await window.getByRole('tab', { name: 'Local AI' }).click()
    await window.waitForFunction(() => [...document.querySelectorAll('.source-toggle button')].some((button) => button.getAttribute('aria-selected') === 'true' && button.textContent?.includes('Local AI')))
    await window.locator('input[placeholder="http://127.0.0.1:1234/v1"]').fill('http://127.0.0.1:12345/v1')
    await window.locator('input[placeholder="Model ID"]').fill('loclm-test-model')
    await window.getByRole('tab', { name: 'Plugins' }).click()
    const webSettings = window.locator('.integration-box').filter({ hasText: 'Web search provider' })
    if (await webSettings.locator('select').inputValue() !== 'browser') throw new Error('The keyless browser is not the default web search provider.')
    await webSettings.locator('input[aria-label="Test search query"]').fill('LocLM browser web test')
    await webSettings.getByRole('button', { name: /Test search/ }).click()
    await webSettings.locator('.success-text').waitFor()

    await webSettings.locator('select').selectOption('searxng')
    await webSettings.locator('label.field input').fill('http://127.0.0.1:12345/tools/searxng')
    await webSettings.locator('input[aria-label="Test search query"]').fill('LocLM web test')
    await webSettings.getByRole('button', { name: /Test search/ }).click()
    await webSettings.locator('.success-text').waitFor()
    await webSettings.locator('select').selectOption('browser')
    await window.waitForFunction(async () => (await window.loclm.state.load()).settings.web.provider === 'browser')
    if (screenshotDir) await window.screenshot({ path: path.join(screenshotDir, 'web-search-settings.png') })
    await window.locator('.settings-header .icon-button').click()

    await window.click('[aria-label="Learning"]')
    if (!(await window.locator('.learn-content input').count())) {
      await window.locator('.learn-main .primary-button, .learn-main .secondary-button').filter({ hasText: 'New game' }).first().click()
    }
    await window.locator('.learn-content input').first().waitFor()
    await window.locator('.learn-content input').first().fill('Smoke quiz')
    await window.locator('.learn-content input[type="number"]').first().fill('2')
    await window.locator('.learn-header-actions [aria-label="Chat model"]').click()
    await window.locator('#chat-model-menu [role="option"]').filter({ hasText: 'loclm-test-model' }).click()
    await window.getByRole('button', { name: 'Generate with AI' }).click()
    await window.waitForFunction(() => document.querySelectorAll('.learn-preview-item').length === 2)
    await window.getByRole('button', { name: 'Start' }).click()
    await window.locator('.learn-option').nth(0).click()
    await window.getByRole('button', { name: 'Next' }).click()
    await window.locator('.learn-option').nth(0).click()
    await window.getByRole('button', { name: 'Finish and evaluate' }).click()
    await window.waitForFunction(() => document.querySelector('.learn-score strong')?.textContent?.includes('1/2 points · 50%'))
    if (await window.locator('.learn-review-card').count() !== 2) throw new Error('The learning result did not list every task.')
    if (await window.getByText('Correct answer', { exact: true }).count() !== 2) throw new Error('Correct answers are missing from the learning result.')
    if (screenshotDir) await window.screenshot({ path: path.join(screenshotDir, 'learning-results.png') })
    await window.locator('[aria-label="Chats"]').click()

    const modelPicker = window.locator('[aria-label="Chat model"]')
    await modelPicker.waitFor()
    if (!(await modelPicker.textContent())?.includes('loclm-test-model')) throw new Error('The chat model picker did not keep the selected local model.')
    await modelPicker.click()
    await window.waitForSelector('#chat-model-menu')
    await window.locator('#chat-model-menu [role="option"]').filter({ hasText: 'loclm-test-model' }).click()
    await window.waitForFunction(() => !document.querySelector('#chat-model-menu'))

    await window.locator('.composer textarea').fill('Mondj egy rövid tesztet')
    await window.locator('.send-button').click()
    await window.waitForSelector('.message.assistant .reasoning-panel.streaming .reasoning-content')
    if (await window.locator('.message.assistant .reasoning-trigger').last().getAttribute('aria-expanded') !== 'true') throw new Error('A gondolkodási panel nem nyílt ki automatikusan streamelés közben.')
    try {
      await window.waitForFunction(() => document.querySelector('.message.assistant .message-body')?.textContent?.includes('Teszt válasz rendben.'), undefined, { timeout: 15_000 })
    } catch (error) {
      const bodyText = await window.locator('body').innerText()
      throw new Error(`A válasz nem jelent meg. Kérések: ${requests.join(', ') || 'nincs'}. Renderer: ${errors.join(' | ') || 'nincs'}. UI: ${bodyText.slice(-700)}. Eredeti hiba: ${error.message}`)
    }

    const responseText = await window.locator('.message.assistant .message-body').textContent()
    if (errors.length) throw new Error(`Renderer hibák: ${errors.join(' | ')}`)
    if (!responseText?.includes('Teszt válasz rendben.')) throw new Error('A streaming modellválasz nem jelent meg.')
    const assistantMessage = window.locator('.message.assistant').last()
    await assistantMessage.locator('.reasoning-trigger').click()
    const reasoningText = await assistantMessage.locator('.published-reasoning').textContent()
    if (!reasoningText?.includes('A strukturált modell-indoklás.') || !reasoningText.includes('Címkés gondolat.')) throw new Error(`A modell reasoningje nem jelent meg helyesen: ${reasoningText ?? 'nincs'}`)
    await assistantMessage.locator('.sources-trigger').click()
    const sourceLink = assistantMessage.locator('.source-list a').first()
    if (await sourceLink.getAttribute('href') !== 'https://example.com/browser-fresh') throw new Error('A webes forrás nem kattintható vagy hibás URL-t kapott.')
    if (screenshotDir) await window.screenshot({ path: path.join(screenshotDir, 'chat-reasoning-sources.png') })
    await window.waitForFunction(async () => {
      const loaded = await window.loclm.state.load()
      const assistant = loaded.chats.flatMap((chat) => chat.messages).findLast((message) => message.role === 'assistant')
      return assistant?.reasoning?.includes('Címkés gondolat.') && assistant.sources?.some((source) => source.url === 'https://example.com/browser-fresh')
    })
    const systemContext = chatBodies
      .map((entry) => entry.messages?.find((message) => message.role === 'system')?.content ?? '')
      .find((content) => content.includes('https://example.com/browser-fresh')) ?? ''
    if (!systemContext.includes('https://example.com/browser-fresh') || !systemContext.includes('Current fact from the background browser & verified.')) {
      throw new Error(`A webes találat nem került a modell kontextusába: ${systemContext.slice(-500)}`)
    }

    const captureWindowPromise = electronApp.waitForEvent('window')
    await window.locator('.composer .tool-button').filter({ hasText: 'Capture' }).click()
    const captureWindow = await captureWindowPromise
    await captureWindow.waitForSelector('.capture-stage')
    const captureStage = await captureWindow.locator('.capture-stage').boundingBox()
    if (!captureStage) throw new Error('A képernyőkivágás rétege nem jelent meg.')
    await captureWindow.mouse.move(captureStage.x + 90, captureStage.y + 90)
    await captureWindow.mouse.down()
    await captureWindow.mouse.move(captureStage.x + 360, captureStage.y + 250, { steps: 5 })
    await captureWindow.mouse.up()
    await captureWindow.locator('.capture-actions .primary-button').click()
    await window.waitForFunction(() => document.querySelectorAll('.message.user').length >= 2, undefined, { timeout: 15_000 })
    await window.locator('[aria-label="Project files"]').click()
    await window.waitForSelector('.files-main .file-card')
    const projectFileName = await window.locator('.file-card-body strong').first().textContent()
    if (!projectFileName?.includes('Screenshot')) throw new Error('The screenshot was not added to the project folder.')
    if (screenshotDir) await window.screenshot({ path: path.join(screenshotDir, 'project-files-populated.png') })

    console.log('LocLM Electron smoke test: PASS')
  } finally {
    if (electronApp) await electronApp.close()
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
