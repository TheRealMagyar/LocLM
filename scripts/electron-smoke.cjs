const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')
const { _electron: electron } = require('playwright-core')

async function main() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loclm-smoke-'))
  const screenshotDir = process.env.LOCLM_SMOKE_SCREENSHOT_DIR
  if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true })
  const requests = []
  const server = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    if (request.url === '/v1/models') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'loclm-test-model' }] }))
      return
    }
    if (request.url === '/v1/chat/completions') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Teszt ' } }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'válasz rendben.' } }] })}\n\n`)
      response.end('data: [DONE]\n\n')
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
      env: { ...process.env, LOCLM_USER_DATA_DIR: userDataDir }
    })
    electronApp.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    const window = await electronApp.firstWindow()
    window.on('pageerror', (error) => errors.push(error.stack ?? error.message))
    await window.waitForSelector('.app-shell')
    await window.waitForSelector('.app-titlebar')
    await window.waitForSelector('.brand-logo')

    await window.click('[aria-label="Új projekt"]')
    await window.locator('.modal-panel input').fill('Smoke projekt')
    await window.locator('.modal-actions .primary-button').click()
    await window.waitForFunction(() => document.querySelector('.project-switcher')?.textContent?.includes('Smoke projekt'))

    await window.locator('.project-switcher').click()
    await window.locator('[aria-label="Smoke projekt átnevezése"]').click()
    await window.locator('.modal-panel input').fill('Átnevezett projekt')
    await window.locator('.modal-actions .primary-button').click()
    await window.waitForFunction(() => document.querySelector('.project-switcher')?.textContent?.includes('Átnevezett projekt'))

    await window.locator('[aria-label="Projektfájlok"]').click()
    await window.waitForSelector('.files-main .files-empty')
    if (screenshotDir) await window.screenshot({ path: path.join(screenshotDir, 'project-files.png') })
    await window.locator('[aria-label="Chatek"]').click()
    await window.waitForSelector('.chat-main .composer')

    await window.click('[aria-label="Új projekt"]')
    await window.locator('.modal-panel input').fill('Törlendő projekt')
    await window.locator('.modal-actions .primary-button').click()
    await window.locator('.project-switcher').click()
    await window.locator('[aria-label="Törlendő projekt törlése"]').click()
    await window.locator('.modal-actions .danger-button').click()
    await window.waitForFunction(() => !document.querySelector('.project-switcher')?.textContent?.includes('Törlendő projekt'))

    await window.click('[aria-label="Beállítások"]')
    if (screenshotDir) await window.screenshot({ path: path.join(screenshotDir, 'settings.png') })
    await window.locator('input[placeholder="http://127.0.0.1:1234/v1"]').fill('http://127.0.0.1:12345/v1')
    await window.locator('input[placeholder="Model ID"]').fill('loclm-test-model')
    await window.locator('.settings-header .icon-button').click()

    await window.locator('.composer textarea').fill('Mondj egy rövid tesztet')
    await window.locator('.send-button').click()
    try {
      await window.waitForFunction(() => document.querySelector('.message.assistant .message-body')?.textContent?.includes('Teszt válasz rendben.'), undefined, { timeout: 15_000 })
    } catch (error) {
      const bodyText = await window.locator('body').innerText()
      throw new Error(`A válasz nem jelent meg. Kérések: ${requests.join(', ') || 'nincs'}. Renderer: ${errors.join(' | ') || 'nincs'}. UI: ${bodyText.slice(-700)}. Eredeti hiba: ${error.message}`)
    }

    const responseText = await window.locator('.message.assistant .message-body').textContent()
    if (errors.length) throw new Error(`Renderer hibák: ${errors.join(' | ')}`)
    if (!responseText?.includes('Teszt válasz rendben.')) throw new Error('A streaming modellválasz nem jelent meg.')

    const captureWindowPromise = electronApp.waitForEvent('window')
    await window.locator('.composer .tool-button').filter({ hasText: 'Kivágás' }).click()
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
    await window.locator('[aria-label="Projektfájlok"]').click()
    await window.waitForSelector('.files-main .file-card')
    const projectFileName = await window.locator('.file-card-body strong').first().textContent()
    if (!projectFileName?.includes('Képernyőkivágás')) throw new Error('A képernyőkivágás nem került be a projektmappába.')
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
