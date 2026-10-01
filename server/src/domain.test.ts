import test from 'node:test'; import assert from 'node:assert/strict'; import { approve, approvals, auditEvents, createApproval, parseApprovalDecision, projectSummary, rightsConflicts } from './domain.js';
test('budget summary exposes forecast variance and high risk lines', () => { const summary = projectSummary('PRJ-001'); assert.equal(summary.lines.length, 4); assert.ok(summary.forecast > summary.planned); assert.equal(summary.highRiskLines.length, 1); });
test('rights conflict engine detects overlapping licensed assets', () => { const conflicts = rightsConflicts('PRJ-001'); assert.ok(conflicts.length >= 1); assert.ok(conflicts.some(item => item.reason.includes('音乐-同步许可'))); });
test('approval changes are auditable and stateful', () => { const result = approve('APR-01', 'approved', '预算已复核'); assert.equal(result?.status, 'approved'); assert.equal(result?.comment, '预算已复核'); assert.ok(auditEvents.some(event => event.entityId === 'BUD-001-V3' && event.action === 'APPROVED')); });
test('reject decision records a REJECTED audit event', () => { const result = approve('APR-02', 'rejected', '授权窗口冲突，退回修改'); assert.equal(result?.status, 'rejected'); assert.ok(auditEvents.some(event => event.entityId === 'AST-001' && event.action === 'REJECTED')); });
test('decision parser only accepts the lowercase published enum', () => { assert.equal(parseApprovalDecision('approved'), 'approved'); assert.equal(parseApprovalDecision('rejected'), 'rejected'); for (const invalid of ['', 'in_review', 'APPROVED', 'Approved', 'PENDING', 'pending', undefined, null, 123, { status: 'approved' }]) assert.equal(parseApprovalDecision(invalid), undefined); });
test('illegal decision is rejected before mutating the approval or audit chain', () => {
  const item = createApproval({ projectId: 'PRJ-001', entityType: 'budget', entityId: 'BUD-GUARD', title: '边界校验探针', requestedBy: '测试', approver: '财务负责人' });
  const auditCount = auditEvents.length;
  for (const status of ['in_review', '', 'APPROVED'] as unknown[]) assert.throws(() => approve(item.id, status as 'approved'), /非法审批状态/);
  const stored = approvals.find(approval => approval.id === item.id);
  assert.equal(stored?.status, 'pending', '原审批状态必须保持 pending');
  assert.equal(auditEvents.length, auditCount, '审计链不得写入非法动作');
});
