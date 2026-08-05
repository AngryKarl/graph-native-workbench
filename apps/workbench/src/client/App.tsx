import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, Box, Braces, Check, CircleDot, Cpu, GitFork, GitMerge,
  History, LayoutDashboard, LoaderCircle, Network, PackageOpen, Play, RotateCcw,
  Save, Undo2, Redo2, UserRoundCheck,
} from 'lucide-react';
import {
  activatePack, configureModelProvider, decideRun, inspectPackArtifact, installPack, installPackArtifact, installRegistryPack,
  loadRegistries, loadWorkbench, resetGraphDraft,
  saveGraphDraft, startRun, testModelProvider, uninstallPack,
} from './api.js';
import { ContextExplorer } from './ContextExplorer.js';
import { FlowCanvas } from './FlowCanvas.js';
import { createAutomaticLayout, nextNodeId, nodeKindLabel } from './graph-model.js';
import { Inspector } from './Inspector.js';
import { PackManager } from './PackManager.js';
import { ProviderManager } from './ProviderManager.js';
import { RunConsole } from './RunConsole.js';
import { RunHistory } from './RunHistory.js';
import type {
  GraphDefinition, GraphNode, GraphPosition, InspectorTab, PackDescription,
  PrimaryView, RegistrySource, RunSnapshot, WorkbenchBootstrap,
} from './types.js';

interface EditorSnapshot {
  graph: GraphDefinition;
  positions: Record<string, GraphPosition>;
}

type SaveState = 'saved' | 'saving' | 'dirty' | 'invalid';

const palette = [
  { kind: 'trigger', icon: CircleDot, description: 'Entry point' },
  { kind: 'function', icon: Braces, description: 'Deterministic logic' },
  { kind: 'agent', icon: Bot, description: 'Role-bound agent' },
  { kind: 'join', icon: GitMerge, description: 'Synchronize branches' },
  { kind: 'human', icon: UserRoundCheck, description: 'Human gate' },
  { kind: 'router', icon: GitFork, description: 'Conditional route' },
] as const;

const navItems: Array<{ view: PrimaryView; label: string; icon: typeof LayoutDashboard }> = [
  { view: 'editor', label: 'Editor', icon: LayoutDashboard },
  { view: 'runs', label: 'Runs', icon: History },
  { view: 'context', label: 'Context', icon: Network },
  { view: 'models', label: 'Models', icon: Cpu },
  { view: 'packs', label: 'Packs', icon: PackageOpen },
];

function Logo() {
  return <div className="brand-mark" aria-label="Graph Native Workbench"><i /><i /><i /><i /></div>;
}

