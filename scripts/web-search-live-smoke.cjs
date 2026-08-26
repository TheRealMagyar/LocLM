const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')

async function main() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loclm-web-live-'))
  let electronApp
  try {
    const packagedExecutable = process.env.LOCLM_EXECUTABLE_PATH
    electronApp = await electron.launch({
      executablePath: packagedExecutable || path.join(process.cwd(), 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
      args: packagedExecutable ? [] : ['.'],
      cwd: process.cwd(),
      env: { ...process.env, LOCLM_USER_DATA_DIR: userDataDir, LOCLM_BROWSER_SEARCH_URL_TEMPLATE: '' }
    })
    const window = await electronApp.firstWindow()
    await window.waitForSelector('.app-shell')
    const results = await window.evaluate(() => window.loclm.web.search(
      'LocLM local AI desktop application',
      { provider: 'browser', browserEngine: 'automatic', searxngUrl: '' },
      'en'
    ))
    if (!results.length) throw new Error('The live browser search returned no results.')
    if (!results.every((result) => /^https?:\/\//.test(result.url))) throw new Error('The live browser search returned an invalid URL.')
    console.log(`LocLM live web search: PASS (${results.length} results, first: ${results[0].url})`)
  } finally {
    if (electronApp) await electronApp.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
