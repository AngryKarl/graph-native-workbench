import { useRef, useState } from 'react';
import {
  AlertTriangle, Box, Check, Download, FileArchive, Globe2, KeyRound, LoaderCircle,
  PackageCheck, Play, ShieldCheck, Trash2, Upload, X,
} from 'lucide-react';
import type { PackArtifactPreview, PackCatalogItem, RegistrySource } from './types.js';

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function PackManager({
  catalog, registries, registriesLoading, activePackId, installedPackIds, busyPackId, onInspectArtifact,
  onImportArtifact, onInstallRegistry, onInstall, onActivate, onUninstall,
}: {
  catalog: PackCatalogItem[];
  registries: RegistrySource[];
  registriesLoading: boolean;
  activePackId: string;
  installedPackIds: string[];
  busyPackId: string | null;
  onInspectArtifact: (file: File) => Promise<PackArtifactPreview>;
  onImportArtifact: (file: File) => Promise<void>;
  onInstallRegistry: (registryId: string, packId: string, version: string) => void;
  onInstall: (packId: string) => void;
  onActivate: (packId: string) => void;
  onUninstall: (packId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [artifact, setArtifact] = useState<{ file: File; preview: PackArtifactPreview } | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState('');
  const importing = busyPackId === '__artifact__';

  const selectArtifact = async (file: File | undefined) => {
    if (!file) return;
    setInspecting(true);
    setError('');
    setArtifact(null);
    try {
      setArtifact({ file, preview: await onInspectArtifact(file) });
    } catch (resolved) {
      setError(resolved instanceof Error ? resolved.message : String(resolved));
    } finally {
      setInspecting(false);
      if (input.current) input.current.value = '';
    }
  };

  const installArtifact = async () => {
    if (!artifact) return;
    setError('');
    try {
      await onImportArtifact(artifact.file);
      setArtifact(null);
    } catch (resolved) {
      setError(resolved instanceof Error ? resolved.message : String(resolved));
    }
  };

  return (
    <main className="library-view">
      <div className="view-heading">
        <div><h1>Industry Packs</h1><p>Install governed workflow capabilities into this workbench.</p></div>
        <button className="button primary" disabled={inspecting || importing} onClick={() => input.current?.click()}>
          <Upload size={15} />{inspecting ? 'Inspecting…' : 'Import .gpack'}
        </button>
        <input ref={input} className="visually-hidden" type="file" accept=".gpack,application/zip" onChange={(event) => void selectArtifact(event.target.files?.[0])} />
      </div>

      {artifact ? (
        <section className="artifact-review" aria-label="Pack installation review">
          <div className="artifact-symbol"><FileArchive size={22} /></div>
          <div className="artifact-copy">
            <div><h2>{artifact.preview.name}</h2><span>{artifact.preview.id}@{artifact.preview.version}</span></div>
            <p>{artifact.preview.description}</p>
            <dl>
              <div><dt>Compatibility</dt><dd className={artifact.preview.compatible ? 'ok' : 'bad'}>{artifact.preview.compatibilityMessage}</dd></div>
              <div><dt>Permissions</dt><dd>{artifact.preview.permissions.join(', ') || 'none'}</dd></div>
              <div><dt>Artifact</dt><dd>{fileSize(artifact.preview.bytes)} · SHA-256 {artifact.preview.checksum.slice(0, 12)}…</dd></div>
            </dl>
          </div>
          <div className="artifact-actions">
            <button className="icon-control" aria-label="Close artifact review" disabled={importing} onClick={() => setArtifact(null)}><X size={15} /></button>
            <button className="button primary" disabled={!artifact.preview.compatible || importing} onClick={() => void installArtifact()}><ShieldCheck size={15} />{importing ? 'Installing…' : 'Trust & install'}</button>
          </div>
          <p className="artifact-warning"><AlertTriangle size={13} />Pack handlers are executable code. Trust only a source you have reviewed.</p>
        </section>
      ) : null}
      {error ? <div className="artifact-error" role="alert"><AlertTriangle size={14} />{error}</div> : null}

      <section className="registry-library" aria-label="Signed Pack registries">
        <div className="library-section-heading">
          <div><Globe2 size={16} /><span><strong>Signed Registries</strong><small>Verified publisher catalogs configured for this workspace</small></span></div>
          {registriesLoading ? <span className="registry-loading"><LoaderCircle className="spin" size={13} />Refreshing</span> : null}
        </div>
        {registriesLoading && registries.length === 0 ? (
          <div className="registry-empty"><LoaderCircle className="spin" size={20} /><strong>Verifying registries</strong><p>Checking publisher signatures and catalog expiry.</p></div>
        ) : null}
        {!registriesLoading && registries.length === 0 ? (
          <div className="registry-empty"><KeyRound size={20} /><strong>No trusted Registry configured</strong><p>Add publisher public keys to <code>.graphwork/trust.json</code> to browse signed Packs.</p></div>
        ) : null}
        {registries.map((registry) => (
          <div className={`registry-card ${registry.status}`} key={registry.id}>
            <header>
              <span className="registry-mark"><ShieldCheck size={17} /></span>
              <span><strong>{registry.name}</strong><small>{registry.url}</small></span>
              {registry.status === 'verified'
                ? <em><Check size={11} />Verified · {registry.publisherKeyId}</em>
                : <em className="registry-failed"><AlertTriangle size={11} />Verification failed</em>}
            </header>
            {registry.status === 'error' ? <p className="registry-error">{registry.error}</p> : (
              <>
                <div className="registry-meta"><span>Publisher <strong>{registry.publisherKeyId}</strong></span><span>Valid until <strong>{new Date(registry.expiresAt).toLocaleString()}</strong></span><span>{registry.packs.length} Pack{registry.packs.length === 1 ? '' : 's'}</span></div>
                {registry.packs.length === 0 ? <p className="registry-no-packs">This verified Registry does not publish any Packs yet.</p> : null}
                <div className="registry-pack-list">{registry.packs.map((pack) => {
                  const busyId = `${registry.id}:${pack.id}@${pack.version}`;
                  return (
                    <article className="registry-pack" key={`${pack.id}@${pack.version}`}>
                      <div className="registry-pack-icon"><PackageCheck size={19} /></div>
                      <div><span className="registry-pack-title"><strong>{pack.name}</strong><code>{pack.id}@{pack.version}</code>{pack.active ? <em>Active</em> : pack.installed ? <em>Installed</em> : null}</span><p>{pack.description}</p><small className={pack.compatible ? '' : 'compatibility-error'}>{pack.compatibilityMessage} · {pack.permissions.length ? pack.permissions.join(', ') : 'No permissions'}{pack.license ? ` · ${pack.license}` : ''}</small></div>
                      <button className="button primary" disabled={!pack.compatible || pack.active || busyPackId !== null} onClick={() => onInstallRegistry(registry.id, pack.id, pack.version)}>
                        {busyPackId === busyId ? <LoaderCircle className="spin" size={14} /> : pack.installed ? <Check size={14} /> : <Download size={14} />}
                        {!pack.compatible ? 'Incompatible' : pack.active ? 'In workspace' : pack.installed ? 'Verify & open' : 'Verify & install'}
                      </button>
                    </article>
                  );
                })}</div>
              </>
            )}
          </div>
        ))}
      </section>

      <div className="registry-source"><Box size={15} />Local registry · isolated third-party execution</div>
      <div className="pack-list">
        {catalog.map((pack) => {
          const installed = installedPackIds.includes(pack.id);
          const active = activePackId === pack.id;
          const busy = busyPackId === pack.id;
          return (
            <article className={`pack-row ${active ? 'active' : ''}`} key={pack.id}>
              <div className="pack-icon"><PackageCheck size={22} /></div>
              <div className="pack-copy">
                <div><h2>{pack.name}</h2><span>v{pack.version}</span>{active ? <em><Check size={12} />Active</em> : null}</div>
                <p>{pack.description}</p>
                <dl><div><dt>Graphs</dt><dd>{pack.graphCount}</dd></div><div><dt>Object types</dt><dd>{pack.objectTypeCount}</dd></div><div><dt>Roles</dt><dd>{pack.roleCount}</dd></div><div><dt>Tools</dt><dd>{pack.toolCount}</dd></div><div><dt>Execution</dt><dd>{pack.executionMode === 'isolated-worker' ? 'Isolated worker' : 'Bundled'}</dd></div><div><dt>Trust</dt><dd>{pack.publisherKeyId ?? (pack.trustSource === 'bundled' ? 'Bundled' : 'Explicit local')}</dd></div><div><dt>License</dt><dd>{pack.license}</dd></div></dl>
              </div>
              <div className="pack-actions">
                {!installed ? <button className="button primary" disabled={busy} onClick={() => onInstall(pack.id)}><Download size={15} />Install Pack</button> : null}
                {installed && !active ? <button className="button primary" disabled={busy} onClick={() => onActivate(pack.id)}><Play size={15} />Open Pack</button> : null}
                {installed && !active ? <button className="button ghost danger" disabled={busy || installedPackIds.length === 1} onClick={() => onUninstall(pack.id)}><Trash2 size={15} />Uninstall</button> : null}
                {active ? <button className="button secondary" disabled><Check size={15} />In workspace</button> : null}
              </div>
            </article>
          );
        })}
      </div>
      <div className="registry-note"><strong>Executable Pack boundary</strong><p>Imported artifacts are checked for compatibility and SHA-256 integrity. Third-party handlers run in a memory- and time-bounded child process with a minimal environment and restricted filesystem access. Network isolation still requires an OS or container boundary.</p></div>
    </main>
  );
}
