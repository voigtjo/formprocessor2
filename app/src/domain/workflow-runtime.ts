import { normalizeDocumentStatus, type DocumentStatus, DOCUMENT_WORKFLOW_ORDER } from './status-model.js';

export type WorkflowStateConfig = {
  buttons: string[];
  editable?: string[];
  readonly?: string[];
};

export type WorkflowHookEffect = {
  operationRef: string;
  apiRef?: string;
  request?: unknown;
  responseMapping?: {
    data?: Record<string, string>;
    external?: Record<string, string>;
    snapshot?: Record<string, string>;
    integration?: Record<string, string>;
    status?: string;
  } & Record<string, unknown>;
  successMessage?: string;
  failureMessage?: string;
  description?: string;
};

export type WorkflowTransitionHook = {
  from?: string[];
  to: string[];
  effects: WorkflowHookEffect[];
};

export type WorkflowEnterStateHook = {
  state: string[];
  effects: WorkflowHookEffect[];
};

export type WorkflowActionHook = {
  action: string[];
  effects: WorkflowHookEffect[];
};

export type WorkflowHooksConfig = {
  onTransition: WorkflowTransitionHook[];
  onEnterState: WorkflowEnterStateHook[];
  onWorkflowAction: WorkflowActionHook[];
};

export type WorkflowRuntimeModel = {
  ref: string;
  name: string;
  order: string[];
  initialStatus: string;
  states: Record<string, WorkflowStateConfig>;
  semantics: Record<string, unknown>;
  actorModel: Record<string, unknown>;
  hooks: WorkflowHooksConfig;
};

export type EditorSubmissionState = {
  userId: string;
  status: 'pending' | 'submitted';
  submittedAt?: Date | null;
};

export type ApproverDecisionState = {
  userId: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt?: Date | null;
};

export type WorkflowEvaluationInput = {
  workflow: WorkflowRuntimeModel;
  status: string;
  editorSubmissions?: EditorSubmissionState[];
  approverDecisions?: ApproverDecisionState[];
};

export type WorkflowEvaluation = {
  normalizedStatus: DocumentStatus;
  visibleButtons: string[];
  allowedActions: string[];
  submitMode: 'global' | 'individual';
  approvalMode: 'global' | 'individual';
  submissionState: 'open' | 'partial' | 'complete';
  approvalState: 'open' | 'partial' | 'complete' | 'rejected';
  nextStatusByAction: Record<string, DocumentStatus>;
  completionMet: boolean;
};

function normalizeUniqueStatuses(values: unknown) {
  if (!Array.isArray(values)) return [...DOCUMENT_WORKFLOW_ORDER, 'archived'];
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeDocumentStatus(value);
    if (!out.includes(normalized)) out.push(normalized);
  }
  if (!out.includes('archived')) out.push('archived');
  return out;
}

function normalizeStatusList(values: unknown) {
  if (Array.isArray(values)) {
    const out: string[] = [];
    for (const value of values) {
      const normalized = normalizeDocumentStatus(value);
      if (!out.includes(normalized)) out.push(normalized);
    }
    return out;
  }
  if (values !== undefined && values !== null && String(values).trim().length > 0) {
    return [normalizeDocumentStatus(values)];
  }
  return [];
}

function normalizeHookEffects(values: unknown): WorkflowHookEffect[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const operationRef = typeof record.operationRef === 'string' ? record.operationRef.trim() : '';
    const apiRef = typeof record.apiRef === 'string' ? record.apiRef.trim() : '';
    const resolvedRef = operationRef || apiRef;
    if (!resolvedRef) return [];
    return [
      {
        operationRef: resolvedRef,
        ...(apiRef ? { apiRef } : {}),
        ...(record.request !== undefined ? { request: record.request } : {}),
        ...(record.responseMapping && typeof record.responseMapping === 'object' && !Array.isArray(record.responseMapping)
          ? { responseMapping: record.responseMapping as WorkflowHookEffect['responseMapping'] }
          : {}),
        ...(typeof record.successMessage === 'string' && record.successMessage.trim().length > 0
          ? { successMessage: record.successMessage.trim() }
          : {}),
        ...(typeof record.failureMessage === 'string' && record.failureMessage.trim().length > 0
          ? { failureMessage: record.failureMessage.trim() }
          : {}),
        ...(typeof record.description === 'string' && record.description.trim().length > 0
          ? { description: record.description.trim() }
          : {})
      }
    ];
  });
}

