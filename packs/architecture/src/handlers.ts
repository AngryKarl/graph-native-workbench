import type { HandlerRegistry } from '@graph-workbench/core';

interface EvidenceItem {
  source: string;
  locator: string;
  claim: string;
}

interface Finding {
  discipline: string;
  statement: string;
  design_impact: string;
  source_indexes: number[];
}

interface Direction {
  id: string;
  name: string;
  thesis: string;
  strategies: string[];
  risks: string[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
}

function asEvidence(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const source = asString(Reflect.get(item, 'source'));
    const locator = asString(Reflect.get(item, 'locator'));
    const claim = asString(Reflect.get(item, 'claim'));
    return source && locator && claim ? [{ source, locator, claim }] : [];
  });
}

function asFindings(value: unknown): Finding[] {
  return Array.isArray(value) ? value as Finding[] : [];
}

function asDirections(value: unknown): Direction[] {
  return Array.isArray(value) ? value as Direction[] : [];
}

function usesChinese(state: Readonly<Record<string, unknown>>): boolean {
  return asString(state.output_language).toLowerCase().startsWith('zh');
}

function bullets(values: readonly string[]): string[] {
  return values.map((value) => `- ${value}`);
}

function findingLines(title: string, findings: readonly Finding[], chinese: boolean): string[] {
  return [
    `## ${title}`,
    '',
    ...findings.flatMap((finding) => [
      `### ${finding.statement}`,
      '',
      `${chinese ? '设计影响' : 'Design impact'}: ${finding.design_impact}`,
      '',
      `${chinese ? '证据' : 'Evidence'}: ${finding.source_indexes.map((index) => `[S${index + 1}]`).join(', ') || (chinese ? '项目输入' : 'project intake')}`,
      '',
    ]),
  ];
}

