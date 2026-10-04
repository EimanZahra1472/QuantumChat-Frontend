/**
 * Unified preloading registry for code-split lazy components.
 * Reuses the exact same dynamic import promises used by React.lazy.
 */

export const preloadMap = {
  settings: () => import('../components/SettingsModal.jsx'),
  meeting: () => import('../components/MeetingOverlay.jsx'),
  aiAssistant: () => import('../components/AIAssistantPanel.jsx'),
  chatTheme: () => import('../components/ChatThemeModal.jsx'),
  userProfile: () => import('../components/UserProfileModal.jsx'),
  groupSettings: () => import('../components/GroupSettingsModal.jsx'),
  groupCommandCenter: () => import('../components/GroupCommandCenter.jsx'),
  createGroup: () => import('../components/CreateGroupModal.jsx'),
  chatMedia: () => import('../components/chat/ChatMediaModal.jsx'),
  messageInfo: () => import('../components/MessageInfoModal.jsx'),
  starredMessages: () => import('../components/StarredMessagesModal.jsx'),
  editHistory: () => import('../components/EditHistoryModal.jsx'),
  timeCapsule: () => import('../components/TimeCapsuleModal.jsx'),
  forward: () => import('../components/ForwardModal.jsx'),
  imageLightbox: () => import('../components/ImageLightbox.jsx'),
  auroraFX: () => import('../components/AuroraFX.jsx'),
  textStoryComposer: () => import('../components/TextStoryComposer.jsx'),
  storyHistory: () => import('../components/StoryHistoryPanel.jsx'),
  highlightPicker: () => import('../components/HighlightPickerSheet.jsx'),
};

/**
 * Triggers a chunk download ahead of time when user intent is detected.
 * @param {keyof typeof preloadMap} key
 */
export function preload(key) {
  const loader = preloadMap[key];
  if (typeof loader === 'function') {
    return loader().catch((err) => {
      // Intent preloads should fail silently if offline; actual render error boundary handles errors.
      console.debug(`[preload] Prefetch for ${key} failed (ignorable until actual render):`, err);
    });
  }
}

/**
 * Preloads a component when browser is idle, with a setTimeout fallback.
 * @param {keyof typeof preloadMap} key
 * @param {number} timeoutMs
 */
export function preloadOnIdle(key, timeoutMs = 2500) {
  if (typeof window === 'undefined') return;
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => preload(key), { timeout: timeoutMs });
  } else {
    setTimeout(() => preload(key), timeoutMs);
  }
}