function normalizeTransitionHooks(values: unknown): WorkflowTransitionHook[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const to = normalizeStatusList(record.to);
    const effects = normalizeHookEffects(record.effects);
    if (to.length === 0 || effects.length === 0) return [];
    const from = normalizeStatusList(record.from);
    return [{ ...(from.length > 0 ? { from } : {}), to, effects }];
  });
}

function normalizeEnterStateHooks(values: unknown): WorkflowEnterStateHook[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const state = normalizeStatusList(record.state);
    const effects = normalizeHookEffects(record.effects);
    if (state.length === 0 || effects.length === 0) return [];
    return [{ state, effects }];
  });
}

function normalizeActionHooks(values: unknown): WorkflowActionHook[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const action = Array.isArray(record.action)
      ? record.action.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : typeof record.action === 'string' && record.action.trim().length > 0
        ? [record.action.trim()]
        : [];
    const effects = normalizeHookEffects(record.effects);
    if (action.length === 0 || effects.length === 0) return [];
    return [{ action: Array.from(new Set(action)), effects }];
  });
}

function normalizeWorkflowHooks(values: unknown): WorkflowHooksConfig {
  const record = values && typeof values === 'object' && !Array.isArray(values) ? (values as Record<string, unknown>) : {};
  return {
    onTransition: normalizeTransitionHooks(record.onTransition),
    onEnterState: normalizeEnterStateHooks(record.onEnterState),
    onWorkflowAction: normalizeActionHooks(record.onWorkflowAction)
  };
}

export function normalizeWorkflowRuntimeModel(raw: {
  ref?: string;
  name?: string;
  order?: unknown;
  initialStatus?: unknown;
  states?: Record<string, unknown>;
  semantics?: Record<string, unknown>;
  actorModel?: Record<string, unknown>;
  hooks?: unknown;
}): WorkflowRuntimeModel {
  const statesRaw = raw.states ?? {};
  const states = Object.entries(statesRaw).reduce(
    (acc, [key, value]) => {
      const normalizedKey = normalizeDocumentStatus(key);
      const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      const buttons = Array.isArray(record.buttons)
        ? record.buttons.filter((item): item is string => typeof item === 'string')
        : [];
      const editable = Array.isArray(record.editable)
        ? record.editable.filter((item): item is string => typeof item === 'string')
        : [];
      const readonly = Array.isArray(record.readonly)
        ? record.readonly.filter((item): item is string => typeof item === 'string')
        : [];
      const existing = acc[normalizedKey] ?? { buttons: [], editable: [], readonly: [] };
      acc[normalizedKey] = {
        buttons: Array.from(new Set([...existing.buttons, ...buttons])),
        editable: Array.from(new Set([...(existing.editable ?? []), ...editable])),
        readonly: Array.from(new Set([...(existing.readonly ?? []), ...readonly]))
      };
      return acc;
    },
    {} as Record<string, WorkflowStateConfig>
  );

  return {
    ref: raw.ref ?? 'workflow',
    name: raw.name ?? 'Workflow',
    order: normalizeUniqueStatuses(raw.order),
    initialStatus: normalizeDocumentStatus(raw.initialStatus ?? 'created'),
    states,
    semantics: raw.semantics ?? {},
    actorModel: raw.actorModel ?? {},
    hooks: normalizeWorkflowHooks(raw.hooks)
  };
}

export function resolveVisibleButtons(input: WorkflowEvaluationInput) {
  const normalizedStatus = normalizeDocumentStatus(input.status);
  const state = input.workflow.states[normalizedStatus];
  return Array.isArray(state?.buttons) ? state.buttons : [];
}