export const architectureHandlers: HandlerRegistry = {
  'architecture.normalize_brief': ({ state }) => ({
    normalized_brief: {
      project_name: asString(state.project_name),
      project_type: asString(state.project_type),
      site_context: asString(state.site_context),
      goals: asStrings(state.client_goals),
      design_question: usesChinese(state)
        ? `${asString(state.project_name)}如何把场地条件与业主目标转化为清晰、可行且有差异的概念方向？`
        : `How can ${asString(state.project_name)} translate its site conditions and client goals into a distinct, feasible concept direction?`,
    },
  }),

  'architecture.audit_evidence': ({ state }) => {
    const chinese = usesChinese(state);
    const evidence = asEvidence(state.evidence);
    const rawCount = Array.isArray(state.evidence) ? state.evidence.length : 0;
    const constraints = asStrings(state.constraints);
    const gaps = [
      ...(evidence.length < 3 ? [chinese ? '至少需要三条可定位的来源证据。' : 'At least three attributable source claims are required.'] : []),
      ...(evidence.length !== rawCount ? [chinese ? '一条或多条证据缺少来源、定位或事实陈述。' : 'One or more source claims lack a source, locator, or claim.'] : []),
      ...(constraints.length === 0 ? [chinese ? '项目没有提供明确约束。' : 'No explicit project constraint was supplied.'] : []),
    ];
    return {
      evidence_audit: {
        source_count: new Set(evidence.map((item) => item.source)).size,
        claim_count: evidence.length,
        located_claim_count: evidence.filter((item) => item.locator.length > 0).length,
        gaps,
        passed: gaps.length === 0,
      },
    };
  },

  'architecture.site_analysis': ({ state }) => {
    const chinese = usesChinese(state);
    const constraints = asStrings(state.constraints);
    const evidence = asEvidence(state.evidence);
    return {
      site_findings: [
        {
          discipline: 'site_and_urban_context',
          statement: chinese ? `首要空间机会来自这一场地条件：${asString(state.site_context)}` : `The primary spatial opportunity is embedded in this condition: ${asString(state.site_context)}`,
          design_impact: chinese ? '把到达、公共空间连续性和可见入口作为概念生成条件，而不是剩余流线。' : 'Use arrival, public-space continuity, and visible thresholds as generators of the concept rather than residual circulation.',
          source_indexes: evidence.length > 0 ? [0] : [],
        },
        {
          discipline: 'technical_boundary',
          statement: constraints[0] ?? (chinese ? '项目需要明确技术边界。' : 'The project requires an explicit technical-boundary review.'),
          design_impact: chinese ? '首轮概念应保持可逆，并明确哪些几何或工程判断仍需专业复核。' : 'Keep the first concept reversible and state which geometry or engineering claims still require specialist verification.',
          source_indexes: evidence.length > 1 ? [1] : evidence.length > 0 ? [0] : [],
        },
      ] satisfies Finding[],
    };
  },

  'architecture.program_analysis': ({ state }) => {
    const chinese = usesChinese(state);
    const goals = asStrings(state.client_goals);
    const evidence = asEvidence(state.evidence);
    return {
      program_findings: [
        {
          discipline: 'program_and_experience',
          statement: goals[0] ?? (chinese ? '项目需要明确核心使用体验。' : 'The project needs a clear primary user experience.'),
          design_impact: chinese ? '围绕一条清晰的公共体验路径组织概念，并让目的地与空间门槛可见。' : 'Organize the concept around one legible public journey with visible destinations and thresholds.',
          source_indexes: evidence.length > 1 ? [1] : evidence.length > 0 ? [0] : [],
        },
        {
          discipline: 'operations_and_phasing',
          statement: goals[1] ?? goals[0] ?? (chinese ? '运营连续性需要确认。' : 'Operational continuity needs confirmation.'),
          design_impact: chinese ? '划分可独立运营的区域，并形成在整体完成前即可产生价值的分期路径。' : 'Separate operating zones and define a phased path that can create value before the whole project is complete.',
          source_indexes: evidence.length > 2 ? [2] : evidence.length > 0 ? [0] : [],
        },
      ] satisfies Finding[],
    };
  },

  'architecture.develop_directions': ({ state }) => {
    const chinese = usesChinese(state);
    const site = asFindings(state.site_findings);
    const program = asFindings(state.program_findings);
    const constraints = asStrings(state.constraints);
    const projectName = asString(state.project_name) || 'the project';
    return {
      concept_directions: [
        {
          id: 'connection_first',
          name: chinese ? '连接优先' : 'Connection First',
          thesis: chinese ? `${projectName}以到达、移动和公共空间连续性建立清晰的建筑识别。` : `${projectName} becomes legible by turning arrival, movement, and public-space continuity into its primary architectural identity.`,
          strategies: [
            site[0]?.design_impact ?? 'Establish a continuous public route.',
            program[0]?.design_impact ?? 'Anchor the route with visible shared programs.',
            chinese ? '在不同阶段重复使用少量入口、导视和界面元素，保持整体一致。' : 'Use a small number of repeatable threshold, wayfinding, and interface elements across phases.',
          ],
          risks: [constraints[0] ?? (chinese ? '技术界面需要复核' : 'Technical interfaces require verification'), chinese ? '方案价值可能依赖沿路径持续发生的运营活动。' : 'Program value may depend on active operations along the route.'],
        },
        {
          id: 'program_first',
          name: chinese ? '功能锚点优先' : 'Program First',
          thesis: chinese ? `${projectName}通过集中的全时段功能锚点建立身份，并在后续阶段向外扩展。` : `${projectName} builds identity through a concentrated all-day program anchor that can expand through later phases.`,
          strategies: [
            program[1]?.design_impact ?? 'Create an independently operable anchor.',
            chinese ? '把首期投资集中在能形成最清晰使用价值和运营价值的位置。' : 'Concentrate the first investment where it produces the clearest user and operational value.',
            chinese ? '后续空间更新沿用一致的材料、照明和公共空间语言。' : 'Connect later spatial interventions to a shared material, lighting, and public-realm language.',
          ],
          risks: [constraints[1] ?? (chinese ? '运营边界需要确认' : 'Operating boundaries require confirmation'), chinese ? '集中的功能锚点可能使相邻界面在首期保持不变。' : 'A concentrated anchor may leave adjacent interfaces unchanged in the first phase.'],
        },
      ] satisfies Direction[],
    };
  },

  'architecture.evaluate_directions': ({ state }) => {
    const directions = asDirections(state.concept_directions);
    const evidence = asEvidence(state.evidence);
    const goals = asStrings(state.client_goals);
    const constraints = asStrings(state.constraints);
    const scores = directions.map((direction, index) => ({
      direction_id: direction.id,
      goal_fit: Math.min(100, 70 + goals.length * 5 - index * 2),
      evidence_grounding: Math.min(100, 65 + evidence.length * 5),
      feasibility: Math.min(100, 84 - constraints.length * 2 + index * 3),
      distinction: 90,
    })).map((score) => ({
      ...score,
      total: Math.round((score.goal_fit + score.evidence_grounding + score.feasibility + score.distinction) / 4),
    }));
    const recommended = [...scores].sort((left, right) => right.total - left.total)[0]?.direction_id ?? '';
    return { option_evaluation: { scores, recommended_direction_id: recommended } };
  },

  'architecture.quality_gate': ({ state }) => {
    const chinese = usesChinese(state);
    const audit = state.evidence_audit as { passed?: boolean; claim_count?: number } | undefined;
    const directions = asDirections(state.concept_directions);
    const evaluation = state.option_evaluation as { recommended_direction_id?: string } | undefined;
    const distinct = directions.length >= 2 && new Set(directions.map((item) => item.thesis)).size === directions.length;
    if (!audit?.passed) throw new Error(chinese ? '证据覆盖检查未通过，请先解决已报告的证据缺口。' : 'Evidence coverage gate failed. Resolve the reported evidence gaps.');
    if (!distinct || !evaluation?.recommended_direction_id) {
      throw new Error(chinese ? '方向差异检查未通过，请提供至少两个经过评价且明显不同的方向。' : 'Option distinction gate failed. Provide at least two distinct, evaluated directions.');
    }
    return {
      review_status: `passed:${audit.claim_count ?? 0}-claims:${directions.length}-directions`,
    };
  },

  'architecture.publish': ({ state }) => {
    const chinese = usesChinese(state);
    const goals = asStrings(state.client_goals);
    const constraints = asStrings(state.constraints);
    const evidence = asEvidence(state.evidence);
    const site = asFindings(state.site_findings);
    const program = asFindings(state.program_findings);
    const directions = asDirections(state.concept_directions);
    const evaluation = state.option_evaluation as {
      recommended_direction_id?: string;
      scores?: Array<{ direction_id: string; total: number }>;
    };
    const recommended = directions.find((item) => item.id === evaluation.recommended_direction_id);
    return {
      deliverable: [
        chinese ? '# 概念设计简报' : '# Concept design brief',
        '',
        `${chinese ? '项目' : 'Project'}: ${asString(state.project_name)}`,
        `${chinese ? '项目类型' : 'Project type'}: ${asString(state.project_type)}`,
        `${chinese ? '评审' : 'Review'}: ${asString(state.review_status)}; ${chinese ? '人工已批准' : 'human approved'}`,
        '',
        chinese ? '## 项目意图' : '## Project intent',
        '',
        asString(state.site_context),
        '',
        ...bullets(goals),
        '',
        chinese ? '## 设计边界' : '## Design boundaries',
        '',
        ...bullets(constraints),
        '',
        ...findingLines(chinese ? '场地与城市研判' : 'Site and urban findings', site, chinese),
        ...findingLines(chinese ? '功能与运营研判' : 'Program and operation findings', program, chinese),
        chinese ? '## 概念方向' : '## Concept directions',
        '',
        ...directions.flatMap((direction) => [
          `### ${direction.name}${direction.id === recommended?.id ? (chinese ? ' — 建议方向' : ' — recommended') : ''}`,
          '',
          direction.thesis,
          '',
          chinese ? '设计策略：' : 'Strategies:',
          ...bullets(direction.strategies),
          '',
          chinese ? '风险与假设：' : 'Risks and assumptions:',
          ...bullets(direction.risks),
          '',
          `${chinese ? '评价得分' : 'Evaluation score'}: ${evaluation.scores?.find((score) => score.direction_id === direction.id)?.total ?? (chinese ? '未评分' : 'not scored')}`,
          '',
        ]),
        chinese ? '## 建议' : '## Recommendation',
        '',
        recommended
          ? (chinese ? `推进 **${recommended.name}** 进入空间验证，同时保留另一方向作为比选基线。` : `Advance **${recommended.name}** into spatial testing while retaining the other direction as a comparison baseline.`)
          : (chinese ? '尚未形成建议方向。' : 'No direction has been recommended.'),
        '',
        chinese ? '## 来源清单' : '## Source register',
        '',
        ...evidence.map((item, index) => `- [S${index + 1}] ${item.source} — ${item.locator}: ${item.claim}`),
        '',
        chinese ? '## 评审边界' : '## Review boundary',
        '',
        chinese ? '本简报记录前期概念设计推理，不构成规范合规、工程、造价或可建造性审批意见。' : 'This concept brief records early design reasoning. It is not a statutory compliance, engineering, cost, or constructability approval.',
      ].join('\n'),
    };
  },

  'architecture.record_rejection': ({ state }) => ({
    rejection_reason: usesChinese(state)
      ? `设计评审人在质量检查 ${asString(state.review_status)} 后退回了发布。`
      : `The design reviewer rejected publication after quality gate ${asString(state.review_status)}.`,
  }),

  'architecture.summarize_feedback': ({ state }) => ({
    summary: `Feedback recorded: ${JSON.stringify(state.feedback)}`,
  }),
};