function sameEditor(left: EditorSnapshot, right: EditorSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function App() {
  const [bootstrap, setBootstrap] = useState<WorkbenchBootstrap | null>(null);
  const [pack, setPack] = useState<PackDescription | null>(null);
  const [editor, setEditor] = useState<EditorSnapshot | null>(null);
  const [past, setPast] = useState<EditorSnapshot[]>([]);
  const [future, setFuture] = useState<EditorSnapshot[]>([]);
  const [input, setInput] = useState<Record<string, unknown>>({});
  const [view, setView] = useState<PrimaryView>('editor');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('node');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [busy, setBusy] = useState(false);
  const [busyPackId, setBusyPackId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [registries, setRegistries] = useState<RegistrySource[]>([]);
  const [registriesLoading, setRegistriesLoading] = useState(false);
  const [modelsBusy, setModelsBusy] = useState(false);
  const initialized = useRef(false);
  const editorRevision = useRef(0);

  const acceptPack = useCallback((nextPack: PackDescription) => {
    const positions = Object.keys(nextPack.positions).length ? nextPack.positions : createAutomaticLayout(nextPack.graph);
    setPack(nextPack);
    setEditor({ graph: nextPack.graph, positions });
    setInput(structuredClone(nextPack.input));
    setSelectedNodeId(nextPack.graph.nodes[0]?.id ?? null);
    setPast([]);
    setFuture([]);
    setSaveState('saved');
    setInspectorOpen(false);
    editorRevision.current += 1;
  }, []);

  const acceptBootstrap = useCallback((next: WorkbenchBootstrap) => {
    setBootstrap(next);
    acceptPack(next.activePack);
    setRun(next.runs.find((item) => item.packId === next.activePackId) ?? null);
  }, [acceptPack]);

  useEffect(() => {
    loadWorkbench().then((next) => {
      acceptBootstrap(next);
      initialized.current = true;
    }).catch((error: Error) => setNotice(error.message));
  }, [acceptBootstrap]);

  const refreshRegistries = useCallback(async () => {
    setRegistriesLoading(true);
    try {
      setRegistries(await loadRegistries());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setRegistriesLoading(false);
    }
  }, []);

  const saveModelProvider = async (selection: Parameters<typeof configureModelProvider>[0]) => {
    setModelsBusy(true);
    try {
      const next = await configureModelProvider(selection);
      setBootstrap(next);
      setNotice(selection.providerId === 'deterministic'
        ? 'Using the built-in zero-key runtime.'
        : `Using ${selection.providerId} for model-enabled Agent nodes.`);
    } finally {
      setModelsBusy(false);
    }
  };

  const checkModelProvider = async () => {
    setModelsBusy(true);
    try {
      return await testModelProvider();
    } finally {
      setModelsBusy(false);
    }
  };

  useEffect(() => {
    if (view === 'packs') void refreshRegistries();
  }, [refreshRegistries, view]);

  const commitEditor = useCallback((graph: GraphDefinition, positions: Record<string, GraphPosition>) => {
    setEditor((current) => {
      if (!current) return { graph, positions };
      const next = { graph, positions };
      if (sameEditor(current, next)) return current;
      editorRevision.current += 1;
      setPast((items) => [...items.slice(-49), current]);
      setFuture([]);
      setSaveState('dirty');
      return next;
    });
  }, []);

  const undo = () => {
    const previous = past.at(-1);
    if (!previous || !editor) return;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [editor, ...items].slice(0, 50));
    setEditor(previous);
    editorRevision.current += 1;
    if (selectedNodeId && !previous.graph.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(previous.graph.nodes[0]?.id ?? null);
      setInspectorOpen(false);
    }
    setSaveState('dirty');
  };
  const redo = () => {
    const next = future[0];
    if (!next || !editor) return;
    setFuture((items) => items.slice(1));
    setPast((items) => [...items, editor].slice(-50));
    setEditor(next);
    editorRevision.current += 1;
    if (selectedNodeId && !next.graph.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(next.graph.nodes[0]?.id ?? null);
      setInspectorOpen(false);
    }
    setSaveState('dirty');
  };

  const persist = useCallback(async (quiet = false) => {
    if (!pack || !editor) return null;
    const revision = editorRevision.current;
    setSaveState('saving');
    try {
      const saved = await saveGraphDraft(pack.id, editor.graph, editor.positions);
      if (revision === editorRevision.current) {
        setSaveState('saved');
        if (!quiet) setNotice('Graph saved and validated.');
        return saved;
      }
      setSaveState('dirty');
      if (!quiet) setNotice('The graph changed while saving. Save the latest revision again.');
      return null;
    } catch (error) {
      setSaveState('invalid');
      if (!quiet) setNotice(error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [editor, pack]);

  useEffect(() => {
    if (!initialized.current || saveState !== 'dirty') return;
    const timer = window.setTimeout(() => { void persist(true); }, 900);
    return () => window.clearTimeout(timer);
  }, [persist, saveState]);

  const selectedNode = useMemo(() => editor?.graph.nodes.find((node) => node.id === selectedNodeId) ?? null, [editor?.graph.nodes, selectedNodeId]);

  const updateNode = (node: GraphNode) => {
    if (!editor) return;
    commitEditor({ ...editor.graph, nodes: editor.graph.nodes.map((item) => item.id === node.id ? node : item) }, editor.positions);
  };

  const addNode = (kind: GraphNode['kind']) => {
    if (!editor) return;
    const id = nextNodeId(editor.graph, kind);
    const maxX = Math.max(0, ...Object.values(editor.positions).map((position) => position.x));
    const node: GraphNode = {
      id,
      kind,
      label: `New ${nodeKindLabel[kind]}`,
      description: 'Configure this node before running the graph.',
      reads: [],
      writes: [],
      config: {},
    };
    commitEditor(
      { ...editor.graph, nodes: [...editor.graph.nodes, node] },
      { ...editor.positions, [id]: { x: maxX + 260, y: 160 + (editor.graph.nodes.length % 4) * 145 } },
    );
    setSelectedNodeId(id);
    setInspectorTab('node');
    setInspectorOpen(true);
  };

  const selectFixture = (fixtureId: string) => {
    const fixture = pack?.fixtures.find((item) => item.id === fixtureId);
    if (fixture) setInput(structuredClone(fixture.input));
  };

  const runGraph = async () => {
    if (!pack || !editor) return;
    setBusy(true);
    try {
      const saved = await persist(true);
      if (!saved) return;
      const next = await startRun(pack.id, editor.graph.id, input);
      setRun(next);
      setBootstrap((current) => current ? { ...current, runs: [next, ...current.runs.filter((item) => item.runId !== next.runId)] } : current);
      setNotice(next.status === 'paused' ? 'Run paused safely for human review.' : `Run ${next.status}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (approved: boolean) => {
    if (!run) return;
    setBusy(true);
    try {
      const next = await decideRun(run.runId, approved);
      setRun(next);
      setBootstrap((current) => current ? { ...current, runs: current.runs.map((item) => item.runId === next.runId ? next : item) } : current);
      setNotice(approved ? 'Run approved, resumed and projected.' : 'Run rejected with its audit trail preserved.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const mutatePack = async (packId: string, action: 'install' | 'activate' | 'uninstall') => {
    setBusyPackId(packId);
    try {
      if (action === 'activate' && packId !== pack?.id && saveState === 'dirty') {
        const saved = await persist(true);
        if (!saved) {
          setNotice('Save the current graph before opening another Pack.');
          return;
        }
      }
      const next = action === 'install' ? await installPack(packId)
        : action === 'activate' ? await activatePack(packId)
          : await uninstallPack(packId);
      acceptBootstrap(next);
      if (action !== 'uninstall') setView('editor');
      setNotice(action === 'install' ? 'Pack installed.' : action === 'activate' ? 'Pack opened.' : 'Pack uninstalled.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyPackId(null);
    }
  };

  const importPackArtifact = async (file: File) => {
    setBusyPackId('__artifact__');
    try {
      const next = await installPackArtifact(file);
      acceptBootstrap(next);
      setView('editor');
      setNotice(`${next.activePack.name} installed and opened.`);
    } finally {
      setBusyPackId(null);
    }
  };

  const installFromRegistry = async (registryId: string, packId: string, version: string) => {
    const busyId = `${registryId}:${packId}@${version}`;
    setBusyPackId(busyId);
    try {
      const next = await installRegistryPack(registryId, packId, version);
      acceptBootstrap(next);
      setView('editor');
      setNotice(`${next.activePack.name} verified, installed and opened.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyPackId(null);
    }
  };

  const resetDraft = async () => {
    if (!pack || !window.confirm('Reset this graph to the Pack definition? Your saved draft will be removed.')) return;
    try {
      const next = await resetGraphDraft(pack.id, pack.graph.id);
      acceptPack(next);
      setNotice('Graph reset to the installed Pack definition.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  if (!bootstrap || !pack || !editor) {
    return <div className="boot-screen"><Logo /><LoaderCircle className="spin" /><span>Opening workbench…</span>{notice ? <p>{notice}</p> : null}</div>;
  }

  return (
    <div className="workbench-shell">
      <aside className="app-nav">
        <Logo />
        <nav>{navItems.map(({ view: itemView, label, icon: Icon }) => <button key={itemView} className={view === itemView ? 'active' : ''} onClick={() => setView(itemView)} title={label}><Icon size={18} /><span>{label}</span></button>)}</nav>
      </aside>

      <header className="topbar">
        <div className="workspace-name"><Box size={16} /><span><small>Local workspace</small><strong>Graph Native</strong></span></div>
        <div className="pack-switcher"><PackageOpen size={15} /><select value={pack.id} disabled={busyPackId !== null} onChange={(event) => { void mutatePack(event.target.value, 'activate'); }}>{bootstrap.catalog.filter((item) => bootstrap.installedPackIds.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></div>
        {view === 'editor' ? <div className="topbar-actions">
          <span className={`save-state state-${saveState}`}>{saveState === 'saving' ? <LoaderCircle className="spin" size={13} /> : saveState === 'saved' ? <Check size={13} /> : <CircleDot size={13} />}{saveState}</span>
          <button className="icon-control" onClick={undo} disabled={!past.length} aria-label="Undo"><Undo2 size={16} /></button>
          <button className="icon-control" onClick={redo} disabled={!future.length} aria-label="Redo"><Redo2 size={16} /></button>
          <button className="icon-control" onClick={() => void resetDraft()} aria-label="Reset graph"><RotateCcw size={16} /></button>
          <button className="button secondary" onClick={() => void persist()}><Save size={15} />Save</button>
          <button className="button primary run-button" disabled={busy || saveState === 'invalid'} onClick={() => void runGraph()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} fill="currentColor" />}Run graph</button>
        </div> : null}
      </header>

      <div className="main-surface">
        {view === 'editor' ? (
          <div className="editor-layout">
            <aside className="node-palette">
              <div className="palette-heading"><strong>Nodes</strong><span>Drag or click to add</span></div>
              <div className="palette-list">{palette.map(({ kind, icon: Icon, description }) => <button key={kind} draggable onClick={() => addNode(kind)} onDragStart={(event) => { event.dataTransfer.setData('application/graph-native-node', kind); event.dataTransfer.effectAllowed = 'copy'; }}><span className={`palette-icon kind-${kind}`}><Icon size={15} /></span><span><strong>{nodeKindLabel[kind]}</strong><small>{description}</small></span></button>)}</div>
              <div className="palette-footer"><GitFork size={15} /><span><strong>{editor.graph.nodes.length} nodes</strong><small>{editor.graph.edges.length} connections</small></span></div>
            </aside>
            <section className="canvas-region">
              <div className="canvas-title"><span><strong>{editor.graph.name}</strong><small>{editor.graph.id} · version {editor.graph.version}</small></span><div><button className="active">Execution</button><button onClick={() => setView('context')}>Context</button></div></div>
              <FlowCanvas graph={editor.graph} positions={editor.positions} run={run} selectedNodeId={selectedNodeId} onSelectNode={(id) => { setSelectedNodeId(id); if (id) { setInspectorTab('node'); setInspectorOpen(true); } }} onChange={commitEditor} />
            </section>
            <Inspector tab={inspectorTab} onTab={setInspectorTab} node={selectedNode} pack={pack} input={input} open={inspectorOpen} onToggle={() => setInspectorOpen((value) => !value)} onInput={setInput} onUpdateNode={updateNode} onSelectFixture={selectFixture} />
            <RunConsole run={run} busy={busy} onDecision={(approved) => void decide(approved)} />
          </div>
        ) : null}
        {view === 'runs' ? <RunHistory runs={bootstrap.runs} selectedRunId={run?.runId} onSelect={(selected) => { setRun(selected); setView('editor'); }} /> : null}
        {view === 'context' ? <ContextExplorer runs={bootstrap.runs} /> : null}
        {view === 'models' ? <ProviderManager state={bootstrap.models} busy={modelsBusy} onSave={saveModelProvider} onTest={checkModelProvider} /> : null}
        {view === 'packs' ? <PackManager catalog={bootstrap.catalog} registries={registries} registriesLoading={registriesLoading} activePackId={bootstrap.activePackId} installedPackIds={bootstrap.installedPackIds} busyPackId={busyPackId} onInspectArtifact={inspectPackArtifact} onImportArtifact={importPackArtifact} onInstallRegistry={(registryId, packId, version) => void installFromRegistry(registryId, packId, version)} onInstall={(id) => void mutatePack(id, 'install')} onActivate={(id) => void mutatePack(id, 'activate')} onUninstall={(id) => void mutatePack(id, 'uninstall')} /> : null}
      </div>

      {notice ? <button className="toast" onClick={() => setNotice('')}>{notice}<span>Dismiss</span></button> : null}
    </div>
  );
}
