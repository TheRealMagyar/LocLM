import logo from '../assets/loclm-logo.png'

interface BrandLogoProps {
  className?: string
  size?: 'small' | 'medium' | 'large'
}

export default function BrandLogo({ className = '', size = 'medium' }: BrandLogoProps): React.JSX.Element {
  return <img className={`brand-logo ${size} ${className}`.trim()} src={logo} alt="" draggable={false} />
}
