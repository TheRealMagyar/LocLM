import { X } from 'lucide-react'

interface ModalProps {
  title: string
  description?: string
  children: React.ReactNode
  onClose: () => void
  closeLabel?: string
}

export default function Modal({ title, description, children, onClose, closeLabel = 'Close' }: ModalProps): React.JSX.Element {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" type="button" aria-label={closeLabel} onClick={onClose}><X size={17} /></button>
        </div>
        {children}
      </section>
    </div>
  )
}
