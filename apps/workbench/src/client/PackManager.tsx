import { useRef, useState } from 'react';
import {
  AlertTriangle, Box, Check, Download, FileArchive, PackageCheck, Play,
  ShieldCheck, Trash2, Upload, X,
} from 'lucide-react';
import type { PackArtifactPreview, PackCatalogItem } from './types.js';

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function PackManager({
  catalog, activePackId, installedPackIds, busyPackId, onInspectArtifact,
  onImportArtifact, onInstall, onActivate, onUninstall,
}: {
  catalog: PackCatalogItem[];
  activePackId: string;
  installedPackIds: string[];
  busyPackId: string | null;
  onInspectArtifact: (file: File) => Promise<PackArtifactPreview>;
  onImportArtifact: (file: File) => Promise<void>;
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
              <div><dt>Compatibility</dt><dd className={artifact.preview.compatible ? 'ok' : 'bad'}>{artifact.preview.compatible ? 'Compatible' : 'Incompatible'} · {artifact.preview.engineRange}</dd></div>
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

      <div className="registry-source"><Box size={15} />Local registry · integrity checked</div>
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
                <dl><div><dt>Graphs</dt><dd>{pack.graphCount}</dd></div><div><dt>Object types</dt><dd>{pack.objectTypeCount}</dd></div><div><dt>Roles</dt><dd>{pack.roleCount}</dd></div><div><dt>Tools</dt><dd>{pack.toolCount}</dd></div><div><dt>License</dt><dd>{pack.license}</dd></div></dl>
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
      <div className="registry-note"><strong>Executable Pack boundary</strong><p>Imported artifacts are checked for compatibility and SHA-256 integrity. Installation runs trusted handlers with the permissions of this local process; use an OS or container boundary for untrusted code.</p></div>
    </main>
  );
}
