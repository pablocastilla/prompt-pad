import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { t } from '../i18n';

interface TabContextMenuProps {
  tabId: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function TabContextMenu({ tabId, x, y, onClose }: TabContextMenuProps) {
  const tabs = useStore(s => s.tabs);
  const activeTabId = useStore(s => s.activeTabId);
  const closeTab = useStore(s => s.closeTab);
  const closeTabsLeft = useStore(s => s.closeTabsLeft);
  const closeTabsRight = useStore(s => s.closeTabsRight);
  const closeAllTabs = useStore(s => s.closeAllTabs);
  const closeOtherTabs = useStore(s => s.closeOtherTabs);
  const settings = useStore(s => s.settings);
  const addToast = useStore(s => s.addToast);
  const menuRef = useRef<HTMLDivElement>(null);

  const idx = tabs.findIndex(t => t.id === tabId);
  const hasLeft = idx > 0;
  const hasRight = idx < tabs.length - 1;
  const hasOthers = tabs.length > 1;

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleAction = (action: () => void) => {
    action();
    onClose();
    if (settings.theme === 'gaudy') addToast(t('gaudyCloseTab'));
  };

  return (
    <div
      ref={menuRef}
      className="tab-context-menu"
      style={{ left: x, top: y }}
    >
      <button className="tab-context-item" onClick={() => handleAction(() => closeTab(tabId))}>
        {t('closeTab')}
      </button>
      <button
        className={'tab-context-item' + (!hasLeft ? ' disabled' : '')}
        disabled={!hasLeft}
        onClick={() => hasLeft && handleAction(() => closeTabsLeft(tabId))}
      >
        {t('closeTabsLeft')}
      </button>
      <button
        className={'tab-context-item' + (!hasRight ? ' disabled' : '')}
        disabled={!hasRight}
        onClick={() => hasRight && handleAction(() => closeTabsRight(tabId))}
      >
        {t('closeTabsRight')}
      </button>
      <div className="tab-context-separator" />
      <button
        className={'tab-context-item' + (!hasOthers ? ' disabled' : '')}
        disabled={!hasOthers}
        onClick={() => hasOthers && handleAction(() => closeOtherTabs(tabId))}
      >
        {t('closeOtherTabs')}
      </button>
      <button
        className="tab-context-item danger"
        onClick={() => handleAction(() => closeAllTabs(tabId))}
      >
        {t('closeAllTabs')}
      </button>
    </div>
  );
}
