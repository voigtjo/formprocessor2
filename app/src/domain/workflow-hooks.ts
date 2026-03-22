import { executeActionDefinition, type ActionContext } from '../actions/index.js';
import { normalizeDocumentStatus } from './status-model.js';
import type {
  WorkflowEnterStateHook,
  WorkflowHookEffect,
  WorkflowRuntimeModel,
  WorkflowTransitionHook
} from './workflow-runtime.js';

export type WorkflowHookTrigger =
  | {
      type: 'transition';
      fromStatus: string;
      toStatus: string;
    }
  | {
      type: 'enterState';
      state: string;
    }
  | {
      type: 'workflowAction';
      action: string;
    };

export type WorkflowHookExecutionLog = {
  trigger: WorkflowHookTrigger['type'];
  operationRef: string;
  success: boolean;
  description?: string;
  message?: string;
  error?: string;
};

export type WorkflowHookExecutionResult = {
  dataJson: Record<string, unknown>;
  externalRefsJson: Record<string, unknown>;
  snapshotsJson: Record<string, unknown>;
  integrationContextJson: Record<string, unknown>;
  logs: WorkflowHookExecutionLog[];
};

function matchesTransitionHook(hook: WorkflowTransitionHook, fromStatus: string, toStatus: string) {
  const normalizedFrom = normalizeDocumentStatus(fromStatus);
  const normalizedTo = normalizeDocumentStatus(toStatus);
  const fromMatches = !hook.from || hook.from.length === 0 || hook.from.includes(normalizedFrom);
  return fromMatches && hook.to.includes(normalizedTo);
}

function matchesEnterStateHook(hook: WorkflowEnterStateHook, state: string) {
  return hook.state.includes(normalizeDocumentStatus(state));
}

function matchesActionHook(hook: { action: string[] }, action: string) {
  return hook.action.includes(String(action ?? '').trim());
}

export function resolveWorkflowHookEffects(params: {
  workflow: WorkflowRuntimeModel;
  trigger: WorkflowHookTrigger;
}): WorkflowHookEffect[] {
  const { workflow, trigger } = params;
  if (trigger.type === 'transition') {
    return workflow.hooks.onTransition
      .filter((hook) => matchesTransitionHook(hook, trigger.fromStatus, trigger.toStatus))
      .flatMap((hook) => hook.effects);
  }
  if (trigger.type === 'enterState') {
    return workflow.hooks.onEnterState
      .filter((hook) => matchesEnterStateHook(hook, trigger.state))
      .flatMap((hook) => hook.effects);
  }
  return workflow.hooks.onWorkflowAction
    .filter((hook) => matchesActionHook(hook, trigger.action))
    .flatMap((hook) => hook.effects);
}

export async function executeWorkflowHookEffects(params: {
  workflow: WorkflowRuntimeModel;
  trigger: WorkflowHookTrigger;
  context: ActionContext;
  erpBaseUrl: string;
  fetchImpl?: typeof fetch;
}) : Promise<WorkflowHookExecutionResult> {
  const effects = resolveWorkflowHookEffects({
    workflow: params.workflow,
    trigger: params.trigger
  });

  const nextContext: ActionContext = {
    doc: { ...params.context.doc },
    data: { ...params.context.data },
    external: { ...params.context.external },
    snapshot: { ...params.context.snapshot },
    integration: { ...params.context.integration },
    vars: { ...params.context.vars }
  };
  const lockedDocumentStatus = normalizeDocumentStatus(params.context.doc.status);
  const logs: WorkflowHookExecutionLog[] = [];

  for (const effect of effects) {
    try {
      const result = await executeActionDefinition({
        actionDef: {
          type: 'api',
          operationRef: effect.operationRef,
          ...(effect.apiRef ? { apiRef: effect.apiRef } : {}),
          ...(effect.request !== undefined ? { requestMapping: effect.request } : {}),
          ...(effect.responseMapping ? { responseMapping: effect.responseMapping } : {}),
          ...(effect.successMessage ? { successMessage: effect.successMessage } : {}),
          ...(effect.failureMessage ? { failureMessage: effect.failureMessage } : {})
        },
        context: nextContext,
        erpBaseUrl: params.erpBaseUrl,
        fetchImpl: params.fetchImpl
      });

      nextContext.doc.status = lockedDocumentStatus;
      nextContext.data = { ...result.dataJson };
      nextContext.external = { ...result.externalRefsJson };
      nextContext.snapshot = { ...result.snapshotsJson };
      nextContext.integration = { ...result.integrationContextJson };

      logs.push({
        trigger: params.trigger.type,
        operationRef: effect.operationRef,
        success: true,
        ...(effect.description ? { description: effect.description } : {}),
        ...(result.message ? { message: result.message } : {})
      });
    } catch (error) {
      console.warn('[fp] workflow hook failed', {
        trigger: params.trigger,
        documentId: params.context.doc.id,
        operationRef: effect.operationRef,
        error: error instanceof Error ? error.message : 'Workflow hook execution failed.'
      });
      logs.push({
        trigger: params.trigger.type,
        operationRef: effect.operationRef,
        success: false,
        ...(effect.description ? { description: effect.description } : {}),
        error: error instanceof Error ? error.message : 'Workflow hook execution failed.'
      });
    }
  }

  return {
    dataJson: nextContext.data,
    externalRefsJson: nextContext.external,
    snapshotsJson: nextContext.snapshot,
    integrationContextJson: nextContext.integration,
    logs
  };
}
