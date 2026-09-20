export type AssessmentVerdict = 'correct' | 'incorrect' | 'unknown' | 'unanswered';
export type OriginalLearningStatus =
  | 'in_progress'
  | 'incomplete'
  | 'unknown'
  | 'completed_with_help'
  | 'completed_without_recorded_help';

export interface AssessmentNextActionAttempt {
  assistanceRequested?: boolean;
  execution: AssessmentVerdict;
  helpExposed?: boolean;
  independentTaskPass: boolean;
  invalidated?: boolean;
  phase?: string;
  planning: AssessmentVerdict;
  relation?: 'near_duplicate' | 'near_transfer';
}

export type AssessmentNextActionKind =
  | 'finish_original'
  | 'start'
  | 'resume'
  | 'remediate_method'
  | 'remediate_execution'
  | 'evidence_boundary'
  | 'reassess';

export interface AssessmentNextAction {
  description: string;
  eyebrow: string;
  href: string;
  kind: AssessmentNextActionKind;
  label: string;
  title: string;
}

function studyHref(sessionId: string, remediation?: 'method' | 'execution' | 'evidence') {
  const query = new URLSearchParams({ session: sessionId });
  if (remediation) query.set('remediate', remediation);
  return `/study?${query.toString()}`;
}

function originalAction(
  sessionId: string,
  originalStatus: OriginalLearningStatus,
): AssessmentNextAction {
  if (originalStatus === 'incomplete') {
    return {
      description: '当前结论还有需要修正的地方。先回到原题，只处理这一个错误，再决定是否进入新题检验。',
      eyebrow: 'NEXT / 修正原题',
      href: studyHref(sessionId),
      kind: 'finish_original',
      label: '回原题修正结论',
      title: '先把原题结论修正清楚',
    };
  }

  if (originalStatus === 'unknown') {
    return {
      description: '现有步骤还不足以核对结论。先补上关键依据，不把“写完”当成“已经会了”。',
      eyebrow: 'NEXT / 补齐依据',
      href: studyHref(sessionId),
      kind: 'finish_original',
      label: '回原题补齐依据',
      title: '先补上能核对结论的关键一步',
    };
  }

  return {
    description: '先完成原题的关键判断并提交核对；新题检验会在原题形成可核验证据后开放。',
    eyebrow: 'NEXT / 完成原题',
    href: studyHref(sessionId),
    kind: 'finish_original',
    label: '继续完成原题',
    title: '先把这道原题做完整',
  };
}

export function getAssessmentNextAction(
  sessionId: string,
  originalStatus: OriginalLearningStatus,
  attempt: AssessmentNextActionAttempt | null,
): AssessmentNextAction {
  if (!attempt) {
    if (
      originalStatus !== 'completed_with_help'
      && originalStatus !== 'completed_without_recorded_help'
    ) {
      return originalAction(sessionId, originalStatus);
    }

    return {
      description: '原题记录会保留不动。换一道不同的新题，先锁定计划，再独立完成答案。',
      eyebrow: 'NEXT / 建立独立证据',
      href: `/learn/${sessionId}/check`,
      kind: 'start',
      label: '去做一次不同新题检验',
      title: '下一步不是重做原题，而是换题独立完成',
    };
  }

  if (attempt.phase && attempt.phase !== 'summary') {
    const helpRequested = attempt.phase === 'help_requested';
    const grading = attempt.phase === 'grading';
    return {
      description: helpRequested
        ? '本次已经请求帮助，独立资格不会恢复；回到检验页查看保存状态和后续入口。'
        : grading
          ? '首次计划与答案已经冻结，回到检验页继续读取结果，不会重复提交。'
          : '首次计划和当前答案都已保留，继续当前阶段，不重新创建另一道题。',
      eyebrow: helpRequested ? 'NEXT / 查看求助状态' : 'NEXT / 继续当前检验',
      href: `/learn/${sessionId}/check`,
      kind: 'resume',
      label: helpRequested ? '查看本次检验状态' : '继续当前独立检验',
      title: helpRequested
        ? '这次独立检验已经结束，先确认保存状态'
        : grading
          ? '结果正在核对，继续查看这次检验'
          : '把当前检验做完，不重新开题',
    };
  }

  if (attempt.planning !== 'correct') {
    return {
      description: '先不急着重算整题。回到原题，把为什么选这个方法、第一步准备做什么说清楚。',
      eyebrow: 'NEXT / 方法修正',
      href: studyHref(sessionId, 'method'),
      kind: 'remediate_method',
      label: '回学习页梳理方法',
      title: '先补方法依据，再做下一道题',
    };
  }

  if (attempt.execution !== 'correct') {
    return {
      description: '方法方向已经成立。回到学习页，只定位计算、变形或表达中需要修正的一步。',
      eyebrow: 'NEXT / 执行修正',
      href: studyHref(sessionId, 'execution'),
      kind: 'remediate_execution',
      label: '回学习页处理执行卡点',
      title: '方法不用推倒重来，只修执行卡点',
    };
  }

  if (!attempt.independentTaskPass) {
    const description = attempt.relation === 'near_duplicate'
      ? '这次题目与已见任务过近，只保留为练习记录，不能作为迁移证据。'
      : attempt.invalidated
        ? '相关学习证据已经修订，旧结果不能继续作为独立通过依据。'
        : attempt.assistanceRequested || attempt.helpExposed
          ? '这次请求或看过帮助；答案即使正确，也不能改写为独立完成。'
          : '计划和执行有依据，但独立资格条件没有同时成立，先看清原因再决定是否重测。';
    return {
      description,
      eyebrow: 'NEXT / 证据边界',
      href: studyHref(sessionId, 'evidence'),
      kind: 'evidence_boundary',
      label: '查看证据边界',
      title: '答案正确不等于这次可以记为独立通过',
    };
  }

  return {
    description: '这次不同新题的计划和执行都形成了近迁移证据；长期保持尚未验证，结论只限于本次表现。',
    eyebrow: 'NEXT / 保持待验证',
    href: `/learn/${sessionId}/check?intent=reassess`,
    kind: 'reassess',
    label: '再测一道不同新题',
    title: '本次近迁移成立，下一步看能否稳定保持',
  };
}
