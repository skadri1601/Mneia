'use client';

import { useRef, useState } from 'react';
import type { ClientSetup as ClientSetupContent } from '@/content/client-setup';
import { setupPrompt } from '@/content/client-setup';
import styles from './ClientSetup.module.css';

type CopyTarget = 'prompt' | 'command' | 'manual';

export function ClientSetup({ clients }: { clients: readonly ClientSetupContent[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = clients[selectedIndex] ?? clients[0];

  if (selected === undefined) return null;

  const select = (index: number, focus = false): void => {
    setSelectedIndex(index);
    setCopyStatus('');
    if (focus) tabs.current[index]?.focus();
  };

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      next = (index + 1) % clients.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + clients.length) % clients.length;
    } else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = clients.length - 1;
    else return;

    event.preventDefault();
    select(next, true);
  };

  const copy = async (target: CopyTarget): Promise<void> => {
    const value =
      target === 'prompt'
        ? setupPrompt(selected)
        : target === 'command'
          ? selected.automaticCommand
          : selected.manualConfig.join('\n');
    const label = target === 'prompt' ? `${selected.label} setup prompt` : target;

    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} copied.`);
    } catch {
      setCopyStatus(`Could not copy the ${label}. Select the text and copy it manually.`);
    }
  };

  return (
    <div className={styles.setup}>
      <div aria-label="Choose your MCP client" className={styles.tabs} role="tablist">
        {clients.map((client, index) => {
          const isSelected = index === selectedIndex;
          return (
            <button
              aria-controls={`client-panel-${client.id}`}
              aria-selected={isSelected}
              className={styles.tab}
              id={`client-tab-${client.id}`}
              key={client.id}
              onClick={() => select(index)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              role="tab"
              tabIndex={isSelected ? 0 : -1}
              type="button"
            >
              {client.label}
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby={`client-tab-${selected.id}`}
        className={styles.panel}
        id={`client-panel-${selected.id}`}
        role="tabpanel"
      >
        <div className={styles.intro}>
          <div>
            <p className={styles.kicker}>Connect your agent</p>
            <h3 className={styles.title}>{selected.title}</h3>
            <p className={styles.summary}>{selected.summary}</p>
          </div>
          <button className={styles.primaryButton} onClick={() => copy('prompt')} type="button">
            Copy setup prompt
          </button>
        </div>

        <div className={styles.detailGrid}>
          <section className={styles.detail}>
            <div className={styles.detailHeading}>
              <div>
                <p className={styles.kicker}>Recommended</p>
                <h4 className={styles.subheading}>Automatic setup</h4>
              </div>
              <button className={styles.copyButton} onClick={() => copy('command')} type="button">
                Copy command
              </button>
            </div>
            <pre className={styles.code}>
              <code>{selected.automaticCommand}</code>
            </pre>
          </section>

          <section className={styles.detail}>
            <div className={styles.detailHeading}>
              <div>
                <p className={styles.kicker}>Manual fallback</p>
                <h4 className={styles.subheading}>{selected.manualLabel}</h4>
              </div>
              <button className={styles.copyButton} onClick={() => copy('manual')} type="button">
                Copy manual config
              </button>
            </div>
            <pre className={styles.code}>
              <code>{selected.manualConfig.join('\n')}</code>
            </pre>
          </section>
        </div>

        <p className={styles.verify}>
          <strong>Verify:</strong> {selected.verification}
        </p>
        <p aria-live="polite" className={styles.status} role="status">
          {copyStatus}
        </p>
      </div>
    </div>
  );
}
