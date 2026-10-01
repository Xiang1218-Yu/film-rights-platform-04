import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { app } from './app.js';
import { approvals, auditEvents, createApproval } from './domain.js';

const server = app.listen(0);
const { port } = (server.address() as AddressInfo);
const base = `http://127.0.0.1:${port}/api`;
test.after(() => server.close());

const tick = () => new Promise(resolve => setTimeout(resolve, 2));
const patchStatus = (id: string, payload?: unknown) => fetch(`${base}/approvals/${id}`, {
  method: 'PATCH',
  headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: payload === undefined ? undefined : JSON.stringify(payload)
});
const summary = async (projectId: string) => (await (await fetch(`${base}/projects/${projectId}/summary`)).json()) as { pendingApprovals: number };
const newApproval = (title: string) => createApproval({ projectId: 'PRJ-001', entityType: 'asset', entityId: 'AST-001', title, requestedBy: '测试申请人', approver: '测试审批人' });

test('rejects unpublished status before it reaches domain data', async () => {
  const item = newApproval('非法状态用例');
  const auditsBefore = auditEvents.length;
  const response = await patchStatus(item.id, { status: 'in_review', comment: '尝试写入未公开状态' });
  assert.equal(response.status, 400);
  const body = await response.json() as { message?: string };
  assert.equal(typeof body.message, 'string');
  const stored = approvals.find(approval => approval.id === item.id);
  assert.equal(stored?.status, 'pending');
  assert.equal(stored?.comment, undefined);
  assert.equal(auditEvents.length, auditsBefore);
});

test('rejects empty status', async () => {
  const response = await patchStatus('APR-01', { status: '' });
  assert.equal(response.status, 400);
  assert.equal(approvals.find(approval => approval.id === 'APR-01')?.status, 'pending');
});

test('rejects case variants of known statuses', async () => {
  for (const status of ['Approved', 'APPROVED', 'Rejected', 'PENDING']) {
    const response = await patchStatus('APR-01', { status });
    assert.equal(response.status, 400, `status "${status}" should be rejected`);
  }
  assert.equal(approvals.find(approval => approval.id === 'APR-01')?.status, 'pending');
});

test('rejects missing request body', async () => {
  const response = await patchStatus('APR-01');
  assert.equal(response.status, 400);
  const body = await response.json() as { message?: string };
  assert.equal(typeof body.message, 'string');
  assert.equal(approvals.find(approval => approval.id === 'APR-01')?.status, 'pending');
});

test('accepts legitimate approve and reject decisions and writes audit events', async () => {
  const approveTarget = newApproval('合法通过用例');
  await tick();
  const auditsBefore = auditEvents.length;
  const approved = await patchStatus(approveTarget.id, { status: 'approved', comment: '复核通过' });
  assert.equal(approved.status, 200);
  const approvedBody = await approved.json() as { status: string; comment: string };
  assert.equal(approvedBody.status, 'approved');
  assert.equal(approvedBody.comment, '复核通过');
  assert.equal(auditEvents.length, auditsBefore + 1);
  assert.equal(auditEvents[0].action, 'APPROVED');
  assert.equal(auditEvents[0].entityId, approveTarget.entityId);

  const rejectTarget = newApproval('合法驳回用例');
  await tick();
  const rejected = await patchStatus(rejectTarget.id, { status: 'rejected' });
  assert.equal(rejected.status, 200);
  assert.equal((await rejected.json() as { status: string }).status, 'rejected');
  assert.equal(auditEvents[0].action, 'REJECTED');
});

test('unknown approval id still returns 404', async () => {
  const response = await patchStatus('APR-404', { status: 'approved' });
  assert.equal(response.status, 404);
  assert.equal((await response.json() as { message: string }).message, '审批不存在');
});

test('summary and refresh flow stay consistent across invalid and valid updates', async () => {
  const before = await summary('PRJ-001');
  const item = newApproval('队列一致性用例');
  const withPending = await summary('PRJ-001');
  assert.equal(withPending.pendingApprovals, before.pendingApprovals + 1);
  const invalid = await patchStatus(item.id, { status: 'in_review' });
  assert.equal(invalid.status, 400);
  const afterInvalid = await summary('PRJ-001');
  assert.equal(afterInvalid.pendingApprovals, withPending.pendingApprovals);
  const decided = await patchStatus(item.id, { status: 'approved' });
  assert.equal(decided.status, 200);
  const afterDecision = await summary('PRJ-001');
  assert.equal(afterDecision.pendingApprovals, withPending.pendingApprovals - 1);
});
