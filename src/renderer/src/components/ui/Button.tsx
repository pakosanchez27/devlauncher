import type { ButtonHTMLAttributes, ReactElement } from 'react'
import Icon from './Icon'
import type { IconName } from './Icon'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
type ButtonSize = 'sm' | 'md'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'border border-transparent bg-indigo-500 text-white shadow-sm shadow-indigo-950/40 hover:bg-indigo-400',
  secondary:
    'border border-slate-700 bg-slate-900/60 text-slate-200 hover:border-slate-500 hover:bg-slate-800/60',
  ghost: 'border border-transparent text-slate-400 hover:bg-slate-800/70 hover:text-slate-100',
  danger:
    'border border-red-900/70 bg-red-950/30 text-red-300 hover:border-red-600 hover:bg-red-950/60 hover:text-red-200',
  subtle:
    'border border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-600 hover:text-slate-100'
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-xs',
  md: 'h-9 gap-2 px-3.5 text-sm'
}

const BASE =
  'inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Muestra un indicador de carga y deshabilita el botón. */
  loading?: boolean
  icon?: IconName
}

/** Botón con las variantes visuales de la aplicación. */
function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  disabled,
  children,
  ...props
}: ButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Icon name="spinner" size={size === 'sm' ? 13 : 15} className="animate-spin" />
      ) : (
        icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} />
      )}
      {children}
    </button>
  )
}

export default Button