export function resolveSubmissionCompletion(input: WorkflowEvaluationInput) {
  const submitMode = String(input.workflow.semantics?.submit ?? 'global') === 'individual' ? 'individual' : 'global';
  const editorSubmissions = input.editorSubmissions ?? [];
  const submittedCount = editorSubmissions.filter((item) => item.status === 'submitted').length;
  if (editorSubmissions.length === 0) {
    return { submitMode, state: 'open' as const, isComplete: false };
  }
  if (submitMode === 'global') {
    return {
      submitMode,
      state: submittedCount > 0 ? ('complete' as const) : ('open' as const),
      isComplete: submittedCount > 0
    };
  }
  if (submittedCount === 0) return { submitMode, state: 'open' as const, isComplete: false };
  if (submittedCount < editorSubmissions.length) return { submitMode, state: 'partial' as const, isComplete: false };
  return { submitMode, state: 'complete' as const, isComplete: true };
}

export function resolveApprovalCompletion(input: WorkflowEvaluationInput) {
  const approvalMode = String(input.workflow.semantics?.approval ?? 'individual') === 'global' ? 'global' : 'individual';
  const decisions = input.approverDecisions ?? [];
  const approvedCount = decisions.filter((item) => item.status === 'approved').length;
  const rejectedCount = decisions.filter((item) => item.status === 'rejected').length;
  if (rejectedCount > 0) {
    return { approvalMode, state: 'rejected' as const, isComplete: false };
  }
  if (decisions.length === 0) {
    return { approvalMode, state: 'open' as const, isComplete: false };
  }
  if (approvalMode === 'global') {
    return {
      approvalMode,
      state: approvedCount > 0 ? ('complete' as const) : ('open' as const),
      isComplete: approvedCount > 0
    };
  }
  if (approvedCount === 0) return { approvalMode, state: 'open' as const, isComplete: false };
  if (approvedCount < decisions.length) return { approvalMode, state: 'partial' as const, isComplete: false };
  return { approvalMode, state: 'complete' as const, isComplete: true };
}

export function resolveNextStatus(input: WorkflowEvaluationInput) {
  const normalizedStatus = normalizeDocumentStatus(input.status);
  const submission = resolveSubmissionCompletion(input);
  const approval = resolveApprovalCompletion(input);
  const editorSubmissions = input.editorSubmissions ?? [];
  const approverDecisions = input.approverDecisions ?? [];
  const nextStatusByAction: Record<string, DocumentStatus> = {
    assign: 'assigned',
    archive: 'archived',
    // V1 keeps rejected documents in the review stage. There is no separate
    // "returned" status in the fixed system model.
    reject: 'submitted'
  };

  if (normalizedStatus === 'created' || normalizedStatus === 'assigned') {
    if (submission.submitMode === 'global' && editorSubmissions.length === 0) {
      nextStatusByAction.submit = 'submitted';
    } else {
      nextStatusByAction.submit = submission.isComplete ? 'submitted' : 'assigned';
    }
  } else {
    nextStatusByAction.submit = normalizedStatus;
  }
  if (approverDecisions.length === 0) {
    nextStatusByAction.approve = 'approved';
  } else {
    nextStatusByAction.approve = approval.isComplete ? 'approved' : 'submitted';
  }

  return nextStatusByAction;
}

export function evaluateWorkflow(input: WorkflowEvaluationInput): WorkflowEvaluation {
  const normalizedStatus = normalizeDocumentStatus(input.status);
  const visibleButtons = resolveVisibleButtons(input);
  const allowedActions = [...visibleButtons];
  const submission = resolveSubmissionCompletion(input);
  const approval = resolveApprovalCompletion(input);
  const nextStatusByAction = resolveNextStatus(input);
  const completionMet = approval.isComplete;

  return {
    normalizedStatus,
    visibleButtons,
    allowedActions,
    submitMode: submission.submitMode,
    approvalMode: approval.approvalMode,
    submissionState: submission.state,
    approvalState: approval.state,
    nextStatusByAction,
    completionMet
  };
}
