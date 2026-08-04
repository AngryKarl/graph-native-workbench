import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileText,
  GitBranch,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { decideRun, loadPack, startRun } from './api.js';
import type {
  ContextObjectView,
  EvidenceInput,
  PackDescription,
  ProjectInput,
  RunSnapshot,
  StageId,
} from './types.js';

const stages: Array<{ id: StageId; index: string; label: string }> = [
  { id: 'input', index: '01', label: '项目输入' },
  { id: 'evidence', index: '02', label: '证据与约束' },
  { id: 'analysis', index: '03', label: '场地与功能研判' },
  { id: 'directions', index: '04', label: '概念方向' },
  { id: 'review', index: '05', label: '评审与交付' },
];

const nodeLabels: Record<string, string> = {
  start: '接收输入',
  normalize_brief: '整理任务书',
  audit_evidence: '检查证据',
  site_analysis: '场地研判',
  program_analysis: '功能研判',
  analysis_join: '汇合研判',
  develop_directions: '形成方向',
  evaluate_directions: '比选方向',
  quality_gate: '质量检查',
  approval: '设计评审',
  approval_route: '评审路由',
  publish: '生成简报',
  record_rejection: '记录退回',
};

interface DirectionView {
  id: string;
  name: string;
  thesis: string;
  strategies: string[];
  risks: string[];
}

interface FindingView {
  discipline: string;
  statement: string;
  design_impact: string;
  source_indexes?: number[];
}

interface EvaluationView {
  recommended_direction_id?: string;
  scores?: Array<{
    direction_id: string;
    goal_fit: number;
    evidence_grounding: number;
    feasibility: number;
    distinction: number;
    total: number;
  }>;
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function cloneInput(input: ProjectInput): ProjectInput {
  return structuredClone(input);
}

function statusText(run: RunSnapshot | null): string {
  if (!run) return '尚未运行';
  if (run.status === 'paused') return '质量检查通过 · 等待设计评审';
  if (run.status === 'completed' && run.state.approved === true) return '评审通过 · 简报已生成';
  if (run.status === 'completed') return '评审退回 · 已记录决定';
  if (run.status === 'failed') return '运行失败 · 请检查输入';
  if (run.status === 'cancelled') return '运行已取消';
  return '工作流运行中';
}

function nodeStatus(run: RunSnapshot | null, nodeId: string): 'idle' | 'running' | 'complete' | 'waiting' | 'failed' {
  if (!run) return 'idle';
  const events = run.events.filter((event) => event.nodeId === nodeId);
  if (events.some((event) => event.type === 'node.completed')) return 'complete';
  if (events.some((event) => event.type === 'node.failed')) return 'failed';
  if (events.some((event) => event.type === 'human.requested')) return 'waiting';
  if (events.some((event) => event.type === 'node.started')) return 'running';
  return 'idle';
}

function Logo() {
  return (
    <div className="brand" aria-label="Graph Native Workbench">
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
      <span>Graph Native Workbench</span>
    </div>
  );
}

function StageRail({ active, run, onSelect }: {
  active: StageId;
  run: RunSnapshot | null;
  onSelect: (stage: StageId) => void;
}) {
  const completed = new Set<StageId>();
  if (run) {
    completed.add('input');
    completed.add('evidence');
    if (run.state.site_findings) completed.add('analysis');
    if (run.state.concept_directions) completed.add('directions');
    if (run.status === 'completed') completed.add('review');
  }
  return (
    <nav className="stage-rail" aria-label="项目工作阶段">
      <div className="rail-heading">工作阶段</div>
      <ol>
        {stages.map((stage) => (
          <li key={stage.id}>
            <button
              type="button"
              className={active === stage.id ? 'active' : ''}
              onClick={() => onSelect(stage.id)}
              aria-current={active === stage.id ? 'step' : undefined}
            >
              <span className="stage-index">{completed.has(stage.id) ? <Check size={13} /> : stage.index}</span>
              <span>{stage.label}</span>
              <ChevronRight size={14} className="stage-chevron" />
            </button>
          </li>
        ))}
      </ol>
      <div className="rail-note">
        <GitBranch size={16} />
        <p>执行图记录过程，上下文图保存证据、判断与交付。</p>
      </div>
    </nav>
  );
}

function TraceNode({ id, run }: { id: string; run: RunSnapshot | null }) {
  const status = nodeStatus(run, id);
  return (
    <div className={`trace-node ${status}`} title={id}>
      <span className="trace-status" aria-hidden="true">
        {status === 'complete' ? <Check size={12} /> : status === 'failed' ? <X size={12} /> : <Circle size={9} />}
      </span>
      <span>{nodeLabels[id]}</span>
    </div>
  );
}

function ExecutionTrace({ run }: { run: RunSnapshot | null }) {
  return (
    <section className="trace" aria-labelledby="trace-title">
      <div className="section-heading trace-heading">
        <div>
          <h2 id="trace-title">执行过程</h2>
          <p>Architecture Concept Design · v0.1.0</p>
        </div>
        <span className={`run-status ${run?.status ?? 'idle'}`}>{statusText(run)}</span>
      </div>
      <div className="trace-line" aria-label="工作流执行图">
        <TraceNode id="normalize_brief" run={run} />
        <ArrowRight size={14} className="trace-arrow" />
        <TraceNode id="audit_evidence" run={run} />
        <ArrowRight size={14} className="trace-arrow" />
        <div className="trace-branches">
          <TraceNode id="site_analysis" run={run} />
          <TraceNode id="program_analysis" run={run} />
        </div>
        <ArrowRight size={14} className="trace-arrow" />
        <TraceNode id="develop_directions" run={run} />
        <ArrowRight size={14} className="trace-arrow" />
        <TraceNode id="quality_gate" run={run} />
        <ArrowRight size={14} className="trace-arrow" />
        <TraceNode id="approval" run={run} />
        <ArrowRight size={14} className="trace-arrow" />
        <TraceNode id="publish" run={run} />
      </div>
    </section>
  );
}

function TextListEditor({ label, value, onChange, hint }: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  hint: string;
}) {
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <textarea
        rows={5}
        value={value.join('\n')}
        onChange={(event) => onChange(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))}
      />
      <small>{hint}</small>
    </label>
  );
}

