import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleDot,
  Cpu,
  KeyRound,
  LoaderCircle,
  PlugZap,
  Server,
  ShieldCheck,
} from 'lucide-react';
import type {
  ModelConnectionResult,
  ModelProviderSelection,
  ModelProviderState,
} from './types.js';

interface ProviderManagerProps {
  state: ModelProviderState;
  busy: boolean;
  onSave(selection: ModelProviderSelection): Promise<void>;
  onTest(): Promise<ModelConnectionResult>;
}

export function ProviderManager({ state, busy, onSave, onTest }: ProviderManagerProps) {
  const [selection, setSelection] = useState<ModelProviderSelection>(state.selection);
  const [result, setResult] = useState<ModelConnectionResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setSelection(state.selection);
    setResult(null);
    setError('');
  }, [state.selection]);

  const provider = useMemo(
    () => state.providers.find((item) => item.id === selection.providerId) ?? state.providers[0]!,
    [selection.providerId, state.providers],
  );
  const dirty = JSON.stringify(selection) !== JSON.stringify(state.selection);
  const baseUrlEditable = provider.id === 'custom' || !provider.apiKeyEnv;

  const select = (providerId: string) => {
    const next = state.providers.find((item) => item.id === providerId)!;
    setSelection({
      providerId,
      model: providerId === 'deterministic' ? '' : next.modelHint ?? '',
      ...(next.baseUrl ? { baseUrl: next.baseUrl } : {}),
    });
    setResult(null);
    setError('');
  };

  const save = async () => {
    setError('');
    setResult(null);
    try {
      await onSave(selection);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const test = async () => {
    setError('');
    setResult(null);
    try {
      setResult(await onTest());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="library-view model-view">
      <header className="view-heading">
        <div>
          <h1>Model providers</h1>
          <p>Run model-backed Agent nodes without coupling Packs to a vendor SDK.</p>
        </div>
        <code>{state.mode === 'deterministic' ? 'zero-key mode' : `${state.selection.providerId} · ${state.selection.model}`}</code>
      </header>

      <div className="model-grid">
        <aside className="provider-list" aria-label="Model providers">
          <header><strong>Providers</strong><span>{state.providers.length} available</span></header>
          {state.providers.map((item) => (
            <button
              key={item.id}
              className={item.id === provider.id ? 'selected' : ''}
              onClick={() => select(item.id)}
            >
              <span className="provider-symbol">{item.local ? <Server size={15} /> : <Cpu size={15} />}</span>
              <span><strong>{item.label}</strong><small>{item.protocol}</small></span>
              <i className={item.configured ? 'configured' : ''} title={item.configured ? 'Credential available' : 'Credential missing'} />
            </button>
          ))}
        </aside>

        <div className="provider-detail">
          <header className="provider-detail-heading">
            <span className="provider-hero-icon">{provider.local ? <Server size={20} /> : <Cpu size={20} />}</span>
            <span><h2>{provider.label}</h2><p>{provider.protocol}</p></span>
            <em className={provider.configured ? 'ready' : 'missing'}>
              {provider.configured ? <CheckCircle2 size={13} /> : <CircleDot size={13} />}
              {provider.configured ? 'Available' : 'Needs credential'}
            </em>
          </header>

          {provider.id === 'deterministic' ? (
            <div className="provider-zero-key">
              <ShieldCheck size={25} />
              <h3>Local deterministic execution</h3>
              <p>Bundled Pack handlers run without a model, account or network request. This remains the default first-run path.</p>
            </div>
          ) : (
            <div className="provider-form">
              <label>
                <span>Model</span>
                <input
                  value={selection.model}
                  placeholder={provider.modelHint ?? 'Enter a model identifier'}
                  onChange={(event) => setSelection((current) => ({ ...current, model: event.target.value }))}
                />
                <small>Model identifiers remain editable because availability differs by account and region.</small>
              </label>
              <label>
                <span>Base URL</span>
                <input
                  value={selection.baseUrl ?? provider.baseUrl}
                  placeholder="https://provider.example/v1"
                  disabled={!baseUrlEditable}
                  onChange={(event) => setSelection((current) => ({ ...current, baseUrl: event.target.value }))}
                />
                <small>{baseUrlEditable
                  ? 'Custom and keyless providers may use a reviewed compatible endpoint.'
                  : 'Credentialed provider endpoints are locked so API keys cannot be redirected.'}</small>
              </label>
              <div className="credential-boundary">
                <KeyRound size={16} />
                <span>
                  <strong>{provider.apiKeyEnv ? `Credential: ${provider.apiKeyEnv}` : 'No API key required'}</strong>
                  <small>Secrets are read by the local server and are never sent to this browser or stored in the workspace.</small>
                </span>
              </div>
            </div>
          )}

          {error ? <p className="provider-message error">{error}</p> : null}
          {result ? <p className="provider-message success"><CheckCircle2 size={13} />Connected to {result.model} in {result.latencyMs} ms · {result.response}</p> : null}

          <footer className="provider-actions">
            <span><PlugZap size={14} />Save before testing a changed selection.</span>
            <button className="button secondary" disabled={busy || dirty} onClick={() => void test()}>{busy ? <LoaderCircle className="spin" size={14} /> : <PlugZap size={14} />}Test connection</button>
            <button className="button primary" disabled={busy} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" size={14} /> : null}Use provider</button>
          </footer>
        </div>
      </div>

      <div className="registry-note model-note">
        <strong>Runtime boundary</strong>
        <p>Packs declare Agent intent and writable state. The selected provider executes on the local server; graph validation, retries, timeouts, events and human gates remain enforced by the same runtime.</p>
      </div>
    </section>
  );
}
