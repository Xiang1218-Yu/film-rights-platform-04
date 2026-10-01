import express from 'express';
import { approve, assets, budgetLines, contracts, createApproval, dashboard, isApprovalDecision, projectSummary, projects, rightsConflicts } from './domain.js';

export const app = express();
app.use(express.json());
app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/projects', (_req, res) => res.json(projects));
app.get('/api/projects/:id/summary', (req, res) => { const result = projectSummary(req.params.id); if (!result.project) return res.status(404).json({ message: '项目不存在' }); res.json(result); });
app.get('/api/projects/:id/rights-conflicts', (req, res) => res.json(rightsConflicts(req.params.id)));
app.get('/api/projects/:id/assets', (req, res) => res.json(assets.filter(asset => asset.projectId === req.params.id)));
app.get('/api/projects/:id/contracts', (req, res) => res.json(contracts.filter(contract => contract.projectId === req.params.id)));
app.get('/api/budgets/:projectId/lines', (req, res) => res.json(budgetLines.filter(line => line.projectId === req.params.projectId)));
app.post('/api/approvals', (req, res) => res.status(201).json(createApproval(req.body)));
app.patch('/api/approvals/:id', (req, res) => {
  const body = req.body ?? {};
  if (!isApprovalDecision(body.status)) return res.status(400).json({ message: '无效的审批状态：仅支持 approved 或 rejected' });
  const result = approve(req.params.id, body.status, typeof body.comment === 'string' ? body.comment : '');
  if (!result) return res.status(404).json({ message: '审批不存在' });
  res.json(result);
});
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'film-rights-platform' }));
