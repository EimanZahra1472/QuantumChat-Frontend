import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext.jsx';
import { getWallpaperBackground } from '../theme/wallpaperBackgrounds.js';
import './ThemePreviewCard.css';

/**
 * Live theme & chat-bubble preview card for Settings and Chat Theme modals.
 * Purely presentational, updates instantly without drift.
 *
 * @param {Object} props
 * @param {string} [props.themeOverride] - Explicit theme name (e.g. 'light', 'dark', 'sakura')
 * @param {string} [props.wallpaperId] - Wallpaper preset id (e.g. 'aurora', 'circuit')
 * @param {string} [props.customWallpaperUrl] - Custom user-uploaded wallpaper blob URL
 * @param {Object} [props.bubbleColor] - Custom bubble color { mine, theirs }
 * @param {string} [props.className='']
 */
export default function ThemePreviewCard({
  themeOverride,
  wallpaperId,
  customWallpaperUrl,
  bubbleColor,
  className = '',
}) {
  const { t } = useTranslation();
  const { theme: activeContextTheme } = useTheme();
  const currentTheme = themeOverride || activeContextTheme || 'dark';

  // Compute wallpaper background
  let backgroundStyle = {};
  if (wallpaperId === 'custom' && customWallpaperUrl) {
    backgroundStyle = {
      backgroundImage: `url(${customWallpaperUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    };
  } else if (wallpaperId && wallpaperId !== 'none') {
    const wpBg = getWallpaperBackground(wallpaperId);
    if (wpBg && wpBg !== 'transparent') {
      backgroundStyle = {
        background: wpBg,
      };
    }
  }

  // Compute bubble override style if custom colors are supplied
  const bubbleStyleMine = bubbleColor?.mine
    ? { background: bubbleColor.mine, borderColor: 'transparent' }
    : undefined;

  return (
    <div
      className={`qc-theme-preview-card ${className}`.trim()}
      data-theme={currentTheme}
      aria-hidden="true"
    >
      <div className="qc-theme-preview-header">
        <span className="qc-theme-preview-title">
          {t('settings.preview.title', 'Chat Preview')}
        </span>
        <span className="qc-theme-preview-badge">
          {currentTheme.toUpperCase()}
        </span>
      </div>

      <div
        className="qc-theme-preview-canvas"
        style={backgroundStyle}
      >
        {/* Ambient shader/particle simulation for fun themes */}
        <div className={`qc-theme-preview-ambient qc-theme-preview-ambient--${currentTheme}`} />

        {/* Received Bubble */}
        <div className="qc-theme-preview-bubble-row theirs">
          <div className="message-bubble theirs qc-theme-preview-bubble">
            <span className="qc-theme-preview-text">
              {t('settings.preview.receivedSample', 'Hey! How does the new theme look?')}
            </span>
            <span className="qc-theme-preview-time">10:41 AM</span>
          </div>
        </div>

        {/* Sent Bubble */}
        <div className="qc-theme-preview-bubble-row mine">
          <div
            className="message-bubble mine qc-theme-preview-bubble"
            style={bubbleStyleMine}
          >
            <span className="qc-theme-preview-text">
              {t('settings.preview.sentSample', 'Looks crisp and smooth! ✨')}
            </span>
            <span className="qc-theme-preview-time mine">
              10:42 AM
              <svg
                width="14"
                height="10"
                viewBox="0 0 16 11"
                fill="currentColor"
                className="qc-theme-preview-check"
                aria-hidden="true"
              >
                <path d="M11.07 0.93a.75.75 0 0 0-1.06 0L5.22 5.72l-1.97-1.97a.75.75 0 0 0-1.06 1.06l2.5 2.5a.75.75 0 0 0 1.06 0l5.32-5.32a.75.75 0 0 0 0-1.06z" />
                <path d="M15.07 0.93a.75.75 0 0 0-1.06 0L9.22 5.72 8.44 4.94a.75.75 0 0 0-1.06 1.06l1.31 1.31a.75.75 0 0 0 1.06 0l5.32-5.32a.75.75 0 0 0 0-1.06z" />
              </svg>
            </span>
          </div>
        </div>

        {/* Mini Composer Bar */}
        <div className="qc-theme-preview-composer">
          <div className="qc-theme-preview-action-icon">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </div>
          <span className="qc-theme-preview-placeholder">
            {t('settings.preview.composerPlaceholder', 'Type a message…')}
          </span>
          <div className="qc-theme-preview-send-btn">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
