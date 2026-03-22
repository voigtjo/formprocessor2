import { describe, expect, it } from 'vitest';
import {
  evaluateWorkflow,
  normalizeWorkflowRuntimeModel,
  resolveNextStatus,
  type WorkflowRuntimeModel
} from './workflow-runtime.js';
import { resolveWorkflowHookEffects } from './workflow-hooks.js';

function createProductionWorkflow(): WorkflowRuntimeModel {
  return normalizeWorkflowRuntimeModel({
    ref: 'production.standard.v1',
    name: 'Production Standard',
    order: ['created', 'assigned', 'approved', 'archived'],
    initialStatus: 'created',
    states: {
      created: { buttons: ['assign'] },
      assigned: { buttons: ['approve'] },
      approved: { buttons: ['archive'] },
      archived: { buttons: [] }
    },
    semantics: {
      submit: 'global',
      approval: 'global'
    },
    actorModel: {
      editors: 'single',
      approvers: 'multiple'
    }
  });
}

function createEvidenceWorkflow(): WorkflowRuntimeModel {
  return normalizeWorkflowRuntimeModel({
    ref: 'evidence.group-submit.v1',
    name: 'Evidence Group Submit',
    order: ['created', 'assigned', 'submitted', 'approved', 'archived'],
    initialStatus: 'created',
    states: {
      created: { buttons: ['assign'] },
      assigned: { buttons: ['submit'] },
      submitted: { buttons: ['approve'] },
      approved: { buttons: ['archive'] },
      archived: { buttons: [] }
    },
    semantics: {
      submit: 'individual',
      approval: 'individual'
    },
    actorModel: {
      editors: 'multiple',
      approvers: 'multiple'
    }
  });
}

describe('workflow runtime', () => {
  it('keeps evidence workflow assigned until all editors submitted', () => {
    const workflow = createEvidenceWorkflow();

    const partial = evaluateWorkflow({
      workflow,
      status: 'assigned',
      editorSubmissions: [
        { userId: 'u1', status: 'submitted' },
        { userId: 'u2', status: 'pending' }
      ],
      approverDecisions: []
    });

    expect(partial.submitMode).toBe('individual');
    expect(partial.submissionState).toBe('partial');
    expect(partial.nextStatusByAction.submit).toBe('assigned');

    const complete = evaluateWorkflow({
      workflow,
      status: 'assigned',
      editorSubmissions: [
        { userId: 'u1', status: 'submitted' },
        { userId: 'u2', status: 'submitted' }
      ],
      approverDecisions: []
    });

    expect(complete.submissionState).toBe('complete');
    expect(complete.nextStatusByAction.submit).toBe('submitted');
  });

  it('keeps evidence workflow in submitted until all approvers approved', () => {
    const workflow = createEvidenceWorkflow();

    const partial = evaluateWorkflow({
      workflow,
      status: 'submitted',
      editorSubmissions: [
        { userId: 'u1', status: 'submitted' },
        { userId: 'u2', status: 'submitted' }
      ],
      approverDecisions: [
        { userId: 'a1', status: 'approved' },
        { userId: 'a2', status: 'pending' }
      ]
    });

    expect(partial.approvalMode).toBe('individual');
    expect(partial.approvalState).toBe('partial');
    expect(partial.nextStatusByAction.approve).toBe('submitted');

    const complete = evaluateWorkflow({
      workflow,
      status: 'submitted',
      editorSubmissions: [
        { userId: 'u1', status: 'submitted' },
        { userId: 'u2', status: 'submitted' }
      ],
      approverDecisions: [
        { userId: 'a1', status: 'approved' },
        { userId: 'a2', status: 'approved' }
      ]
    });

    expect(complete.approvalState).toBe('complete');
    expect(complete.nextStatusByAction.approve).toBe('approved');
    expect(complete.completionMet).toBe(true);
  });

  it('treats reject as a return to submitted review state in V1', () => {
    const workflow = createEvidenceWorkflow();

    const nextStatus = resolveNextStatus({
      workflow,
      status: 'submitted',
      editorSubmissions: [{ userId: 'u1', status: 'submitted' }],
      approverDecisions: [{ userId: 'a1', status: 'rejected' }]
    });

    expect(nextStatus.reject).toBe('submitted');
  });

  it('keeps production workflow intentionally simple', () => {
    const workflow = createProductionWorkflow();

    const created = evaluateWorkflow({
      workflow,
      status: 'created',
      editorSubmissions: [],
      approverDecisions: []
    });
    expect(created.visibleButtons).toEqual(['assign']);

    const assigned = evaluateWorkflow({
      workflow,
      status: 'assigned',
      editorSubmissions: [],
      approverDecisions: []
    });
    expect(assigned.visibleButtons).toEqual(['approve']);
    expect(assigned.nextStatusByAction.approve).toBe('approved');
  });

  it('normalizes workflow hooks and resolves matching transition hooks', () => {
    const workflow = normalizeWorkflowRuntimeModel({
      order: ['created', 'assigned', 'submitted', 'approved'],
      hooks: {
        onTransition: [
          {
            from: 'submitted',
            to: 'approved',
            effects: [
              {
                operationRef: 'customerOrders.setStatusFromContext',
                apiRef: 'customerOrders.setStatus',
                request: { status: 'approved' }
              }
            ]
          }
        ],
        onWorkflowAction: [
          {
            action: 'approve',
            effects: [{ operationRef: 'notifications.sendApprovalNotice', apiRef: 'notifications.sendApprovalNotice' }]
          }
        ]
      }
    });

    expect(workflow.hooks.onTransition).toHaveLength(1);
    expect(workflow.hooks.onWorkflowAction).toHaveLength(1);

    const transitionEffects = resolveWorkflowHookEffects({
      workflow,
      trigger: {
        type: 'transition',
        fromStatus: 'submitted',
        toStatus: 'approved'
      }
    });
    expect(transitionEffects.map((item) => item.operationRef)).toEqual(['customerOrders.setStatusFromContext']);

    const actionEffects = resolveWorkflowHookEffects({
      workflow,
      trigger: {
        type: 'workflowAction',
        action: 'approve'
      }
    });
    expect(actionEffects.map((item) => item.operationRef)).toEqual(['notifications.sendApprovalNotice']);
  });
});
