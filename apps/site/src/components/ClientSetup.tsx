'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClientSetup as ClientSetupContent } from '@/content/client-setup';
import { setupPrompt } from '@/content/client-setup';
import styles from './ClientSetup.module.css';

type CopyTarget = 'prompt' | 'command' | 'manual';

export function ClientSetup({ clients }: { clients: readonly ClientSetupContent[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = clients[selectedIndex] ?? clients[0];

  useEffect(() => {
    const prefix = '#mcp-client-';
    if (!window.location.hash.startsWith(prefix)) return;
    const clientId = window.location.hash.slice(prefix.length);
    const linkedIndex = clients.findIndex((client) => client.id === clientId);
    if (linkedIndex >= 0) setSelectedIndex(linkedIndex);
  }, [clients]);

  if (selected === undefined) return null;

  const select = (index: number, focus = false): void => {
    setSelectedIndex(index);
    setCopyStatus('');
    setCopiedTarget(null);
    const client = clients[index];
    if (client !== undefined) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}#mcp-client-${client.id}`,
      );
    }
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

  const copy = async (target: CopyTarget, client: ClientSetupContent): Promise<void> => {
    const value =
      target === 'prompt'
        ? setupPrompt(client)
        : target === 'command'
          ? client.automaticCommand
          : client.manualConfig.join('\n');
    const label = target === 'prompt' ? `${client.label} setup prompt` : target;

    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} copied.`);
      setCopiedTarget(`${client.id}:${target}`);
    } catch {
      setCopiedTarget(null);
      if (target === 'prompt') setExpandedPrompt(client.id);
      setCopyStatus(`Could not copy the ${label}. Open the text below and copy it manually.`);
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

      {clients.map((client, index) => (
        <div
          aria-labelledby={`client-tab-${client.id}`}
          className={styles.panel}
          hidden={index !== selectedIndex}
          id={`client-panel-${client.id}`}
          key={client.id}
          role="tabpanel"
        >
          <div className={styles.intro}>
            <div>
              <p className={styles.kicker}>Connect your agent</p>
              <h3 className={styles.title}>{client.title}</h3>
              <p className={styles.summary}>{client.summary}</p>
            </div>
            <button
              aria-label={
                copiedTarget === `${client.id}:prompt`
                  ? `${client.label} setup prompt copied`
                  : `Copy ${client.label} setup prompt`
              }
              className={styles.primaryButton}
              onClick={() => copy('prompt', client)}
              type="button"
            >
              {copiedTarget === `${client.id}:prompt` ? 'Copied' : 'Copy setup prompt'}
            </button>
          </div>

          <details
            className={styles.promptDetails}
            onToggle={(event) => setExpandedPrompt(event.currentTarget.open ? client.id : null)}
            open={expandedPrompt === client.id}
          >
            <summary>View complete setup prompt</summary>
            <pre className={styles.prompt}>
              <code>{setupPrompt(client)}</code>
            </pre>
          </details>

          <div className={styles.detailGrid}>
            <section className={styles.detail}>
              <div className={styles.detailHeading}>
                <div>
                  <p className={styles.kicker}>Recommended</p>
                  <h4 className={styles.subheading}>Automatic setup</h4>
                </div>
                <button
                  aria-label="Copy automatic setup command"
                  className={styles.copyButton}
                  onClick={() => copy('command', client)}
                  type="button"
                >
                  Copy
                </button>
              </div>
              <pre className={styles.code}>
                <code>{client.automaticCommand}</code>
              </pre>
            </section>

            <section className={styles.detail}>
              <div className={styles.detailHeading}>
                <div>
                  <p className={styles.kicker}>Manual fallback</p>
                  <h4 className={styles.subheading}>{client.manualLabel}</h4>
                </div>
                <button
                  aria-label="Copy manual configuration"
                  className={styles.copyButton}
                  onClick={() => copy('manual', client)}
                  type="button"
                >
                  Copy
                </button>
              </div>
              <pre className={styles.code}>
                <code>{client.manualConfig.join('\n')}</code>
              </pre>
            </section>
          </div>

          <p className={styles.verify}>
            <strong>Verify:</strong> {client.verification}
          </p>
          <p aria-live="polite" className={styles.status} role="status">
            {copyStatus}
          </p>
        </div>
      ))}
    </div>
  );
}
