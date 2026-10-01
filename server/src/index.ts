import express from 'express';
import { pathToFileURL } from 'node:url';
import { approve, assets, budgetLines, contracts, createApproval, dashboard, parseApprovalDecision, projectSummary, projects, rightsConflicts } from './domain.js';
export const app = express(); app.use(express.json());
app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/projects', (_req, res) => res.json(projects));
app.get('/api/projects/:id/summary', (req, res) => { const result = projectSummary(req.params.id); if (!result.project) return res.status(404).json({ message: '项目不存在' }); res.json(result); });
app.get('/api/projects/:id/rights-conflicts', (req, res) => res.json(rightsConflicts(req.params.id)));
app.get('/api/projects/:id/assets', (req, res) => res.json(assets.filter(asset => asset.projectId === req.params.id)));
app.get('/api/projects/:id/contracts', (req, res) => res.json(contracts.filter(contract => contract.projectId === req.params.id)));
app.get('/api/budgets/:projectId/lines', (req, res) => res.json(budgetLines.filter(line => line.projectId === req.params.projectId)));
app.post('/api/approvals', (req, res) => res.status(201).json(createApproval(req.body)));
app.patch('/api/approvals/:id', (req, res) => {
  const body = (req.body ?? {}) as { status?: unknown; comment?: unknown };
  const decision = parseApprovalDecision(body.status);
  // 边界校验：非法状态（空值、未知枚举、大小写变体、非字符串）在进入领域数据前一律拒绝，原审批与审计链保持不变
  if (!decision) return res.status(400).json({ code: 'invalid_approval_status', message: `不支持的审批状态：${body.status === undefined ? '缺失' : String(body.status)}（仅允许 approved 或 rejected）` });
  const comment = typeof body.comment === 'string' ? body.comment : '';
  const result = approve(req.params.id, decision, comment);
  if (!result) return res.status(404).json({ code: 'approval_not_found', message: '审批不存在' });
  res.json(result);
});
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'film-rights-platform' }));
// 统一客户端错误格式：畸形 JSON 请求体也返回与校验错误一致的结构，而不是默认 HTML 错误页
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => { if (res.headersSent || !err) return next(err); if (err instanceof SyntaxError && (err as { type?: string }).type === 'entity.parse.failed') return res.status(400).json({ code: 'invalid_json', message: '请求体不是合法的 JSON' }); return res.status(400).json({ code: 'bad_request', message: '请求参数不合法' }); });
// 仅在作为入口直接运行时监听端口；被测试模块导入时只暴露 app
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4104); app.listen(port, () => console.log(`film rights API listening on ${port}`));
}