function ProjectInputPanel({ input, onChange }: {
  input: ProjectInput;
  onChange: (input: ProjectInput) => void;
}) {
  return (
    <section className="content-section">
      <div className="section-heading">
        <div>
          <h2>项目输入</h2>
          <p>先提供明确的项目事实；模型与工具适配可以之后加入。</p>
        </div>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>项目名称</span>
          <input value={input.project_name} onChange={(event) => onChange({ ...input, project_name: event.target.value })} />
        </label>
        <label className="field">
          <span>输出语言</span>
          <select value={input.output_language} onChange={(event) => onChange({ ...input, output_language: event.target.value })}>
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
          </select>
        </label>
        <label className="field">
          <span>项目类型</span>
          <select value={input.project_type} onChange={(event) => onChange({ ...input, project_type: event.target.value })}>
            <option value="adaptive_reuse_commercial">既有建筑与商业更新</option>
            <option value="transit_oriented_cultural_commercial">TOD 文化商业</option>
            <option value="commercial">商业建筑</option>
            <option value="cultural_performance">文化演艺</option>
            <option value="general_concept">通用概念设计</option>
          </select>
        </label>
        <label className="field field-full">
          <span>场地与城市背景</span>
          <textarea rows={4} value={input.site_context} onChange={(event) => onChange({ ...input, site_context: event.target.value })} />
          <small>描述区位、到达、现状空间、周边关系和最重要的场地问题。</small>
        </label>
        <TextListEditor label="业主与使用者目标" value={input.client_goals} onChange={(client_goals) => onChange({ ...input, client_goals })} hint="每行一个目标。" />
        <TextListEditor label="约束与待确认边界" value={input.constraints} onChange={(constraints) => onChange({ ...input, constraints })} hint="每行一个约束；不确定内容也应明确写出。" />
      </div>
    </section>
  );
}

