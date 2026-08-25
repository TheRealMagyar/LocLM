import { BrowserWindow, dialog } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import mammoth from 'mammoth'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import type { Attachment } from '../shared/types'

export class DocumentService {
  async enrichAttachment(attachment: Attachment): Promise<Attachment> {
    if (!attachment.path) return attachment
    const extension = extname(attachment.name).toLowerCase()

    if (attachment.mimeType.startsWith('image/')) {
      const bytes = await readFile(attachment.path)
      return { ...attachment, previewDataUrl: `data:${attachment.mimeType};base64,${bytes.toString('base64')}` }
    }

    if (extension === '.pdf') {
      return { ...attachment, extractedText: await extractPdfText(attachment.path) }
    }

    if (extension === '.docx') {
      const result = await mammoth.extractRawText({ path: attachment.path })
      return { ...attachment, extractedText: result.value.trim() }
    }

    if (['.txt', '.md', '.json', '.csv', '.tsv', '.log', '.xml', '.html', '.css', '.js', '.ts', '.tsx', '.jsx'].includes(extension)) {
      return { ...attachment, extractedText: await readFile(attachment.path, 'utf8') }
    }

    return attachment
  }

  async exportText(title: string, content: string, format: 'docx' | 'pdf' | 'md' | 'txt'): Promise<string | undefined> {
    const result = await dialog.showSaveDialog({
      title: 'Válasz exportálása',
      defaultPath: `${sanitizeFileName(title || 'LocLM-valasz')}.${format}`,
      filters: formatFilters(format)
    })
    if (result.canceled || !result.filePath) return undefined

    if (format === 'docx') {
      const paragraphs = content.split(/\n{2,}/).map((paragraph) => new Paragraph({
        children: [new TextRun(paragraph.replace(/\n/g, ' '))],
        spacing: { after: 180 }
      }))
      const document = new Document({ sections: [{ children: paragraphs }] })
      await writeFile(result.filePath, await Packer.toBuffer(document))
      return result.filePath
    }

    if (format === 'pdf') {
      await exportPdf(result.filePath, title, content)
      return result.filePath
    }

    await writeFile(result.filePath, content, 'utf8')
    return result.filePath
  }
}

async function extractPdfText(filePath: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const bytes = new Uint8Array(await readFile(filePath))
  const pdf = await pdfjs.getDocument({ data: bytes }).promise
  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const text = await page.getTextContent()
    const pageText = text.items
      .map((item) => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join(' ')
    pages.push(pageText)
  }
  return pages.join('\n\n').trim()
}

async function exportPdf(filePath: string, title: string, content: string): Promise<void> {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#171815;margin:52px;font-size:12pt;line-height:1.55}
    h1{font-size:22pt;font-weight:600;margin:0 0 28px}p{white-space:pre-wrap;margin:0 0 14px}
  </style></head><body><h1>${escapeHtml(title)}</h1>${content.split(/\n{2,}/).map((part) => `<p>${escapeHtml(part)}</p>`).join('')}</body></html>`
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    await writeFile(filePath, pdf)
  } finally {
    window.destroy()
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*]+/g, '-').trim().slice(0, 80) || 'LocLM-valasz'
}

function formatFilters(format: string): Electron.FileFilter[] {
  const names: Record<string, string> = { docx: 'Word dokumentum', pdf: 'PDF dokumentum', md: 'Markdown', txt: 'Szöveg' }
  return [{ name: names[format] ?? format.toUpperCase(), extensions: [format] }]
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[character] ?? character)
}
