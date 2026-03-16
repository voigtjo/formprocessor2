import { normalizeDocumentStatus, type DocumentStatus, DOCUMENT_WORKFLOW_ORDER } from './status-model.js';

export type WorkflowStateConfig = {
  buttons: string[];
  editable?: string[];
  readonly?: string[];
};

export type WorkflowRuntimeModel = {
  ref: string;
  name: string;
  order: string[];
  initialStatus: string;
  states: Record<string, WorkflowStateConfig>;
  semantics: Record<string, unknown>;
  actorModel: Record<string, unknown>;
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

export function normalizeWorkflowRuntimeModel(raw: {
  ref?: string;
  name?: string;
  order?: unknown;
  initialStatus?: unknown;
  states?: Record<string, unknown>;
  semantics?: Record<string, unknown>;
  actorModel?: Record<string, unknown>;
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
    actorModel: raw.actorModel ?? {}
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
    reject: normalizedStatus === 'approved' ? 'approved' : 'submitted'
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
