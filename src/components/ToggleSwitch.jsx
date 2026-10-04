import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import './ToggleSwitch.css';

/**
 * iOS/macOS-style spring toggle switch.
 * Fully accessible with native <input type="checkbox" role="switch"> under the hood.
 *
 * @param {Object} props
 * @param {boolean} props.checked
 * @param {(checked: boolean) => void} props.onChange
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.id]
 * @param {string} [props.ariaLabel]
 * @param {string} [props.label]
 * @param {'sm' | 'md' | 'lg'} [props.size='md']
 * @param {string} [props.className='']
 */
export default function ToggleSwitch({
  checked = false,
  onChange,
  disabled = false,
  id,
  ariaLabel,
  label,
  size = 'md',
  className = '',
}) {
  const shouldReduceMotion = useReducedMotion();
  const inputId = id || (label ? `qc-toggle-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined);
  const effectiveAriaLabel = ariaLabel || label || 'Toggle';

  const springTransition = shouldReduceMotion
    ? { duration: 0 }
    : { type: 'spring', stiffness: 500, damping: 30 };

  const handleInputChange = (e) => {
    if (disabled) return;
    onChange?.(e.target.checked);
  };

  return (
    <label
      htmlFor={inputId}
      className={`qc-toggle-wrap qc-toggle--${size} ${disabled ? 'qc-toggle--disabled' : ''} ${className}`.trim()}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        role="switch"
        id={inputId}
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        aria-label={effectiveAriaLabel}
        onChange={handleInputChange}
        className="qc-toggle-input"
      />
      <span
        className={`qc-toggle-track ${checked ? 'qc-toggle-track--on' : 'qc-toggle-track--off'}`}
        aria-hidden="true"
      >
        <motion.span
          layout
          transition={springTransition}
          className={`qc-toggle-thumb ${checked ? 'qc-toggle-thumb--on' : 'qc-toggle-thumb--off'}`}
        />
      </span>
    </label>
  );
}