function EvidencePanel({ input, onChange }: {
  input: ProjectInput;
  onChange: (input: ProjectInput) => void;
}) {
  const change = (index: number, patch: Partial<EvidenceInput>) => {
    const evidence = input.evidence.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
    onChange({ ...input, evidence });
  };
  return (
    <section className="content-section">
      <div className="section-heading">
        <div>
          <h2>证据与约束</h2>
          <p>每条来源都需要稳定定位，后续结论与交付物会回到这里。</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => onChange({
          ...input,
          evidence: [...input.evidence, { source: '', locator: '', claim: '' }],
        })}><Plus size={15} /> 添加来源</button>
      </div>
      <div className="evidence-table" role="table" aria-label="项目证据">
        <div className="evidence-head" role="row">
          <span>来源</span><span>定位</span><span>支持的事实或判断</span><span aria-label="操作" />
        </div>
        {input.evidence.map((item, index) => (
          <div className="evidence-row" role="row" key={`${index}-${item.source}`}>
            <input aria-label={`来源 ${index + 1}`} value={item.source} onChange={(event) => change(index, { source: event.target.value })} />
            <input aria-label={`定位 ${index + 1}`} value={item.locator} onChange={(event) => change(index, { locator: event.target.value })} />
            <textarea aria-label={`事实 ${index + 1}`} rows={2} value={item.claim} onChange={(event) => change(index, { claim: event.target.value })} />
            <button type="button" className="icon-button" aria-label={`删除来源 ${index + 1}`} onClick={() => onChange({ ...input, evidence: input.evidence.filter((_entry, itemIndex) => itemIndex !== index) })}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function AnalysisPanel({ run }: { run: RunSnapshot | null }) {
  const site = list<FindingView>(run?.state.site_findings);
  const program = list<FindingView>(run?.state.program_findings);
  if (!run) return <EmptyResult title="尚未生成研判" body="填写项目输入和证据后运行工作流。" />;
  return (
    <section className="content-section">
      <div className="section-heading"><div><h2>场地与功能研判</h2><p>结论与设计影响分开表达，并保留来源索引。</p></div></div>
      <div className="analysis-columns">
        <FindingList title="场地与城市" findings={site} />
        <FindingList title="功能与运营" findings={program} />
      </div>
    </section>
  );
}

function FindingList({ title, findings }: { title: string; findings: FindingView[] }) {
  return (
    <div className="finding-list">
      <h3>{title}</h3>
      {findings.map((finding, index) => (
        <article key={`${title}-${index}`}>
          <span className="record-number">{String(index + 1).padStart(2, '0')}</span>
          <div><h4>{finding.statement}</h4><p>{finding.design_impact}</p><small>来源 {finding.source_indexes?.map((item) => `S${item + 1}`).join(' · ') || '项目输入'}</small></div>
        </article>
      ))}
    </div>
  );
}

function DirectionPanel({ run, selected, onSelect, reviewMode = false }: {
  run: RunSnapshot | null;
  selected: number;
  onSelect: (index: number) => void;
  reviewMode?: boolean;
}) {
  const directions = list<DirectionView>(run?.state.concept_directions);
  const evaluation = (run?.state.option_evaluation ?? {}) as EvaluationView;
  if (directions.length === 0) return <EmptyResult title="尚未形成概念方向" body="工作流会在研判完成后形成至少两个可比较方向。" />;
  return (
    <section className={`content-section directions-section ${reviewMode ? 'review-mode' : ''}`}>
      <div className="section-heading">
        <div><h2>{reviewMode ? '方向评审' : '概念方向'}</h2><p>比较目标匹配、证据支撑、可行性与方向差异。</p></div>
      </div>
      <div className="direction-list">
        {directions.map((direction, index) => {
          const score = evaluation.scores?.find((item) => item.direction_id === direction.id);
          const recommended = evaluation.recommended_direction_id === direction.id;
          return (
            <button type="button" className={`direction-row ${selected === index ? 'selected' : ''}`} key={direction.id} onClick={() => onSelect(index)}>
              <span className="direction-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="direction-main">
                <span className="direction-title"><strong>{direction.name === 'Connection First' ? '连接优先' : direction.name === 'Program First' ? '功能锚点优先' : direction.name}</strong>{recommended && <em>建议方向</em>}</span>
                <span className="direction-thesis">{direction.thesis}</span>
                <span className="strategy-list">{direction.strategies.slice(0, 3).map((strategy) => <span key={strategy}>{strategy}</span>)}</span>
              </span>
              <span className="direction-score"><strong>{score?.total ?? '—'}</strong><small>综合分</small></span>
            </button>
          );
        })}
      </div>
      {directions[selected] && (
        <div className="risk-line"><AlertTriangle size={15} /><strong>风险与假设</strong><span>{directions[selected].risks.join('；')}</span></div>
      )}
    </section>
  );
}

function ReviewPanel({ run, selected, onSelect, busy, onDecision }: {
  run: RunSnapshot | null;
  selected: number;
  onSelect: (index: number) => void;
  busy: boolean;
  onDecision: (approved: boolean) => void;
}) {
  if (!run) return <EmptyResult title="尚未进入设计评审" body="运行工作流后，系统会在质量门通过时暂停等待人工决定。" />;
  const deliverable = typeof run.state.deliverable === 'string' ? run.state.deliverable : '';
  return (
    <>
      <DirectionPanel run={run} selected={selected} onSelect={onSelect} reviewMode />
      {run.status === 'paused' && (
        <div className="review-action-bar">
          <div><strong>需要你的设计判断</strong><span>批准后生成简报并写入上下文图；退回会保留完整运行记录。</span></div>
          <div><button type="button" className="secondary-button danger" disabled={busy} onClick={() => onDecision(false)}>退回修改</button><button type="button" className="primary-button" disabled={busy} onClick={() => onDecision(true)}>{busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}批准并生成简报</button></div>
        </div>
      )}
      {deliverable && (
        <section className="deliverable" aria-labelledby="deliverable-title">
          <div className="section-heading"><div><h2 id="deliverable-title">概念设计简报</h2><p>由相同状态、证据和决定装配生成。</p></div><FileText size={20} /></div>
          <div className="markdown"><ReactMarkdown>{deliverable}</ReactMarkdown></div>
        </section>
      )}
      {run.status === 'completed' && run.state.approved === false && (
        <div className="rejected"><X size={18} /><div><strong>设计评审已退回</strong><p>{String(run.state.rejection_reason ?? '')}</p></div></div>
      )}
    </>
  );
}

function EmptyResult({ title, body }: { title: string; body: string }) {
  return <div className="empty-result"><GitBranch size={24} /><h2>{title}</h2><p>{body}</p></div>;
}

function EvidenceInspector({ input, run, selectedDirection }: {
  input: ProjectInput;
  run: RunSnapshot | null;
  selectedDirection: number;
}) {
  const directions = list<DirectionView>(run?.state.concept_directions);
  const findings = [...list<FindingView>(run?.state.site_findings), ...list<FindingView>(run?.state.program_findings)];
  const evidence = input.evidence[Math.min(selectedDirection, Math.max(input.evidence.length - 1, 0))];
  const contextObjects = run?.context?.objects ?? [];
  const count = (type: string) => contextObjects.filter((object) => object.type === type).length;
  return (
    <aside className="inspector">
      <div className="inspector-heading"><h2>证据与决策</h2><p>所选方向的最短追溯链</p></div>
      <div className="provenance-chain">
        <ChainItem number="S1" label="来源" title={evidence ? `${evidence.source} · ${evidence.locator}` : '等待项目来源'} body={evidence?.claim ?? '添加带定位的来源证据。'} />
        <span className="chain-line" />
        <ChainItem number="F1" label="研判" title={findings[selectedDirection]?.statement ?? '等待研判结论'} body={findings[selectedDirection]?.design_impact ?? '运行后显示设计影响。'} />
        <span className="chain-line" />
        <ChainItem number="D1" label="方向" title={directions[selectedDirection]?.name ?? '等待概念方向'} body={directions[selectedDirection]?.thesis ?? '质量门之前不会形成正式方向。'} selected />
        <span className="chain-line" />
        <ChainItem number="A1" label="交付" title={run?.state.deliverable ? '概念设计简报' : '等待人工批准'} body={run?.state.deliverable ? '已写入带运行与节点来源的上下文对象。' : '批准后由相同图状态装配。'} />
      </div>
      {contextObjects.length > 0 && (
        <div className="context-summary">
          <h3>上下文图</h3>
          <dl><div><dt>来源证据</dt><dd>{count('source_evidence')}</dd></div><div><dt>分析发现</dt><dd>{count('analysis_finding')}</dd></div><div><dt>设计方向</dt><dd>{count('design_direction')}</dd></div><div><dt>业务对象</dt><dd>{contextObjects.length}</dd></div></dl>
        </div>
      )}
    </aside>
  );
}

function ChainItem({ number, label, title, body, selected = false }: { number: string; label: string; title: string; body: string; selected?: boolean }) {
  return (
    <article className={`chain-item ${selected ? 'selected' : ''}`}>
      <span className="chain-number">{number}</span><div><small>{label}</small><h3>{title}</h3><p>{body}</p></div>
    </article>
  );
}

function parseApiInput(value: PackDescription['input']): ProjectInput {
  return {
    project_name: String(value.project_name ?? ''),
    project_type: String(value.project_type ?? 'general_concept'),
    output_language: String(value.output_language ?? 'zh-CN'),
    site_context: String(value.site_context ?? ''),
    client_goals: list<string>(value.client_goals),
    constraints: list<string>(value.constraints),
    evidence: list<EvidenceInput>(value.evidence),
  };
}

export function App() {
  const [pack, setPack] = useState<PackDescription | null>(null);
  const [input, setInput] = useState<ProjectInput | null>(null);
  const [run, setRun] = useState<RunSnapshot | null>(null);
  const [activeStage, setActiveStage] = useState<StageId>('input');
  const [selectedDirection, setSelectedDirection] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadPack().then((description) => {
      setPack(description);
      setInput(parseApiInput(description.input));
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const completedNodes = useMemo(
    () => new Set(run?.events.filter((event) => event.type === 'node.completed').map((event) => event.nodeId) ?? []),
    [run],
  );

  const runWorkflow = async () => {
    if (!input) return;
    setBusy(true);
    setError('');
    try {
      const result = await startRun(input);
      setRun(result);
      setActiveStage(result.status === 'paused' ? 'review' : 'analysis');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (approved: boolean) => {
    if (!run) return;
    setBusy(true);
    setError('');
    try {
      setRun(await decideRun(run.runId, approved));
      setActiveStage('review');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    if (!pack) return;
    setInput(cloneInput(parseApiInput(pack.input)));
    setRun(null);
    setActiveStage('input');
    setSelectedDirection(0);
    setError('');
  };

  if (!pack || !input) {
    return <main className="loading-screen"><LoaderCircle className="spin" size={24} /><span>{error || '正在载入 Workbench…'}</span></main>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Logo />
        <div className="project-switcher"><small>当前项目</small><strong>{input.project_name || '未命名项目'}</strong></div>
        <div className="topbar-actions">
          <span className="pack-name">{pack.name}</span>
          <button type="button" className="icon-button" aria-label="恢复示例输入" onClick={reset}><RotateCcw size={16} /></button>
          <button type="button" className="primary-button" disabled={busy} onClick={runWorkflow}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Play size={15} fill="currentColor" />}
            {run ? '重新运行' : '运行工作流'}
          </button>
        </div>
      </header>

      {error && <div className="error-banner" role="alert"><AlertTriangle size={16} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭错误"><X size={15} /></button></div>}

      <div className="workspace">
        <StageRail active={activeStage} run={run} onSelect={setActiveStage} />
        <main className="main-surface">
          <div className="project-heading"><div><h1>{input.project_name || '未命名项目'}</h1><p>{input.site_context}</p></div><span className={`quality-state ${run?.status ?? 'idle'}`}>{statusText(run)}</span></div>
          <ExecutionTrace run={run} />
          {activeStage === 'input' && <ProjectInputPanel input={input} onChange={setInput} />}
          {activeStage === 'evidence' && <EvidencePanel input={input} onChange={setInput} />}
          {activeStage === 'analysis' && <AnalysisPanel run={run} />}
          {activeStage === 'directions' && <DirectionPanel run={run} selected={selectedDirection} onSelect={setSelectedDirection} />}
          {activeStage === 'review' && <ReviewPanel run={run} selected={selectedDirection} onSelect={setSelectedDirection} busy={busy} onDecision={decide} />}
        </main>
        <EvidenceInspector input={input} run={run} selectedDirection={selectedDirection} />
      </div>

      <footer className="statusbar">
        <span><Circle size={7} fill="currentColor" /> 本地运行</span>
        <span>{input.evidence.length} 条来源</span>
        <span>{list(run?.state.concept_directions).length} 个方向</span>
        <span>{run?.status === 'paused' ? '1' : '0'} 个待审批节点</span>
        <span className="status-spacer" />
        <span>{completedNodes.size}/{pack.graph.nodes.length} 节点完成</span>
      </footer>
    </div>
  );
}
