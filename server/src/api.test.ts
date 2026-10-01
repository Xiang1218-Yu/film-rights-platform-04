import assert from 'node:assert/strict';
import test from 'node:test';
import type { Server } from 'node:http';
import { after, before } from 'node:test';
import { app } from './index.js';
import { approvals, auditEvents, projectSummary } from './domain.js';

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('测试服务器未正常启动');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });

async function patchApproval(id: string, body: string | undefined, contentType = 'application/json') {
  return fetch(`${baseUrl}/api/approvals/${id}`, {
    method: 'PATCH',
    headers: contentType ? { 'Content-Type': contentType } : {},
    body,
  });
}

async function createPendingApproval(suffix: string) {
  const response = await fetch(`${baseUrl}/api/approvals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'PRJ-001', entityType: 'budget', entityId: `BUD-${suffix}`, title: `边界用例 ${suffix}`, requestedBy: '测试发起方', approver: '财务负责人' }),
  });
  assert.equal(response.status, 201);
  return (await response.json()) as { id: string };
}

function snapshot(id: string) {
  const summary = projectSummary('PRJ-001');
  return {
    status: approvals.find(item => item.id === id)?.status,
    pendingCount: summary.pendingApprovals,
    auditCount: auditEvents.length,
  };
}

test('未公开状态 in_review 返回 400，审批与审计链均不变', async () => {
  const { id } = await createPendingApproval('in-review');
  const beforeSnap = snapshot(id);
  const response = await patchApproval(id, JSON.stringify({ status: 'in_review' }));
  assert.equal(response.status, 400);
  const error = await response.json() as { code?: string; message?: string };
  assert.equal(error.code, 'invalid_approval_status');
  assert.ok(error.message?.includes('in_review'));
  const afterSnap = snapshot(id);
  assert.deepEqual(afterSnap, beforeSnap);
  assert.equal(afterSnap.status, 'pending', '该审批仍须计入待办队列');
  assert.ok(!auditEvents.some(event => event.entityId === `BUD-in-review`), '审计链不得出现 IN_REVIEW 动作');
});

test('空状态返回 400 且不写入任何数据', async () => {
  const { id } = await createPendingApproval('empty');
  const beforeSnap = snapshot(id);
  const response = await patchApproval(id, JSON.stringify({ status: '' }));
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { code?: string }).code, 'invalid_approval_status');
  assert.deepEqual(snapshot(id), beforeSnap);
});

test('大小写变体 APPROVED / Rejected 返回 400，仅接受小写枚举', async () => {
  const a = await createPendingApproval('upper');
  const b = await createPendingApproval('mixed');
  for (const [id, status] of [[a.id, 'APPROVED'], [b.id, 'Rejected']] as const) {
    const response = await patchApproval(id, JSON.stringify({ status }));
    assert.equal(response.status, 400, `${status} 必须被拒绝`);
    assert.equal(approvals.find(item => item.id === id)?.status, 'pending');
  }
});

test('缺失请求体返回 400，且不会像旧实现那样污染审批状态或抛 500', async () => {
  const { id } = await createPendingApproval('no-body');
  const response = await patchApproval(id, undefined);
  assert.equal(response.status, 400);
  const error = await response.json() as { code?: string };
  assert.equal(error.code, 'invalid_approval_status');
  assert.equal(approvals.find(item => item.id === id)?.status, 'pending');
});

test('缺失 status 字段或类型错误返回 400', async () => {
  const { id } = await createPendingApproval('bad-shape');
  const auditCount = auditEvents.length;
  const missingField = await patchApproval(id, JSON.stringify({ comment: '只有意见' }));
  assert.equal(missingField.status, 400);
  const nonString = await patchApproval(id, JSON.stringify({ status: 123 }));
  assert.equal(nonString.status, 400);
  const nullStatus = await patchApproval(id, JSON.stringify({ status: null }));
  assert.equal(nullStatus.status, 400);
  assert.equal(approvals.find(item => item.id === id)?.status, 'pending');
  assert.equal(auditEvents.length, auditCount, '连续非法请求均不得写入审计事件');
});

test('畸形 JSON 请求体返回结构一致的 400 客户端错误', async () => {
  const response = await patchApproval('APR-01', '{not valid json');
  assert.equal(response.status, 400);
  const error = await response.json() as { code?: string };
  assert.equal(error.code, 'invalid_json');
  assert.equal(approvals.find(item => item.id === 'APR-01')?.status, 'pending', '已有数据不受影响');
});

test('合法的通过请求返回 200，审批离开待办并写入 APPROVED 审计', async () => {
  const { id } = await createPendingApproval('approve');
  const pendingBefore = projectSummary('PRJ-001').pendingApprovals;
  const response = await patchApproval(id, JSON.stringify({ status: 'approved', comment: '在控制台完成复核' }));
  assert.equal(response.status, 200);
  const body = await response.json() as { id: string; status: string; comment: string };
  assert.equal(body.id, id);
  assert.equal(body.status, 'approved');
  assert.equal(body.comment, '在控制台完成复核');
  assert.equal(projectSummary('PRJ-001').pendingApprovals, pendingBefore - 1, '通过后待办数减一');
  const audit = auditEvents.find(event => event.entityId === 'BUD-approve');
  assert.equal(audit?.action, 'APPROVED');
  assert.equal(audit?.details, '在控制台完成复核');
});

test('合法的驳回请求返回 200 并写入 REJECTED 审计', async () => {
  const { id } = await createPendingApproval('reject');
  const response = await patchApproval(id, JSON.stringify({ status: 'rejected', comment: '授权窗口冲突，退回' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, 'rejected');
  const audit = auditEvents.find(event => event.entityId === 'BUD-reject');
  assert.equal(audit?.action, 'REJECTED');
});

test('合法操作后查询与刷新流程仍返回完整审批视图', async () => {
  const response = await fetch(`${baseUrl}/api/projects/PRJ-001/summary`);
  assert.equal(response.status, 200);
  const summary = await response.json() as { pendingApprovals: number; approvals: { id: string; status: string }[] };
  assert.ok(Array.isArray(summary.approvals));
  assert.equal(summary.pendingApprovals, summary.approvals.filter(item => item.status === 'pending').length,
    '待办计数与列表状态保持一致，前端队列刷新不会错乱');
  const dashboard = await (await fetch(`${baseUrl}/api/dashboard`)).json() as { id: string; pendingApprovals: number }[];
  const projectDashboard = dashboard.find(item => item.id === 'PRJ-001');
  assert.equal(projectDashboard?.pendingApprovals, summary.pendingApprovals);
});

test('不存在的审批 ID 返回 404，且不产生审计事件', async () => {
  const auditCount = auditEvents.length;
  const response = await patchApproval('APR-NOPE', JSON.stringify({ status: 'approved' }));
  assert.equal(response.status, 404);
  assert.equal((await response.json() as { code?: string }).code, 'approval_not_found');
  assert.equal(auditEvents.length, auditCount);
});
